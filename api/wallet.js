const { MongoClient, ObjectId } = require('mongodb');
const uri = process.env.MONGODB_URI || process.env.STORAGE_URL;
let cachedClient = null;

async function connectToDatabase() {
    if (cachedClient) return cachedClient;
    const client = new MongoClient(uri);
    await client.connect();
    cachedClient = client;
    return client;
}

export default async function handler(req, res) {
    try {
        const client = await connectToDatabase();
        const db = client.db('ludocash');
        const transactions = db.collection('transactions');
        const users = db.collection('users');
        const settings = db.collection('settings');
        const matches = db.collection('matches');

        // Settings (Bikash, WA, Refer Bonus)
        if (req.method === 'GET' && req.query.type === 'settings') {
            const data = await settings.findOne({ id: 'config' });
            return res.json(data || { bikash: '017XXXXXXXX', wa: '8801700000000', referBonus: 10 });
        }
        if (req.method === 'POST' && req.body.type === 'updateSettings') {
            await settings.updateOne({ id: 'config' }, { $set: { bikash: req.body.bikash, wa: req.body.wa, referBonus: parseInt(req.body.referBonus) } }, { upsert: true });
            return res.json({ success: true });
        }

        // User Data & Refer Logic
        if (req.method === 'GET' && req.query.userId) {
            const user = await users.findOne({ userId: req.query.userId });
            return res.json({ balance: user ? user.balance : 0, referClaimed: user ? user.referClaimed : false });
        }
        if (req.method === 'POST' && req.body.type === 'claimRefer') {
            const { userId, referCode } = req.body;
            const user = await users.findOne({ userId });
            if (user && user.referClaimed) return res.status(400).json({ error: 'Already claimed' });
            const referrer = await users.findOne({ userId: referCode });
            if (!referrer || userId === referCode) return res.status(400).json({ error: 'Invalid code' });
            const config = await settings.findOne({ id: 'config' });
            const bonus = config ? config.referBonus : 10;
            await users.updateOne({ userId: referCode }, { $inc: { balance: bonus } });
            await users.updateOne({ userId }, { $inc: { balance: bonus }, $set: { referClaimed: true } }, { upsert: true });
            return res.json({ success: true, bonus });
        }

        // Tournament Lobby
        if (req.method === 'GET' && req.query.type === 'getMatches') {
            const list = await matches.find({ status: 'open' }).toArray();
            return res.json(list);
        }
        if (req.method === 'POST' && req.body.type === 'createMatch') {
            await matches.insertOne({ ...req.body, players: [], status: 'open', createdAt: new Date() });
            return res.json({ success: true });
        }

        // Payments
        if (req.method === 'POST' && req.body.type === 'deposit') {
            await transactions.insertOne({ ...req.body, status: 'pending', date: new Date() });
            return res.json({ success: true });
        }
        if (req.method === 'GET' && req.query.admin === 'true') {
            const list = await transactions.find({ status: 'pending' }).toArray();
            return res.json(list);
        }
        if (req.method === 'POST' && req.body.action === 'approve') {
            const request = await transactions.findOne({ _id: new ObjectId(req.body.id) });
            if (request) {
                await transactions.updateOne({ _id: new ObjectId(req.body.id) }, { $set: { status: 'approved' } });
                await users.updateOne({ userId: request.userId }, { $inc: { balance: parseInt(request.amount) } }, { upsert: true });
            }
            return res.json({ success: true });
        }
    } catch (e) { return res.status(500).json({ error: e.message }); }
                }

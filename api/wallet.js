const { MongoClient, ObjectId } = require('mongodb');

// Vercel dashboard এ গিয়ে Settings > Environment Variables এ দেখুন নাম কি। 
// সাধারণত MONGODB_URI থাকে।
const uri = process.env.MONGODB_URI || process.env.STORAGE_URL;

let cachedClient = null;

async function connectToDatabase() {
    if (cachedClient) return cachedClient;
    if (!uri) throw new Error("Database URL missing!");
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

        if (req.method === 'GET' && req.query.type === 'settings') {
            const data = await settings.findOne({ id: 'config' });
            return res.json(data || { bikash: '017XXXXXXXX', wa: '8801700000000', referBonus: 10 });
        }
        if (req.method === 'POST' && req.body.type === 'updateSettings') {
            await settings.updateOne({ id: 'config' }, { $set: { bikash: req.body.bikash, wa: req.body.wa, referBonus: parseInt(req.body.referBonus) } }, { upsert: true });
            return res.json({ success: true });
        }
        if (req.method === 'GET' && req.query.userId) {
            const user = await users.findOne({ userId: req.query.userId });
            return res.json({ balance: user ? user.balance : 0, referClaimed: user ? user.referClaimed : false });
        }
        if (req.method === 'POST' && (req.body.type === 'deposit' || req.body.type === 'withdraw')) {
            const { userId, amount, trxId, type, phone } = req.body;
            if (type === 'withdraw') {
                const user = await users.findOne({ userId });
                if (!user || user.balance < amount) return res.status(400).json({ error: 'Low Balance' });
                await users.updateOne({ userId }, { $inc: { balance: -parseInt(amount) } });
            }
            await transactions.insertOne({ userId, amount: parseInt(amount), trxId, phone, type, status: 'pending', date: new Date() });
            return res.json({ success: true });
        }
        if (req.method === 'GET' && req.query.admin === 'true') {
            const list = await transactions.find({ status: 'pending' }).toArray();
            return res.json(list);
        }
        if (req.method === 'POST' && req.body.action) {
            const { id, userId, amount, action, type } = req.body;
            if (action === 'approve') {
                await transactions.updateOne({ _id: new ObjectId(id) }, { $set: { status: 'approved' } });
                if (type === 'deposit') await users.updateOne({ userId }, { $inc: { balance: parseInt(amount) } }, { upsert: true });
            } else if (action === 'reject') {
                await transactions.updateOne({ _id: new ObjectId(id) }, { $set: { status: 'rejected' } });
                if (type === 'withdraw') await users.updateOne({ userId }, { $inc: { balance: parseInt(amount) } });
            }
            return res.json({ success: true });
        }
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

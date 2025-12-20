const { MongoClient, ObjectId } = require('mongodb');
const uri = process.env.STORAGE_URL || process.env.MONGODB_URL;
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

        // Settings (Bonus info)
        if (req.method === 'GET' && req.query.type === 'settings') {
            const data = await settings.findOne({ id: 'config' });
            return res.status(200).json(data || { bikash: '017XXXXXXXX', referBonus: 10 });
        }
        if (req.method === 'POST' && req.body.type === 'updateSettings') {
            await settings.updateOne({ id: 'config' }, { $set: { bikash: req.body.bikash, wa: req.body.wa, referBonus: parseInt(req.body.referBonus) } }, { upsert: true });
            return res.status(200).json({ success: true });
        }

        // REFERRAL LOGIC
        if (req.method === 'POST' && req.body.type === 'claimRefer') {
            const { userId, referCode } = req.body;
            const user = await users.findOne({ userId });
            
            if (user && user.referClaimed) return res.status(400).json({ error: 'Bonus already claimed' });
            if (userId === referCode) return res.status(400).json({ error: 'Cannot refer yourself' });

            const referrer = await users.findOne({ userId: referCode });
            if (!referrer) return res.status(400).json({ error: 'Invalid Refer Code' });

            const bonus = (await settings.findOne({ id: 'config' })).referBonus || 10;

            // Add bonus to both
            await users.updateOne({ userId: referCode }, { $inc: { balance: bonus } });
            await users.updateOne({ userId }, { $inc: { balance: bonus }, $set: { referClaimed: true } }, { upsert: true });

            return res.status(200).json({ success: true, bonus });
        }

        // Get User Balance
        if (req.method === 'GET' && req.query.userId) {
            const user = await users.findOne({ userId: req.query.userId });
            return res.status(200).json({ balance: user ? user.balance : 0, referClaimed: user ? user.referClaimed : false });
        }

        // Standard Transactions (Deposit/Withdraw/Approve)
        // ... (আগের কোডের বাকি অংশ অপরিবর্তিত থাকবে)
        if (req.method === 'POST' && (req.body.type === 'deposit' || req.body.type === 'withdraw')) {
            const { userId, amount, trxId, type, phone } = req.body;
            if (type === 'withdraw') {
                const user = await users.findOne({ userId });
                if (!user || user.balance < amount) return res.status(400).json({ error: 'Low Balance' });
                await users.updateOne({ userId }, { $inc: { balance: -parseInt(amount) } });
            }
            await transactions.insertOne({ userId, amount: parseInt(amount), trxId, phone, type, status: 'pending', date: new Date() });
            return res.status(200).json({ success: true });
        }

        if (req.method === 'GET' && req.query.admin === 'true') {
            const list = await transactions.find({ status: 'pending' }).toArray();
            return res.status(200).json(list);
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
            return res.status(200).json({ success: true });
        }

    } catch (e) { res.status(500).json({ error: e.message }); }
}

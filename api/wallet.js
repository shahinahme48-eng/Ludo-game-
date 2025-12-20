const { MongoClient, ObjectId } = require('mongodb');
const uri = process.env.STORAGE_URL || process.env.MONGODB_URL || process.env.MONGODB_URI;
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

        // ১. সেটিংস (বিকাশ, হোয়াটস্যাপ ও রেফার বোনাস)
        if (req.method === 'GET' && req.query.type === 'settings') {
            const data = await settings.findOne({ id: 'config' });
            return res.status(200).json(data || { bikash: '017XXXXXXXX', wa: '8801700000000', referBonus: 10 });
        }

        if (req.method === 'POST' && req.body.type === 'updateSettings') {
            const { bikash, wa, referBonus } = req.body;
            await settings.updateOne({ id: 'config' }, { $set: { bikash, wa, referBonus: parseInt(referBonus) } }, { upsert: true });
            return res.status(200).json({ success: true });
        }

        // ২. রেফার বোনাস ক্লেইম লজিক
        if (req.method === 'POST' && req.body.type === 'claimRefer') {
            const { userId, referCode } = req.body;
            const user = await users.findOne({ userId });
            if (user && user.referClaimed) return res.status(400).json({ error: 'Bonus already claimed' });
            if (userId === referCode) return res.status(400).json({ error: 'Cannot refer yourself' });

            const referrer = await users.findOne({ userId: referCode });
            if (!referrer) return res.status(400).json({ error: 'Invalid Refer Code' });

            const config = await settings.findOne({ id: 'config' });
            const bonus = config ? config.referBonus : 10;

            await users.updateOne({ userId: referCode }, { $inc: { balance: bonus } });
            await users.updateOne({ userId }, { $inc: { balance: bonus }, $set: { referClaimed: true } }, { upsert: true });
            return res.status(200).json({ success: true, bonus });
        }

        // ৩. ব্যালেন্স চেক
        if (req.method === 'GET' && req.query.userId) {
            const user = await users.findOne({ userId: req.query.userId });
            return res.status(200).json({ balance: user ? user.balance : 0, referClaimed: user ? user.referClaimed : false });
        }

        // ৪. ডিপোজিট ও উইথড্র রিকোয়েস্ট
        if (req.method === 'POST' && (req.body.type === 'deposit' || req.body.type === 'withdraw')) {
            const { userId, amount, trxId, type, phone } = req.body;
            if (type === 'withdraw') {
                const user = await users.findOne({ userId });
                if (!user || user.balance < amount) return res.status(400).json({ error: 'Insufficient balance' });
                await users.updateOne({ userId }, { $inc: { balance: -parseInt(amount) } });
            }
            await transactions.insertOne({ userId, amount: parseInt(amount), trxId: trxId || 'N/A', phone: phone || 'N/A', type, status: 'pending', date: new Date() });
            return res.status(200).json({ success: true });
        }

        // ৫. অ্যাডমিন লিস্ট
        if (req.method === 'GET' && req.query.admin === 'true') {
            const list = await transactions.find({ status: 'pending' }).toArray();
            return res.status(200).json(list);
        }

        // ৬. অ্যাডমিন অ্যাকশন
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
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

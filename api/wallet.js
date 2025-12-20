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

        // ১. সেটিংস গেট ও আপডেট (বিকাশ ও রেফার বোনাস)
        if (req.method === 'GET' && req.query.type === 'settings') {
            const data = await settings.findOne({ id: 'config' });
            return res.json(data || { bikash: '017XXXXXXXX', referBonus: 10 });
        }
        if (req.method === 'POST' && req.body.type === 'updateSettings') {
            const { bikash, referBonus } = req.body;
            await settings.updateOne({ id: 'config' }, { $set: { bikash, referBonus: parseInt(referBonus) } }, { upsert: true });
            return res.json({ success: true });
        }

        // ২. ব্যালেন্স ও রেফার স্ট্যাটাস চেক
        if (req.method === 'GET' && req.query.userId) {
            const user = await users.findOne({ userId: req.query.userId });
            return res.json({ 
                balance: user ? user.balance : 0, 
                referClaimed: user ? user.referClaimed : false 
            });
        }

        // ৩. রেফার বোনাস ক্লেইম লজিক
        if (req.method === 'POST' && req.body.type === 'claimRefer') {
            const { userId, referCode } = req.body;
            const user = await users.findOne({ userId });
            if (user && user.referClaimed) return res.status(400).json({ error: 'ইতিমধ্যেই বোনাস নিয়েছেন' });
            if (userId === referCode) return res.status(400).json({ error: 'নিজে নিজেকে রেফার করা যাবে না' });

            const referrer = await users.findOne({ userId: referCode });
            if (!referrer) return res.status(400).json({ error: 'ভুল রেফার কোড' });

            const config = await settings.findOne({ id: 'config' });
            const bonus = config ? config.referBonus : 10;

            // উভয়ের ব্যালেন্সে টাকা যোগ করা
            await users.updateOne({ userId: referCode }, { $inc: { balance: bonus } });
            await users.updateOne({ userId }, { $inc: { balance: bonus }, $set: { referClaimed: true } }, { upsert: true });
            return res.json({ success: true, bonus });
        }

        // ৪. ডিপোজিট রিকোয়েস্ট
        if (req.method === 'POST' && req.body.type === 'deposit') {
            await transactions.insertOne({ userId: req.body.userId, amount: parseInt(req.body.amount), trxId: req.body.trxId, status: 'pending', type: 'deposit', date: new Date() });
            return res.json({ success: true });
        }

        // ৫. অ্যাডমিন লিস্ট ও অ্যাপ্রুভ
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

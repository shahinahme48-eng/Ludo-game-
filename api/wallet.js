const { MongoClient, ObjectId } = require('mongodb');

// Vercel-এ আপনার variable নাম STORAGE_URL না হলে MONGODB_URL দিয়ে ট্রাই করতে পারেন
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

        // ১. সেটিংস (বিকাশ নাম্বার) গেট করা
        if (req.method === 'GET' && req.query.type === 'settings') {
            const data = await settings.findOne({ id: 'config' });
            return res.status(200).json(data || { bikash: 'নাম্বার সেট করুন' });
        }

        // ২. সেটিংস আপডেট করা (অ্যাডমিন প্যানেল থেকে)
        if (req.method === 'POST' && req.body.type === 'updateSettings') {
            await settings.updateOne({ id: 'config' }, { $set: { bikash: req.body.bikash } }, { upsert: true });
            return res.status(200).json({ success: true });
        }

        // ৩. ব্যালেন্স চেক করা
        if (req.method === 'GET' && req.query.userId) {
            const user = await users.findOne({ userId: req.query.userId });
            return res.status(200).json({ balance: user ? user.balance : 0 });
        }

        // ৪. ডিপোজিট ও উইথড্র রিকোয়েস্ট
        if (req.method === 'POST' && (req.body.type === 'deposit' || req.body.type === 'withdraw')) {
            const { userId, amount, trxId, type, phone } = req.body;
            if (type === 'withdraw') {
                const user = await users.findOne({ userId });
                if (!user || user.balance < amount) return res.status(400).json({ error: 'ব্যালেন্স কম' });
                await users.updateOne({ userId }, { $inc: { balance: -parseInt(amount) } });
            }
            await transactions.insertOne({
                userId, amount: parseInt(amount), trxId: trxId || 'N/A', 
                phone: phone || 'N/A', type, status: 'pending', date: new Date()
            });
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
                if (type === 'deposit') {
                    await users.updateOne({ userId }, { $inc: { balance: parseInt(amount) } }, { upsert: true });
                }
            } else if (action === 'reject') {
                await transactions.updateOne({ _id: new ObjectId(id) }, { $set: { status: 'rejected' } });
                if (type === 'withdraw') {
                    await users.updateOne({ userId }, { $inc: { balance: parseInt(amount) } });
                }
            }
            return res.status(200).json({ success: true });
        }
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Server Error", details: e.message });
    }
}

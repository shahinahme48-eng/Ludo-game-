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

        if (req.method === 'GET' && req.query.type === 'settings') {
            const data = await settings.findOne({ id: 'config' });
            return res.json(data || { bikash: '017XXXXXXXX', wa: '8801700000000' });
        }
        if (req.method === 'POST' && req.body.type === 'updateSettings') {
            await settings.updateOne({ id: 'config' }, { $set: { bikash: req.body.bikash, wa: req.body.wa } }, { upsert: true });
            return res.json({ success: true });
        }
        if (req.method === 'GET' && req.query.userId) {
            const user = await users.findOne({ userId: req.query.userId });
            return res.json({ balance: user ? user.balance : 0 });
        }
        if (req.method === 'POST' && req.body.type === 'deposit') {
            await transactions.insertOne({ 
                userId: req.body.userId, 
                amount: parseInt(req.body.amount), 
                trxId: req.body.trxId, 
                status: 'pending', 
                type: 'deposit', 
                date: new Date() 
            });
            return res.json({ success: true });
        }
        if (req.method === 'GET' && req.query.admin === 'true') {
            const list = await transactions.find({ status: 'pending' }).toArray();
            return res.json(list);
        }
        if (req.method === 'POST' && req.body.action === 'approve') {
            const { id } = req.body;
            // প্রথমে রিকোয়েস্টটি খুঁজে বের করা
            const request = await transactions.findOne({ _id: new ObjectId(id) });
            if (!request) return res.status(404).json({ error: "Not found" });

            // রিকোয়েস্ট অ্যাপ্রুভ করা
            await transactions.updateOne({ _id: new ObjectId(id) }, { $set: { status: 'approved' } });
            
            // রিকোয়েস্টের ভেতরে থাকা UserId তে টাকা যোগ করা
            await users.updateOne(
                { userId: request.userId }, 
                { $inc: { balance: parseInt(request.amount) } }, 
                { upsert: true }
            );
            return res.json({ success: true });
        }
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

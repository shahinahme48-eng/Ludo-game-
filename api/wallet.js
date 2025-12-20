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

        // ১. টুর্নামেন্ট লিস্ট (Lobby)
        if (req.method === 'GET' && req.query.type === 'getMatches') {
            const list = await matches.find({ status: 'open' }).sort({ createdAt: -1 }).toArray();
            return res.json(list);
        }

        // ২. টুর্নামেন্ট তৈরি (Admin)
        if (req.method === 'POST' && req.body.type === 'createMatch') {
            const { entryFee, prize, mode, startTime } = req.body;
            await matches.insertOne({ 
                entryFee: parseInt(entryFee), 
                prize: parseInt(prize), 
                mode: parseInt(mode), // 2 or 4
                startTime: startTime, 
                players: [], 
                status: 'open', 
                createdAt: new Date() 
            });
            return res.json({ success: true });
        }

        // ৩. টুর্নামেন্টে জয়েন করা
        if (req.method === 'POST' && req.body.type === 'joinMatch') {
            const { matchId, userId } = req.body;
            const match = await matches.findOne({ _id: new ObjectId(matchId) });
            const user = await users.findOne({ userId });
            
            if (!user || user.balance < match.entryFee) return res.status(400).json({ error: 'ব্যালেন্স নেই' });
            if (match.players.length >= match.mode) return res.status(400).json({ error: 'ম্যাচটি হাউজফুল' });
            if (match.players.includes(userId)) return res.status(400).json({ error: 'ইতিমধ্যেই জয়েন করেছেন' });

            await users.updateOne({ userId }, { $inc: { balance: -match.entryFee } });
            await matches.updateOne({ _id: new ObjectId(matchId) }, { $push: { players: userId } });
            
            return res.json({ success: true });
        }

        // ৪. সেটিংস এবং ওয়ালেট লজিক (আগের মতো)
        if (req.method === 'GET' && req.query.type === 'settings') {
            const data = await settings.findOne({ id: 'config' });
            return res.json(data || { bikash: '017XXXXXXXX' });
        }
        if (req.method === 'POST' && req.body.type === 'updateSettings') {
            await settings.updateOne({ id: 'config' }, { $set: { bikash: req.body.bikash } }, { upsert: true });
            return res.json({ success: true });
        }
        if (req.method === 'GET' && req.query.userId) {
            const user = await users.findOne({ userId: req.query.userId });
            return res.json({ balance: user ? user.balance : 0 });
        }
        if (req.method === 'POST' && req.body.type === 'deposit') {
            await transactions.insertOne({ userId: req.body.userId, amount: parseInt(req.body.amount), trxId: req.body.trxId, status: 'pending', type: 'deposit', date: new Date() });
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
                return res.json({ success: true });
            }
        }
    } catch (e) { return res.status(500).json({ error: e.message }); }
}

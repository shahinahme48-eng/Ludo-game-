const { MongoClient, ObjectId } = require('mongodb');

// This connects to the MongoDB Atlas you set up
const client = new MongoClient(process.env.STORAGE_URL); 

export default async function handler(req, res) {
    try {
        await client.connect();
        const db = client.db('ludocash');
        const transactions = db.collection('transactions');
        const users = db.collection('users');

        // GET BALANCE
        if (req.method === 'GET' && req.query.userId) {
            const user = await users.findOne({ userId: req.query.userId });
            return res.status(200).json({ balance: user ? user.balance : 0 });
        }

        // SUBMIT DEPOSIT
        if (req.method === 'POST' && req.body.type === 'deposit') {
            const { amount, trxId, userId } = req.body;
            await transactions.insertOne({
                userId, amount: parseInt(amount), trxId, 
                status: 'pending', date: new Date()
            });
            return res.status(200).json({ message: "Request Sent" });
        }

        // ADMIN: GET ALL PENDING
        if (req.method === 'GET' && req.query.admin === 'true') {
            const list = await transactions.find({ status: 'pending' }).toArray();
            return res.status(200).json(list);
        }

        // ADMIN: APPROVE
        if (req.method === 'POST' && req.body.type === 'approve') {
            const { id, userId, amount } = req.body;
            await transactions.updateOne({ _id: new ObjectId(id) }, { $set: { status: 'approved' } });
            await users.updateOne({ userId }, { $inc: { balance: parseInt(amount) } }, { upsert: true });
            return res.status(200).json({ message: "Approved" });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
                             }

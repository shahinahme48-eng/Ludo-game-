const { MongoClient, ObjectId } = require('mongodb');
const client = new MongoClient(process.env.STORAGE_URL);

export default async function handler(req, res) {
    try {
        await client.connect();
        const db = client.db('ludocash');
        const transactions = db.collection('transactions');
        const users = db.collection('users');
        const settings = db.collection('settings');

        // ১. সেটিংস (বিকাশ নাম্বার) গেট এবং আপডেট
        if (req.method === 'GET' && req.query.type === 'settings') {
            const data = await settings.findOne({ id: 'config' });
            return res.status(200).json(data || { bikash: '01700000000' });
        }
        if (req.method === 'POST' && req.body.type === 'updateSettings') {
            await settings.updateOne({ id: 'config' }, { $set: { bikash: req.body.bikash } }, { upsert: true });
            return res.status(200).json({ success: true });
        }

        // ২. ব্যালেন্স চেক
        if (req.method === 'GET' && req.query.userId) {
            const user = await users.findOne({ userId: req.query.userId });
            return res.status(200).json({ balance: user ? user.balance : 0 });
        }

        // ৩. ডিপোজিট এবং উইথড্র রিকোয়েস্ট সাবমিট
        if (req.method === 'POST' && (req.body.type === 'deposit' || req.body.type === 'withdraw')) {
            const { userId, amount, trxId, type, phone } = req.body;
            
            if (type === 'withdraw') {
                const user = await users.findOne({ userId });
                if (!user || user.balance < amount) return res.status(400).json({ error: 'Insufficient balance' });
                // উইথড্র করলে সাথে সাথে ব্যালেন্স কেটে রাখা হবে (পেন্ডিং অবস্থায়)
                await users.updateOne({ userId }, { $inc: { balance: -parseInt(amount) } });
            }

            await transactions.insertOne({
                userId, amount: parseInt(amount), trxId: trxId || 'N/A', 
                phone: phone || 'N/A', type, status: 'pending', date: new Date()
            });
            return res.status(200).json({ success: true });
        }

        // ৪. অ্যাডমিন: সব পেন্ডিং রিকোয়েস্ট দেখা
        if (req.method === 'GET' && req.query.admin === 'true') {
            const list = await transactions.find({ status: 'pending' }).toArray();
            return res.status(200).json(list);
        }

        // ৫. অ্যাডমিন: রিকোয়েস্ট অ্যাপ্রুভ বা রিজেক্ট (ক্যানসেল)
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
                    // উইথড্র রিজেক্ট করলে টাকা রিফান্ড
                    await users.updateOne({ userId }, { $inc: { balance: parseInt(amount) } });
                }
            }
            return res.status(200).json({ success: true });
        }

        res.status(404).send("Not found");
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

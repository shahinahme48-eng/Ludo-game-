const { MongoClient, ObjectId } = require('mongodb');

const uri = process.env.MONGODB_URI;
let cachedDb = null;

async function connectToDatabase() {
    if (cachedDb) return cachedDb;
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db('ludocash');
    cachedDb = db;
    return db;
}

exports.handler = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
        const db = await connectToDatabase();
        const transactions = db.collection('transactions');
        const users = db.collection('users');
        const settings = db.collection('settings');
        const matches = db.collection('matches');

        const method = event.httpMethod;
        const query = event.queryStringParameters;
        const body = event.body ? JSON.parse(event.body) : {};

        // ১. সেটিংস গেট ও আপডেট
        if (method === 'GET' && query.type === 'settings') {
            const data = await settings.findOne({ id: 'config' });
            return { statusCode: 200, body: JSON.stringify(data || { bikash: '017XXXXXXXX', wa: '8801700000000', referBonus: 10 }) };
        }
        if (method === 'POST' && body.type === 'updateSettings') {
            await settings.updateOne({ id: 'config' }, { $set: { bikash: body.bikash, wa: body.wa, referBonus: parseInt(body.referBonus) } }, { upsert: true });
            return { statusCode: 200, body: JSON.stringify({ success: true }) };
        }

        // ২. ব্যালেন্স এবং রেফার চেক
        if (method === 'GET' && query.userId) {
            const user = await users.findOne({ userId: query.userId });
            return { statusCode: 200, body: JSON.stringify({ balance: user ? user.balance : 0, referClaimed: user ? user.referClaimed : false }) };
        }

        // ৩. টুর্নামেন্ট লজিক
        if (method === 'GET' && query.type === 'getMatches') {
            const list = await matches.find({ status: 'open' }).toArray();
            return { statusCode: 200, body: JSON.stringify(list) };
        }
        if (method === 'POST' && body.type === 'createMatch') {
            await matches.insertOne({ ...body, players: [], status: 'open', createdAt: new Date() });
            return { statusCode: 200, body: JSON.stringify({ success: true }) };
        }

        // ৪. পেমেন্ট রিকোয়েস্ট (Deposit)
        if (method === 'POST' && body.type === 'deposit') {
            await transactions.insertOne({ ...body, status: 'pending', date: new Date() });
            return { statusCode: 200, body: JSON.stringify({ success: true }) };
        }

        // ৫. অ্যাডমিন লিস্ট ও অ্যাপ্রুভ
        if (method === 'GET' && query.admin === 'true') {
            const list = await transactions.find({ status: 'pending' }).toArray();
            return { statusCode: 200, body: JSON.stringify(list) };
        }
        if (method === 'POST' && body.action === 'approve') {
            const request = await transactions.findOne({ _id: new ObjectId(body.id) });
            if (request) {
                await transactions.updateOne({ _id: new ObjectId(body.id) }, { $set: { status: 'approved' } });
                await users.updateOne({ userId: request.userId }, { $inc: { balance: parseInt(request.amount) } }, { upsert: true });
                return { statusCode: 200, body: JSON.stringify({ success: true }) };
            }
        }

        return { statusCode: 404, body: 'Not Found' };
    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};

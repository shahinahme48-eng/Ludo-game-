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
    const db = await connectToDatabase();
    const transactions = db.collection('transactions');
    const users = db.collection('users');
    const settings = db.collection('settings');
    const matches = db.collection('matches');

    const method = event.httpMethod;
    const query = event.queryStringParameters;
    const body = event.body ? JSON.parse(event.body) : {};

    try {
        // ১. সেটিংস লোড
        if (method === 'GET' && query.type === 'settings') {
            const data = await settings.findOne({ id: 'config' });
            return { statusCode: 200, body: JSON.stringify(data || { bikash: 'নাম্বার দিন', wa: '8801700000000' }) };
        }

        // ২. সেটিংস আপডেট (অ্যাডমিন থেকে)
        if (method === 'POST' && body.type === 'updateSettings') {
            await settings.updateOne({ id: 'config' }, { $set: { bikash: body.bikash, wa: body.wa } }, { upsert: true });
            return { statusCode: 200, body: JSON.stringify({ success: true }) };
        }

        // ৩. ব্যালেন্স চেক
        if (method === 'GET' && query.userId) {
            const user = await users.findOne({ userId: query.userId });
            return { statusCode: 200, body: JSON.stringify({ balance: user ? user.balance : 0 }) };
        }

        // ৪. টুর্নামেন্ট লবি লোড
        if (method === 'GET' && query.type === 'getMatches') {
            const list = await matches.find({ status: 'open' }).toArray();
            return { statusCode: 200, body: JSON.stringify(list) };
        }

        // ৫. টুর্নামেন্ট তৈরি
        if (method === 'POST' && body.type === 'createMatch') {
            await matches.insertOne({ ...body, players: [], status: 'open', date: new Date() });
            return { statusCode: 200, body: JSON.stringify({ success: true }) };
        }

        // ৬. ডিপোজিট রিকোয়েস্ট
        if (method === 'POST' && body.type === 'deposit') {
            await transactions.insertOne({ ...body, status: 'pending', date: new Date() });
            return { statusCode: 200, body: JSON.stringify({ success: true }) };
        }

        // ৭. অ্যাডমিন লিস্ট ও অ্যাপ্রুভ
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
    } catch (err) {
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};

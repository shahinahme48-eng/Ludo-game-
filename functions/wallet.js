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

        // Settings (Bikash Number)
        if (method === 'GET' && query.type === 'settings') {
            const data = await settings.findOne({ id: 'config' });
            return { statusCode: 200, body: JSON.stringify(data || { bikash: '017XXXXXXXX', wa: '8801700000000' }) };
        }

        // User Balance
        if (method === 'GET' && query.userId) {
            const user = await users.findOne({ userId: query.userId });
            return { statusCode: 200, body: JSON.stringify({ balance: user ? user.balance : 0 }) };
        }

        // Lobby Matches
        if (method === 'GET' && query.type === 'getMatches') {
            const list = await matches.find({ status: 'open' }).toArray();
            return { statusCode: 200, body: JSON.stringify(list) };
        }

        // Submit Deposit
        if (method === 'POST' && body.type === 'deposit') {
            await transactions.insertOne({ ...body, status: 'pending', date: new Date() });
            return { statusCode: 200, body: JSON.stringify({ success: true }) };
        }

        return { statusCode: 404, body: 'Not Found' };
    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};

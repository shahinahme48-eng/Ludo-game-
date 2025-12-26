const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { MongoClient, ObjectId } = require("mongodb");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function run() {
    await client.connect();
    const db = client.db("ludocash");
    const users = db.collection("users");
    const settings = db.collection("settings");
    const transactions = db.collection("transactions");
    const matches = db.collection("matches");

    // --- API Routes ---
    app.get("/api/settings", async (req, res) => {
        const data = await settings.findOne({ id: "config" });
        res.json(data || { bikash: "017XXXXXXXX", wa: "8801700000000" });
    });

    app.get("/api/balance", async (req, res) => {
        const user = await users.findOne({ userId: req.query.userId });
        res.json({ balance: user ? user.balance : 0 });
    });

    app.post("/api/deposit", async (req, res) => {
        await transactions.insertOne({ ...req.body, status: "pending", type: "deposit", date: new Date() });
        res.json({ success: true });
    });

    app.post("/api/withdraw", async (req, res) => {
        const { userId, amount, phone } = req.body;
        const user = await users.findOne({ userId });
        if (!user || user.balance < amount) return res.status(400).json({ error: "ব্যালেন্স পর্যাপ্ত নয়" });
        
        await users.updateOne({ userId }, { $inc: { balance: -parseInt(amount) } });
        await transactions.insertOne({ userId, amount, phone, status: "pending", type: "withdraw", date: new Date() });
        res.json({ success: true });
    });

    app.get("/api/getMatches", async (req, res) => {
        const list = await matches.find({ status: "open" }).toArray();
        res.json(list);
    });

    app.post("/api/joinMatch", async (req, res) => {
        const { matchId, userId } = req.body;
        const match = await matches.findOne({ _id: new ObjectId(matchId) });
        const user = await users.findOne({ userId });

        if (!user || user.balance < match.entryFee) return res.status(400).json({ error: "ব্যালেন্স নেই, রিচার্জ করুন" });
        if (match.players.includes(userId)) return res.status(400).json({ error: "ইতিমধ্যেই জয়েন করেছেন" });

        await users.updateOne({ userId }, { $inc: { balance: -parseInt(match.entryFee) } });
        await matches.updateOne({ _id: new ObjectId(matchId) }, { $push: { players: userId } });
        
        io.emit("matchUpdated"); // সবাইকে জানানো যে প্লেয়ার বেড়েছে
        res.json({ success: true });
    });

    // Admin
    app.get("/api/admin/requests", async (req, res) => {
        const list = await transactions.find({ status: "pending" }).toArray();
        res.json(list);
    });

    app.post("/api/admin/approve", async (req, res) => {
        const request = await transactions.findOne({ _id: new ObjectId(req.body.id) });
        if (request && request.type === "deposit") {
            await users.updateOne({ userId: request.userId }, { $inc: { balance: parseInt(request.amount) } }, { upsert: true });
        }
        await transactions.updateOne({ _id: new ObjectId(req.body.id) }, { $set: { status: "approved" } });
        res.json({ success: true });
    });

    server.listen(process.env.PORT || 3000);
}
run();

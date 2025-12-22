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

    // --- সেটিংস এবং ব্যালেন্স ---
    app.get("/api/settings", async (req, res) => {
        const data = await settings.findOne({ id: "config" });
        res.json(data || { bikash: "017XXXXXXXX", wa: "8801700000000", referBonus: 10 });
    });

    app.post("/api/updateSettings", async (req, res) => {
        await settings.updateOne({ id: "config" }, { $set: req.body }, { upsert: true });
        res.json({ success: true });
    });

    app.get("/api/balance", async (req, res) => {
        const user = await users.findOne({ userId: req.query.userId });
        res.json({ balance: user ? user.balance : 0, referClaimed: user ? user.referClaimed : false });
    });

    // --- রেফারেল সিস্টেম (Fixed) ---
    app.post("/api/claimRefer", async (req, res) => {
        const { userId, referCode } = req.body;
        const user = await users.findOne({ userId });
        
        if (user && user.referClaimed) return res.status(400).json({ error: "ইতিমধ্যেই বোনাস নিয়েছেন" });
        if (userId === referCode) return res.status(400).json({ error: "নিজে নিজেকে রেফার করা যাবে না" });

        const referrer = await users.findOne({ userId: referCode });
        if (!referrer) return res.status(400).json({ error: "ভুল রেফার কোড" });

        const config = await settings.findOne({ id: "config" });
        const bonus = config ? parseInt(config.referBonus) : 10;

        await users.updateOne({ userId: referCode }, { $inc: { balance: bonus } });
        await users.updateOne({ userId }, { $inc: { balance: bonus }, $set: { referClaimed: true } }, { upsert: true });
        res.json({ success: true, bonus });
    });

    // --- লবি জয়েন সিস্টেম (Fixed) ---
    app.get("/api/getMatches", async (req, res) => {
        const list = await matches.find({ status: "open" }).toArray();
        res.json(list);
    });

    app.post("/api/joinMatch", async (req, res) => {
        const { matchId, userId } = req.body;
        const match = await matches.findOne({ _id: new ObjectId(matchId) });
        const user = await users.findOne({ userId });

        if (!user || user.balance < match.entryFee) return res.status(400).json({ error: "ব্যালেন্স নেই" });
        if (match.players.length >= match.mode) return res.status(400).json({ error: "ম্যাচটি হাউজফুল" });
        if (match.players.includes(userId)) return res.status(400).json({ error: "ইতিমধ্যেই জয়েন করেছেন" });

        await users.updateOne({ userId }, { $inc: { balance: -parseInt(match.entryFee) } });
        await matches.updateOne({ _id: new ObjectId(matchId) }, { $push: { players: userId } });
        res.json({ success: true });
    });

    // টুর্নামেন্ট তৈরি
    app.post("/api/createMatch", async (req, res) => {
        await matches.insertOne({ ...req.body, players: [], status: "open", date: new Date() });
        res.json({ success: true });
    });

    // ডিপোজিট এবং অ্যাডমিন
    app.post("/api/deposit", async (req, res) => {
        await transactions.insertOne({ ...req.body, status: "pending", date: new Date() });
        res.json({ success: true });
    });

    app.get("/api/admin/requests", async (req, res) => {
        const list = await transactions.find({ status: "pending" }).toArray();
        res.json(list);
    });

    app.get("/api/admin/users", async (req, res) => {
        const all = await users.find().toArray();
        const list = await Promise.all(all.map(async (u) => {
            const rCount = await users.countDocuments({ referredBy: u.userId });
            return { userId: u.userId, balance: u.balance, referCount: rCount };
        }));
        res.json(list);
    });

    app.post("/api/admin/handleRequest", async (req, res) => {
        const { id, action } = req.body;
        const request = await transactions.findOne({ _id: new ObjectId(id) });
        if (action === "approve") {
            await transactions.updateOne({ _id: new ObjectId(id) }, { $set: { status: "approved" } });
            await users.updateOne({ userId: request.userId }, { $inc: { balance: parseInt(request.amount) } }, { upsert: true });
        } else {
            await transactions.updateOne({ _id: new ObjectId(id) }, { $set: { status: "rejected" } });
        }
        res.json({ success: true });
    });

    server.listen(process.env.PORT || 3000);
}
run();

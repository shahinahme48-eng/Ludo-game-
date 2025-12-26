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

    // সেটিংস এবং ব্যালেন্স
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

    // রেফারেল লজিক
    app.post("/api/claimRefer", async (req, res) => {
        const { userId, referCode } = req.body;
        const user = await users.findOne({ userId });
        if (user && user.referClaimed) return res.status(400).json({ error: "Already claimed" });
        const referrer = await users.findOne({ userId: referCode });
        if (!referrer || userId === referCode) return res.status(400).json({ error: "Invalid code" });
        const config = await settings.findOne({ id: "config" });
        const bonus = config ? parseInt(config.referBonus) : 10;
        await users.updateOne({ userId: referCode }, { $inc: { balance: bonus } });
        await users.updateOne({ userId }, { $inc: { balance: bonus }, $set: { referClaimed: true } }, { upsert: true });
        res.json({ success: true, bonus });
    });

    // টুর্নামেন্ট এবং জয়েন সিস্টেম
    app.get("/api/getMatches", async (req, res) => {
        const list = await matches.find({ status: "open" }).toArray();
        res.json(list);
    });
    app.post("/api/createMatch", async (req, res) => {
        await matches.insertOne({ ...req.body, players: [], status: "open", date: new Date() });
        res.json({ success: true });
    });
    app.post("/api/joinMatch", async (req, res) => {
        const { matchId, userId } = req.body;
        const match = await matches.findOne({ _id: new ObjectId(matchId) });
        const user = await users.findOne({ userId });
        if (!user || user.balance < match.entryFee) return res.status(400).json({ error: "Insufficient Balance" });
        await users.updateOne({ userId }, { $inc: { balance: -parseInt(match.entryFee) } });
        await matches.updateOne({ _id: new ObjectId(matchId) }, { $push: { players: userId } });
        res.json({ success: true });
    });

    // ডিপোজিট এবং উইথড্র (অ্যাডমিন অ্যাপ্রুভালের জন্য)
    app.post("/api/deposit", async (req, res) => {
        await transactions.insertOne({ ...req.body, status: "pending", type: "deposit", date: new Date() });
        res.json({ success: true });
    });
    app.post("/api/withdraw", async (req, res) => {
        const { userId, amount, phone } = req.body;
        const user = await users.findOne({ userId });
        if (!user || user.balance < amount) return res.status(400).json({ error: "Insufficient balance" });
        await users.updateOne({ userId }, { $inc: { balance: -parseInt(amount) } });
        await transactions.insertOne({ userId, amount: parseInt(amount), phone, status: "pending", type: "withdraw", date: new Date() });
        res.json({ success: true });
    });

    // অ্যাডমিন হ্যান্ডলিং
    app.get("/api/admin/requests", async (req, res) => {
        const list = await transactions.find({ status: "pending" }).toArray();
        res.json(list);
    });
    app.post("/api/admin/handleRequest", async (req, res) => {
        const { id, action } = req.body;
        const request = await transactions.findOne({ _id: new ObjectId(id) });
        if (action === "approve") {
            await transactions.updateOne({ _id: new ObjectId(id) }, { $set: { status: "approved" } });
            if (request.type === "deposit") await users.updateOne({ userId: request.userId }, { $inc: { balance: parseInt(request.amount) } }, { upsert: true });
        } else {
            await transactions.updateOne({ _id: new ObjectId(id) }, { $set: { status: "rejected" } });
            if (request.type === "withdraw") await users.updateOne({ userId: request.userId }, { $inc: { balance: parseInt(request.amount) } });
        }
        res.json({ success: true });
    });

    // সকেট
    io.on("connection", (socket) => {
        socket.on("joinRoom", (roomId) => socket.join(roomId));
        socket.on("rollDice", (data) => io.to(data.roomId).emit("diceRolled", data));
    });

    server.listen(process.env.PORT || 3000);
}
run();

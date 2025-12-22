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

async function startServer() {
    await client.connect();
    const db = client.db("ludocash");
    const users = db.collection("users");
    const settings = db.collection("settings");
    const transactions = db.collection("transactions");
    const matches = db.collection("matches");

    // --- API Routes ---
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

    app.post("/api/deposit", async (req, res) => {
        await transactions.insertOne({ ...req.body, status: "pending", date: new Date() });
        res.json({ success: true });
    });

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

    app.get("/api/getMatches", async (req, res) => {
        const list = await matches.find({ status: "open" }).toArray();
        res.json(list);
    });

    app.post("/api/createMatch", async (req, res) => {
        await matches.insertOne({ ...req.body, players: [], status: "open", date: new Date() });
        res.json({ success: true });
    });

    app.get("/api/admin/requests", async (req, res) => {
        const list = await transactions.find({ status: "pending" }).toArray();
        res.json(list);
    });

    app.post("/api/admin/approve", async (req, res) => {
        const request = await transactions.findOne({ _id: new ObjectId(req.body.id) });
        if (request) {
            await transactions.updateOne({ _id: new ObjectId(req.body.id) }, { $set: { status: "approved" } });
            await users.updateOne({ userId: request.userId }, { $inc: { balance: parseInt(request.amount) } }, { upsert: true });
        }
        res.json({ success: true });
    });

    // --- Socket.io ---
    io.on("connection", (socket) => {
        socket.on("joinRoom", (roomId) => socket.join(roomId));
        socket.on("rollDice", (data) => io.to(data.roomId).emit("diceRolled", data));
    });

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => console.log("Server running"));
}
startServer();

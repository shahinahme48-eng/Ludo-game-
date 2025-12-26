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

    // --- Admin: Delete Match (নিশ্চিত ফিক্স) ---
    app.post("/api/admin/deleteMatch", async (req, res) => {
        try {
            const { id } = req.body;
            await matches.deleteOne({ _id: new ObjectId(id) });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // --- Admin: Get All Matches ---
    app.get("/api/admin/allMatches", async (req, res) => {
        const list = await matches.find().sort({ date: -1 }).toArray();
        res.json(list);
    });

    // --- Admin: Get User Referral List ---
    app.get("/api/admin/users", async (req, res) => {
        const all = await users.find().toArray();
        const list = await Promise.all(all.map(async (u) => {
            const rCount = await users.countDocuments({ referredBy: u.userId });
            return { userId: u.userId, balance: u.balance, referCount: rCount };
        }));
        res.json(list);
    });

    // --- API Routes (General) ---
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
        res.json({ balance: user ? user.balance : 0 });
    });
    app.post("/api/deposit", async (req, res) => {
        await transactions.insertOne({ ...req.body, status: "pending", date: new Date() });
        res.json({ success: true });
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

    io.on("connection", (socket) => {
        socket.on("joinRoom", (id) => socket.join(id));
        socket.on("rollDice", (d) => io.to(d.roomId).emit("diceRolled", d));
    });

    server.listen(process.env.PORT || 3000);
}
run();

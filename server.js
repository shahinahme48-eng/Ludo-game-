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

    // --- Lobby & Matches ---
    app.get("/api/getMatches", async (req, res) => {
        const list = await matches.find({ status: "open" }).toArray();
        res.json(list);
    });

    app.post("/api/createMatch", async (req, res) => {
        const { entryFee, prize, mode, startTime, roomCode, roomPass } = req.body;
        await matches.insertOne({ 
            entryFee: parseInt(entryFee), 
            prize: parseInt(prize), 
            mode: parseInt(mode), 
            startTime, 
            roomCode, 
            roomPass,
            players: [], 
            status: "open", 
            date: new Date() 
        });
        res.json({ success: true });
    });

    app.post("/api/joinMatch", async (req, res) => {
        const { matchId, userId } = req.body;
        try {
            const match = await matches.findOne({ _id: new ObjectId(matchId) });
            const user = await users.findOne({ userId });
            if (!user || user.balance < match.entryFee) return res.status(400).json({ error: "ব্যালেন্স নেই" });
            if (match.players.length >= match.mode) return res.status(400).json({ error: "ম্যাচ ফুল!" });
            
            await users.updateOne({ userId }, { $inc: { balance: -parseInt(match.entryFee) } });
            await matches.updateOne({ _id: new ObjectId(matchId) }, { $addToSet: { players: userId } });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: "Error" }); }
    });

    // --- Admin & Refer System ---
    app.get("/api/admin/users", async (req, res) => {
        const all = await users.find().toArray();
        const list = await Promise.all(all.map(async (u) => {
            const count = await users.countDocuments({ referredBy: u.userId });
            return { userId: u.userId, balance: u.balance, referCount: count };
        }));
        res.json(list);
    });

    app.post("/api/admin/deleteMatch", async (req, res) => {
        await matches.deleteOne({ _id: new ObjectId(req.body.id) });
        res.json({ success: true });
    });

    // বাকি কমন এপিআই (Settings, Balance, Deposit, Approve)
    app.get("/api/settings", async (req, res) => { res.json(await settings.findOne({id:"config"}) || {}); });
    app.post("/api/updateSettings", async (req, res) => { await settings.updateOne({id:"config"},{$set:req.body},{upsert:true}); res.json({success:true}); });
    app.get("/api/balance", async (req, res) => { const u = await users.findOne({userId:req.query.userId}); res.json({balance: u?u.balance:0}); });
    app.post("/api/deposit", async (req, res) => { await transactions.insertOne({...req.body, status:"pending", date:new Date()}); res.json({success:true}); });
    app.get("/api/admin/requests", async (req, res) => { res.json(await transactions.find({status:"pending"}).toArray()); });
    app.post("/api/admin/handleRequest", async (req, res) => {
        const { id, action } = req.body;
        const r = await transactions.findOne({ _id: new ObjectId(id) });
        if (action === "approve") {
            await transactions.updateOne({ _id: new ObjectId(id) }, { $set: { status: "approved" } });
            await users.updateOne({ userId: r.userId }, { $inc: { balance: parseInt(r.amount) } }, { upsert: true });
        } else { await transactions.updateOne({ _id: new ObjectId(id) }, { $set: { status: "rejected" } }); }
        res.json({ success: true });
    });

    io.on("connection", (socket) => {
        socket.on("joinRoom", (id) => socket.join(id));
        socket.on("rollDice", (d) => io.to(d.roomId).emit("diceRolled", d));
    });

    server.listen(process.env.PORT || 3000);
}
run();

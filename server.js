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
    const matches = db.collection("matches");
    const transactions = db.collection("transactions");
    const settings = db.collection("settings");

    // --- টুনামেন্ট টাইম মনিটর ---
    setInterval(async () => {
        const now = new Date();
        const currentTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka' });
        
        const pendingMatches = await matches.find({ status: "open" }).toArray();
        pendingMatches.forEach(async (match) => {
            if (match.startTime === currentTime) {
                await matches.updateOne({ _id: match._id }, { $set: { status: "playing" } });
                io.to(match._id.toString()).emit("gameStartNow", { matchId: match._id, players: match.players });
                console.log(`Match ${match._id} started automatically at ${currentTime}`);
            }
        });
    }, 30000); // প্রতি ৩০ সেকেন্ডে চেক করবে

    // সেটিংস এবং লবি এপিআই
    app.get("/api/settings", async (req, res) => {
        const data = await settings.findOne({ id: "config" });
        res.json(data || { bikash: "017XXXXXXXX", referBonus: 10 });
    });

    app.post("/api/updateSettings", async (req, res) => {
        await settings.updateOne({ id: "config" }, { $set: req.body }, { upsert: true });
        res.json({ success: true });
    });

    app.get("/api/getMatches", async (req, res) => {
        const list = await matches.find({ status: "open" }).toArray();
        res.json(list);
    });

    app.post("/api/createMatch", async (req, res) => {
        await matches.insertOne({ ...req.body, players: [], status: "open", createdAt: new Date() });
        res.json({ success: true });
    });

    app.post("/api/joinMatch", async (req, res) => {
        const { matchId, userId } = req.body;
        const match = await matches.findOne({ _id: new ObjectId(matchId) });
        const user = await users.findOne({ userId });
        if (!user || user.balance < match.entryFee) return res.status(400).json({ error: "ব্যালেন্স নেই" });
        await users.updateOne({ userId }, { $inc: { balance: -parseInt(match.entryFee) } });
        await matches.updateOne({ _id: new ObjectId(matchId) }, { $push: { players: userId } });
        res.json({ success: true });
    });

    // সকেট লজিক
    io.on("connection", (socket) => {
        socket.on("joinRoom", (roomId) => socket.join(roomId));
        socket.on("rollDice", (data) => io.to(data.roomId).emit("diceRolled", data));
        socket.on("movePiece", (data) => io.to(data.roomId).emit("pieceMoved", data));
        socket.on("killGuti", (data) => io.to(data.roomId).emit("gutiKilled", data));
    });

    server.listen(process.env.PORT || 3000);
}
run();

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

    console.log("Connected to MongoDB");

    // --- টুর্নামেন্ট টাইম মনিটর (বাংলাদেশ সময়) ---
    setInterval(async () => {
        const now = new Date();
        const bdTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Dhaka"}));
        const currentTime = bdTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase().replace(/\s+/g, '');

        const openMatches = await matches.find({ status: "open" }).toArray();
        for (let m of openMatches) {
            const mTime = m.startTime.toUpperCase().replace(/\s+/g, '');
            if (mTime === currentTime) {
                if (m.players.length >= 2) {
                    await matches.updateOne({ _id: m._id }, { $set: { status: "playing" } });
                    io.to(m._id.toString()).emit("gameStartNow", { matchId: m._id.toString(), roomCode: m.roomCode, prize: m.prize });
                } else {
                    await matches.updateOne({ _id: m._id }, { $set: { status: "expired" } });
                }
            }
        }
    }, 10000);

    // --- APIs ---
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

    app.get("/api/getMatches", async (req, res) => {
        const list = await matches.find({ status: "open" }).toArray();
        res.json(list);
    });

    app.post("/api/createMatch", async (req, res) => {
        await matches.insertOne({ ...req.body, players: [], status: "open", date: new Date() });
        res.json({ success: true });
    });

    app.post("/api/joinMatch", async (req, res) => {
        const { matchId, userId, fee } = req.body;
        const match = await matches.findOne({ _id: new ObjectId(matchId) });
        const user = await users.findOne({ userId });
        if (!user || user.balance < fee) return res.status(400).json({ error: "Balance Low" });
        if (match.players.length >= match.mode) return res.status(400).json({ error: "Full" });
        
        await users.updateOne({ userId }, { $inc: { balance: -parseInt(fee) } });
        await matches.updateOne({ _id: new ObjectId(matchId) }, { $addToSet: { players: userId } });
        res.json({ success: true });
    });

    // সকেট কানেকশন
    io.on("connection", (socket) => {
        socket.on("joinRoom", (id) => socket.join(id));
        socket.on("rollDice", (d) => io.to(d.roomId).emit("diceRolled", d));
        socket.on("movePiece", (d) => io.to(d.roomId).emit("pieceMoved", d));
    });

    server.listen(process.env.PORT || 3000);
}
run();

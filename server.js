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
    const settings = db.collection("settings");

    // --- ১ মিনিট আগে নোটিফিকেশন এবং অটো-স্টার্ট ---
    setInterval(async () => {
        const now = new Date();
        const bdTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Dhaka"}));
        
        const currentTime = bdTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        
        // ১ মিনিট পরের সময় বের করা (নোটিফিকেশনের জন্য)
        bdTime.setMinutes(bdTime.getMinutes() + 1);
        const oneMinLater = bdTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

        // ১ মিনিট আগের এলার্ট পাঠানো
        const upcomingMatches = await matches.find({ status: "open", startTime: oneMinLater }).toArray();
        upcomingMatches.forEach(m => {
            io.to(m._id.toString()).emit("oneMinWarning", { msg: "আপনার ম্যাচ ১ মিনিট পর শুরু হবে! তৈরি থাকুন।" });
        });

        // গেম স্টার্ট করা
        const matchesToStart = await matches.find({ status: "open", startTime: currentTime }).toArray();
        matchesToStart.forEach(async (m) => {
            await matches.updateOne({ _id: m._id }, { $set: { status: "playing" } });
            io.to(m._id.toString()).emit("gameStartNow", { matchId: m._id, roomCode: m.roomCode });
        });
    }, 30000);

    // টুর্নামেন্ট তৈরি (Admin)
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

    // টুর্নামেন্ট জয়েন (Password Validation)
    app.post("/api/joinMatch", async (req, res) => {
        const { matchId, userId, providedPass } = req.body;
        const match = await matches.findOne({ _id: new ObjectId(matchId) });
        const user = await users.findOne({ userId });

        if (match.roomPass !== providedPass) return res.status(400).json({ error: "ভুল পাসওয়ার্ড!" });
        if (match.players.length >= match.mode) return res.status(400).json({ error: "ম্যাচটি ইতিমধ্যে ফুল!" });
        if (user.balance < match.entryFee) return res.status(400).json({ error: "ব্যালেন্স নেই!" });

        await users.updateOne({ userId }, { $inc: { balance: -parseInt(match.entryFee) } });
        await matches.updateOne({ _id: new ObjectId(matchId) }, { $push: { players: userId } });
        res.json({ success: true });
    });

    app.get("/api/getMatches", async (req, res) => {
        const list = await matches.find({ status: "open" }).toArray();
        res.json(list);
    });

    // বাকি API গুলো আগের মতো থাকবে...
    app.get("/api/settings", async (req, res) => { const d = await settings.findOne({ id: "config" }); res.json(d || {}); });
    app.post("/api/updateSettings", async (req, res) => { await settings.updateOne({ id: "config" }, { $set: req.body }, { upsert: true }); res.json({ success: true }); });
    app.get("/api/balance", async (req, res) => { const u = await users.findOne({ userId: req.query.userId }); res.json({ balance: u ? u.balance : 0 }); });

    io.on("connection", (socket) => {
        socket.on("joinRoom", (id) => socket.join(id));
        socket.on("rollDice", (d) => io.to(d.roomId).emit("diceRolled", d));
    });

    server.listen(process.env.PORT || 3000);
}
run();

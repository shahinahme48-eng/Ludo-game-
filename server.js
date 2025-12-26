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
    const matches = db.collection("matches");
    const users = db.collection("users");
    const settings = db.collection("settings");
    const transactions = db.collection("transactions");

    // --- গেম স্টার্ট লজিক (Bangladesh Time Fix) ---
    setInterval(async () => {
        const now = new Date();
        const bdTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Dhaka"}));
        
        // সময় ফরম্যাট: "10:30 PM" (বড় হাতের অক্ষরে)
        let hours = bdTime.getHours();
        let minutes = bdTime.getMinutes();
        let ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        minutes = minutes < 10 ? '0' + minutes : minutes;
        const currentTime = `${hours}:${minutes} ${ampm}`;

        // ১ মিনিট পরের সময় (নোটিফিকেশনের জন্য)
        const nextMinDate = new Date(bdTime.getTime() + 60000);
        let nHours = nextMinDate.getHours();
        let nMinutes = nextMinDate.getMinutes();
        let nAmpm = nHours >= 12 ? 'PM' : 'AM';
        nHours = nHours % 12 || 12;
        nMinutes = nMinutes < 10 ? '0' + nMinutes : nMinutes;
        const oneMinLater = `${nHours}:${nMinutes} ${nAmpm}`;

        // ১. নোটিফিকেশন পাঠানো
        const upcoming = await matches.find({ status: "open", startTime: oneMinLater }).toArray();
        upcoming.forEach(m => io.to(m._id.toString()).emit("oneMinWarning", { msg: "ম্যাচ ১ মিনিট পর শুরু হবে!" }));

        // ২. অটো-স্টার্ট (ঠিক সময়ে)
        const toStart = await matches.find({ status: "open", startTime: currentTime }).toArray();
        for (let m of toStart) {
            await matches.updateOne({ _id: m._id }, { $set: { status: "playing" } });
            io.to(m._id.toString()).emit("gameStartNow", { matchId: m._id.toString(), roomCode: m.roomCode });
        }
    }, 10000); // প্রতি ১০ সেকেন্ডে চেক করবে

    // APIs
    app.get("/api/settings", async (req, res) => res.json(await settings.findOne({id:"config"}) || {bikash:"017XXXXXXXX"}));
    app.post("/api/updateSettings", async (req, res) => { await settings.updateOne({id:"config"},{$set:req.body},{upsert:true}); res.json({success:true}); });
    app.get("/api/getMatches", async (req, res) => res.json(await matches.find({ status: "open" }).toArray()));
    app.post("/api/createMatch", async (req, res) => { 
        let time = req.body.startTime.toUpperCase().trim();
        await matches.insertOne({ ...req.body, startTime: time, players: [], status: "open", date: new Date() });
        res.json({ success: true });
    });
    app.post("/api/joinMatch", async (req, res) => {
        const { matchId, userId } = req.body;
        const match = await matches.findOne({ _id: new ObjectId(matchId) });
        const user = await users.findOne({ userId });
        if (!user || user.balance < match.entryFee) return res.status(400).json({ error: "Balance Low" });
        await users.updateOne({ userId }, { $inc: { balance: -parseInt(match.entryFee) } });
        await matches.updateOne({ _id: new ObjectId(matchId) }, { $addToSet: { players: userId } });
        res.json({ success: true });
    });
    app.get("/api/balance", async (req, res) => {
        const u = await users.findOne({ userId: req.query.userId });
        res.json({ balance: u ? u.balance : 0 });
    });

    // Multiplayer Socket
    io.on("connection", (socket) => {
        socket.on("joinRoom", (id) => socket.join(id));
        socket.on("rollDice", (d) => io.to(d.roomId).emit("diceRolled", d));
        socket.on("movePiece", (d) => io.to(d.roomId).emit("pieceMoved", d));
    });

    server.listen(process.env.PORT || 3000);
}
run();

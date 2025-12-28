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

    // --- সময় মেলানোর প্রফেশনাল ফাংশন ---
    function getBDTime() {
        return new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Dhaka"}));
    }

    function formatTime(date) {
        return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase().replace(/\s+/g, '');
    }

    // --- অটো-স্টার্ট মনিটর (প্রতি ১০ সেকেন্ডে) ---
    setInterval(async () => {
        const now = getBDTime();
        const currentTime = formatTime(now);
        
        // ম্যাচ খোঁজা যার সময় হয়ে গেছে
        const toStart = await matches.find({ status: "open", startTime: currentTime }).toArray();
        
        for (let m of toStart) {
            if (m.players.length >= 1) { // অন্তত ১ জন থাকলেও স্টার্ট হবে (টেস্টিং এর জন্য)
                await matches.updateOne({ _id: m._id }, { $set: { status: "playing" } });
                
                // ওই রুমের সবাইকে গেম বোর্ডে পাঠিয়ে দেওয়া (Multiple Times emit for safety)
                const startData = { matchId: m._id.toString(), roomCode: m.roomCode, prize: m.prize, players: m.players, currentTurn: m.players[0] };
                io.to(m._id.toString()).emit("gameStartNow", startData);
                console.log("Match Started: " + m.startTime);
            }
        }
    }, 10000);

    // APIs
    app.get("/api/getMatches", async (req, res) => res.json(await matches.find({ status: "open" }).toArray()));
    app.post("/api/joinMatch", async (req, res) => {
        const { matchId, userId } = req.body;
        const match = await matches.findOne({ _id: new ObjectId(matchId) });
        if (!match) return res.status(404).json({ error: "ম্যাচ পাওয়া যায়নি" });
        
        await matches.updateOne({ _id: new ObjectId(matchId) }, { $addToSet: { players: userId } });
        res.json({ success: true });
    });
    
    app.get("/api/balance", async (req, res) => {
        const u = await users.findOne({ userId: req.query.userId });
        res.json({ balance: u ? u.balance : 0 });
    });
    
    app.get("/api/settings", async (req, res) => res.json(await settings.findOne({id:"config"}) || {bikash:"017XXXXXXXX"}));
    app.post("/api/updateSettings", async (req, res) => { await settings.updateOne({id:"config"},{$set:req.body},{upsert:true}); res.json({success:true}); });

    // সকেট কানেকশন
    io.on("connection", (socket) => {
        socket.on("joinRoom", (id) => socket.join(id));
        socket.on("rollDice", (d) => io.to(d.roomId).emit("diceRolled", d));
        socket.on("movePiece", (d) => io.to(d.roomId).emit("pieceMoved", d));
        socket.on("sendMessage", (d) => io.to(d.roomId).emit("newMessage", d));
    });

    server.listen(process.env.PORT || 3000);
}
run();

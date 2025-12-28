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

    // সময় পরিষ্কার করার ফাংশন (যাতে কোনো ভুল না হয়)
    function cleanT(t) {
        if(!t) return "";
        return t.replace(/[:\s\.]/g, '').replace(/^0+/, '').toUpperCase();
    }

    // --- টুর্নামেন্ট অটো-মনিটর (প্রতি ১৫ সেকেন্ডে চেক) ---
    setInterval(async () => {
        const now = new Date();
        const bdTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Dhaka"}));
        
        const currentTimeRaw = bdTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const currentTime = cleanT(currentTimeRaw);
        
        // ১ মিনিট পরের সময়
        const nextMin = new Date(bdTime.getTime() + 60000);
        const oneMinLater = cleanT(nextMin.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }));

        const openMatches = await matches.find({ status: "open" }).toArray();

        for (let m of openMatches) {
            const mTime = cleanT(m.startTime);

            // ১. নোটিফিকেশন (১ মিনিট আগে)
            if (mTime === oneMinLater) {
                io.to(m._id.toString()).emit("oneMinWarning", { msg: "ম্যাচ ১ মিনিট পর শুরু হবে!" });
            }

            // ২. গেম স্টার্ট (সময় হওয়া মাত্র)
            if (mTime === currentTime) {
                await matches.updateOne({ _id: m._id }, { $set: { status: "playing" } });
                io.to(m._id.toString()).emit("gameStartNow", { 
                    matchId: m._id.toString(), 
                    roomCode: m.roomCode,
                    prize: m.prize 
                });
            }
        }
    }, 15000);

    // APIs
    app.get("/api/getMatches", async (req, res) => res.json(await matches.find({ status: "open" }).toArray()));
    app.get("/api/balance", async (req, res) => {
        const u = await users.findOne({ userId: req.query.userId });
        res.json({ balance: u ? u.balance : 0 });
    });
    app.get("/api/settings", async (req, res) => res.json(await settings.findOne({id:"config"}) || {bikash:"017XXXXXXXX"}));
    app.post("/api/joinMatch", async (req, res) => {
        const { matchId, userId } = req.body;
        await matches.updateOne({ _id: new ObjectId(matchId) }, { $addToSet: { players: userId } });
        res.json({ success: true });
    });

    io.on("connection", (socket) => {
        socket.on("joinRoom", (id) => {
            socket.join(id);
            console.log("Joined Room: " + id);
        });

        
app.post("/api/joinMatch", async (req, res) => {
    const { matchId, userId } = req.body;
    try {
        const match = await matches.findOne({ _id: new ObjectId(matchId) });
        const user = await users.findOne({ userId });

        if (!user || user.balance < match.entryFee) return res.status(400).json({ error: "ব্যালেন্স নেই" });
        if (match.players.length >= match.mode) return res.status(400).json({ error: "ম্যাচ ফুল" });
        if (match.players.includes(userId)) return res.status(400).json({ error: "ইতিমধ্যেই জয়েন করেছেন" });

        await users.updateOne({ userId }, { $inc: { balance: -parseInt(match.entryFee) } });
        await matches.updateOne({ _id: new ObjectId(matchId) }, { $push: { players: userId } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Error joining match" }); }
});
        socket.on("rollDice", (d) => io.to(d.roomId).emit("diceRolled", d));
    });

    server.listen(process.env.PORT || 3000);
}
run();

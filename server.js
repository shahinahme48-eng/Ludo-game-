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

    // সময় পরিষ্কার করার ফাংশন (যাতে 08:40 AM আর 8:40 AM একই হয়)
    function normalizeTime(timeStr) {
        if(!timeStr) return "";
        return timeStr.replace(/[:\s\.]/g, '').replace(/^0+/, '').toUpperCase().trim();
    }

    // --- টুর্নামেন্ট মনিটর (প্রতি ১০ সেকেন্ডে চেক করবে) ---
    setInterval(async () => {
        const now = new Date();
        const bdTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Dhaka"}));
        
        const currentTimeRaw = bdTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const currentTime = normalizeTime(currentTimeRaw);
        
        bdTime.setMinutes(bdTime.getMinutes() + 1);
        const oneMinLaterRaw = bdTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const oneMinLater = normalizeTime(oneMinLaterRaw);

        const allOpenMatches = await matches.find({ status: "open" }).toArray();

        for (let m of allOpenMatches) {
            const matchTime = normalizeTime(m.startTime);

            // ১ মিনিট আগের এলার্ট
            if (matchTime === oneMinLater) {
                io.to(m._id.toString()).emit("oneMinWarning", { msg: "আপনার ম্যাচ ১ মিনিট পর শুরু হবে!" });
            }

            // ম্যাচ স্টার্ট (সময় হওয়া মাত্র)
            if (matchTime === currentTime) {
                await matches.updateOne({ _id: m._id }, { $set: { status: "playing" } });
                io.to(m._id.toString()).emit("gameStartNow", { 
                    matchId: m._id.toString(), 
                    roomCode: m.roomCode,
                    prize: m.prize 
                });
            }
        }
    }, 10000);

    // APIs
    app.get("/api/getMatches", async (req, res) => res.json(await matches.find({ status: "open" }).toArray()));
    
    app.post("/api/joinMatch", async (req, res) => {
        const { matchId, userId } = req.body;
        const match = await matches.findOne({ _id: new ObjectId(matchId) });
        const user = await users.findOne({ userId });

        if (!user || user.balance < match.entryFee) return res.status(400).json({ error: "ব্যালেন্স নেই" });
        
        await users.updateOne({ userId }, { $inc: { balance: -parseInt(match.entryFee) } });
        await matches.updateOne({ _id: new ObjectId(matchId) }, { $addToSet: { players: userId } });
        res.json({ success: true });
    });

    app.get("/api/balance", async (req, res) => {
        const u = await users.findOne({ userId: req.query.userId });
        res.json({ balance: u ? u.balance : 0 });
    });

    app.post("/api/createMatch", async (req, res) => {
        await matches.insertOne({ ...req.body, players: [], status: "open", date: new Date() });
        res.json({ success: true });
    });

    app.get("/api/settings", async (req, res) => res.json(await settings.findOne({id:"config"}) || {bikash:"017XXXXXXXX"}));
    app.post("/api/updateSettings", async (req, res) => { await settings.updateOne({id:"config"},{$set:req.body},{upsert:true}); res.json({success:true}); });

    io.on("connection", (socket) => {
        socket.on("joinRoom", (id) => socket.join(id));
        socket.on("rollDice", (d) => io.to(d.roomId).emit("diceRolled", d));
    });

    server.listen(process.env.PORT || 3000);
}
run();

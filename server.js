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

    // --- টুর্নামেন্ট টাইম মনিটর (বাংলাদেশ সময় অনুযায়ী) ---
    setInterval(async () => {
        const now = new Date();
        const bdTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Dhaka"}));
        
        // বর্তমান সময় ফরম্যাট করা (যেমন: 10:30 PM)
        const currentTime = bdTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

        // ১ মিনিট পরের সময় বের করা (নোটিফিকেশনের জন্য)
        const oneMinLaterDate = new Date(bdTime.getTime() + 60000);
        const oneMinLater = oneMinLaterDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

        // ১. নোটিফিকেশন পাঠানো (১ মিনিট আগে)
        const upcomingMatches = await matches.find({ status: "open", startTime: oneMinLater }).toArray();
        upcomingMatches.forEach(m => {
            io.to(m._id.toString()).emit("oneMinWarning", { msg: "আপনার ম্যাচ ১ মিনিট পর শুরু হবে! তৈরি থাকুন।" });
        });

        // ২. গেম স্টার্ট করা (ঠিক সময়ে)
        const matchesToStart = await matches.find({ status: "open", startTime: currentTime }).toArray();
        for (let m of matchesToStart) {
            await matches.updateOne({ _id: m._id }, { $set: { status: "playing" } });
            io.to(m._id.toString()).emit("gameStartNow", { matchId: m._id, roomCode: m.roomCode });
            console.log("Started Match: " + m.startTime);
        }
    }, 20000); // প্রতি ২০ সেকেন্ডে চেক করবে

    // APIs
    app.get("/api/getMatches", async (req, res) => res.json(await matches.find({ status: "open" }).toArray()));
    app.post("/api/createMatch", async (req, res) => {
        const { entryFee, prize, mode, startTime, roomCode } = req.body;
        await matches.insertOne({ entryFee: parseInt(entryFee), prize: parseInt(prize), mode: parseInt(mode), startTime, roomCode, players: [], status: "open", date: new Date() });
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
    app.get("/api/balance", async (req, res) => {
        const u = await users.findOne({ userId: req.query.userId });
        res.json({ balance: u ? u.balance : 0 });
    });
    app.get("/api/settings", async (req, res) => res.json(await settings.findOne({id:"config"}) || {bikash:"017XXXXXXXX"}));

    io.on("connection", (socket) => {
        socket.on("joinRoom", (id) => socket.join(id));
        socket.on("rollDice", (d) => io.to(d.roomId).emit("diceRolled", d));
    });

    server.listen(process.env.PORT || 3000);
}
run();

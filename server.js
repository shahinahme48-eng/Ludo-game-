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

    // --- টুনামেন্ট অটো-স্টার্ট ও লবি থেকে হাইড লজিক ---
    setInterval(async () => {
        const now = new Date();
        const bdTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka' });
        
        // সময় হয়ে গেলে স্ট্যাটাস 'playing' করে দেওয়া (যাতে লবিতে আর না দেখায়)
        const cleanTime = bdTime.replace(/\s+/g, '').toUpperCase();
        
        const openMatches = await matches.find({ status: "open" }).toArray();
        for (let m of openMatches) {
            if (m.startTime.replace(/\s+/g, '').toUpperCase() === cleanTime) {
                await matches.updateOne({ _id: m._id }, { $set: { status: "playing" } });
                io.to(m._id.toString()).emit("gameStartNow", { matchId: m._id, roomCode: m.roomCode });
            }
        }
    }, 20000);

    // লবি ডেটা এপিআই
    app.get("/api/getMatches", async (req, res) => {
        const list = await matches.find({ status: "open" }).toArray();
        res.json(list);
    });

    app.post("/api/createMatch", async (req, res) => {
        await matches.insertOne({ ...req.body, players: [], status: "open", date: new Date() });
        res.json({ success: true });
    });

    app.post("/api/joinMatch", async (req, res) => {
        const { matchId, userId } = req.body;
        const match = await matches.findOne({ _id: new ObjectId(matchId) });
        const user = await users.findOne({ userId });

        if (!user || user.balance < match.entryFee) return res.status(400).json({ error: "ব্যালেন্স নেই, রিচার্জ করুন" });
        if (match.players.length >= match.mode) return res.status(400).json({ error: "ম্যাচ ফুল!" });
        if (match.players.includes(userId)) return res.status(400).json({ error: "ইতিমধ্যেই জয়েন করেছেন" });

        await users.updateOne({ userId }, { $inc: { balance: -parseInt(match.entryFee) } });
        await matches.updateOne({ _id: new ObjectId(matchId) }, { $push: { players: userId } });
        res.json({ success: true });
    });

    // ওয়ালেট এবং সেটিংস
    app.get("/api/settings", async (req, res) => { res.json(await settings.findOne({id:"config"}) || {bikash:"017XXXXXXXX"}); });
    app.post("/api/updateSettings", async (req, res) => { await settings.updateOne({id:"config"},{$set:req.body},{upsert:true}); res.json({success:true}); });
    app.get("/api/balance", async (req, res) => { const u = await users.findOne({userId:req.query.userId}); res.json({balance: u?u.balance:0, referClaimed: u?u.referClaimed:false}); });
    app.post("/api/deposit", async (req, res) => { await transactions.insertOne({...req.body, status:"pending", type:"deposit", date:new Date()}); res.json({success:true}); });
    app.post("/api/withdraw", async (req, res) => {
        const { userId, amount, phone } = req.body;
        const user = await users.findOne({ userId });
        if (user.balance < amount) return res.status(400).json({ error: "ব্যালেন্স কম" });
        await users.updateOne({ userId }, { $inc: { balance: -parseInt(amount) } });
        await transactions.insertOne({ userId, amount, phone, status: "pending", type: "withdraw", date: new Date() });
        res.json({ success: true });
    });

    app.get("/api/admin/requests", async (req, res) => { res.json(await transactions.find({status:"pending"}).toArray()); });
    app.post("/api/admin/approve", async (req, res) => {
        const r = await transactions.findOne({_id: new ObjectId(req.body.id)});
        if(r && r.type === "deposit") await users.updateOne({userId: r.userId}, {$inc:{balance:parseInt(r.amount)}}, {upsert:true});
        await transactions.updateOne({_id: new ObjectId(req.body.id)}, {$set:{status:"approved"}});
        res.json({success:true});
    });

    io.on("connection", (socket) => {
        socket.on("joinRoom", (id) => socket.join(id));
        socket.on("rollDice", (d) => io.to(d.roomId).emit("diceRolled", d));
    });

    server.listen(process.env.PORT || 3000);
}
run();

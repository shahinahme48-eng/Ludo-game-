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

    // --- টুনামেন্ট অটো-স্টার্ট এবং লবি থেকে হাইড লজিক ---
    setInterval(async () => {
        const now = new Date();
        const currentTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka' });
        
        // সময় হয়ে গেলে স্ট্যাটাস 'playing' করে দেওয়া (যাতে লবিতে আর না দেখায়)
        await matches.updateMany(
            { status: "open", startTime: currentTime },
            { $set: { status: "playing" } }
        );
    }, 30000);

    // লবি ডেটা গেট (সব ফিল্ডসহ)
    app.get("/api/getMatches", async (req, res) => {
        const list = await matches.find({ status: "open" }).toArray();
        res.json(list);
    });

    app.post("/api/createMatch", async (req, res) => {
        const { entryFee, prize, mode, startTime } = req.body;
        await matches.insertOne({ 
            entryFee: parseInt(entryFee), 
            prize: parseInt(prize), 
            mode: parseInt(mode), 
            startTime, 
            players: [], 
            status: "open", 
            date: new Date() 
        });
        res.json({ success: true });
    });

    app.post("/api/joinMatch", async (req, res) => {
        const { matchId, userId } = req.body;
        const match = await matches.findOne({ _id: new ObjectId(matchId) });
        const user = await users.findOne({ userId });

        if (!user || user.balance < match.entryFee) return res.status(400).json({ error: "ব্যালেন্স নেই, রিচার্জ করুন" });
        if (match.players.length >= match.mode) return res.status(400).json({ error: "ম্যাচটি ফুল হয়ে গেছে" });
        if (match.players.includes(userId)) return res.status(400).json({ error: "ইতিমধ্যেই জয়েন করেছেন" });

        await users.updateOne({ userId }, { $inc: { balance: -parseInt(match.entryFee) } });
        await matches.updateOne({ _id: new ObjectId(matchId) }, { $push: { players: userId } });
        res.json({ success: true });
    });

    // বাকি কমন এপিআই
    app.get("/api/settings", async (req, res) => { res.json(await settings.findOne({id:"config"}) || {}); });
    app.post("/api/updateSettings", async (req, res) => { await settings.updateOne({id:"config"},{$set:req.body},{upsert:true}); res.json({success:true}); });
    app.get("/api/balance", async (req, res) => { const u = await users.findOne({userId:req.query.userId}); res.json({balance: u?u.balance:0}); });
    app.post("/api/deposit", async (req, res) => { await transactions.insertOne({...req.body, status:"pending", date:new Date()}); res.json({success:true}); });
    app.get("/api/admin/requests", async (req, res) => { res.json(await transactions.find({status:"pending"}).toArray()); });
    app.post("/api/admin/approve", async (req, res) => {
        const r = await transactions.findOne({_id: new ObjectId(req.body.id)});
        if(r) {
            await transactions.updateOne({_id: new ObjectId(req.body.id)}, {$set:{status:"approved"}});
            await users.updateOne({userId: r.userId}, {$inc:{balance:parseInt(r.amount)}}, {upsert:true});
        }
        res.json({success:true});
    });

    io.on("connection", (socket) => {
        socket.on("joinRoom", (id) => socket.join(id));
        socket.on("rollDice", (d) => io.to(d.roomId).emit("diceRolled", d));
    });

    server.listen(process.env.PORT || 3000);
}
run();

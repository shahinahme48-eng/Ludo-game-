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

    // --- Lobby Logic (Fixed Join & Full) ---
    app.get("/api/getMatches", async (req, res) => {
        // শুধু ওপেন এবং প্লেয়ার পূর্ণ হয়নি এমন ম্যাচ দেখাবে
        const list = await matches.find({ status: "open" }).toArray();
        res.json(list);
    });

    app.post("/api/joinMatch", async (req, res) => {
        const { matchId, userId } = req.body;
        const match = await matches.findOne({ _id: new ObjectId(matchId) });
        const user = await users.findOne({ userId });

        if (!user || user.balance < match.entryFee) return res.status(400).json({ error: "ব্যালেন্স নেই" });
        if (match.players.length >= parseInt(match.mode)) return res.status(400).json({ error: "ম্যাচটি ইতিমধ্যে ফুল!" });
        if (match.players.includes(userId)) return res.status(400).json({ error: "ইতিমধ্যেই জয়েন করেছেন" });

        await users.updateOne({ userId }, { $inc: { balance: -parseInt(match.entryFee) } });
        await matches.updateOne({ _id: new ObjectId(matchId) }, { $push: { players: userId } });
        
        // যদি প্লেয়ার পূর্ণ হয়ে যায় তবে স্ট্যাটাস পরিবর্তন
        const updatedMatch = await matches.findOne({ _id: new ObjectId(matchId) });
        if (updatedMatch.players.length >= parseInt(updatedMatch.mode)) {
             await matches.updateOne({ _id: new ObjectId(matchId) }, { $set: { status: "playing" } });
        }

        res.json({ success: true });
    });

    // --- Admin & Wallet APIs (অপরিবর্তিত) ---
    app.post("/api/createMatch", async (req, res) => {
        await matches.insertOne({ ...req.body, players: [], status: "open", date: new Date() });
        res.json({ success: true });
    });
    app.get("/api/settings", async (req, res) => { res.json(await settings.findOne({id:"config"}) || {}); });
    app.post("/api/updateSettings", async (req, res) => { await settings.updateOne({id:"config"},{$set:req.body},{upsert:true}); res.json({success:true}); });
    app.get("/api/balance", async (req, res) => { const u = await users.findOne({userId:req.query.userId}); res.json({balance: u?u.balance:0}); });
    app.post("/api/deposit", async (req, res) => { await transactions.insertOne({...req.body, status:"pending", type:"deposit", date:new Date()}); res.json({success:true}); });
    app.post("/api/withdraw", async (req, res) => { await transactions.insertOne({...req.body, status:"pending", type:"withdraw", date:new Date()}); res.json({success:true}); });
    app.get("/api/admin/requests", async (req, res) => { res.json(await transactions.find({status:"pending"}).toArray()); });
    app.post("/api/admin/approve", async (req, res) => {
        const r = await transactions.findOne({_id: new ObjectId(req.body.id)});
        if(r && r.type === "deposit") await users.updateOne({userId: r.userId}, {$inc:{balance:parseInt(r.amount)}}, {upsert:true});
        await transactions.updateOne({_id: new ObjectId(req.body.id)}, {$set:{status:"approved"}});
        res.json({success:true});
    });

    server.listen(process.env.PORT || 3000);
}
run();

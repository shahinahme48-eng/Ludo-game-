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
    const transactions = db.collection("transactions");
    const settings = db.collection("settings");

    // --- টুর্নামেন্ট অটো-স্টার্ট ও লবি থেকে হাইড করা ---
    setInterval(async () => {
        const now = new Date();
        const currentTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka' });
        
        // যে ম্যাচের সময় হয়ে গেছে সেগুলোকে 'playing' স্ট্যাটাসে নেওয়া (যাতে লবিতে আর না দেখায়)
        await matches.updateMany(
            { status: "open", startTime: currentTime },
            { $set: { status: "playing" } }
        );
    }, 30000);

    // লবিতে শুধু 'open' ম্যাচগুলো দেখাবে
    app.get("/api/getMatches", async (req, res) => {
        const list = await matches.find({ status: "open" }).toArray();
        res.json(list);
    });

    // অ্যাডমিনের জন্য সব ম্যাচ (ডিলিট করার সুবিধার জন্য)
    app.get("/api/admin/allMatches", async (req, res) => {
        const list = await matches.find().sort({ date: -1 }).toArray();
        res.json(list);
    });

    // অ্যাডমিন ম্যাচ ডিলিট করার এপিআই
    app.post("/api/admin/deleteMatch", async (req, res) => {
        const { id } = req.body;
        await matches.deleteOne({ _id: new ObjectId(id) });
        res.json({ success: true });
    });

    // বাকি সব এপিআই (আগের মতো)
    app.post("/api/createMatch", async (req, res) => {
        await matches.insertOne({ ...req.body, players: [], status: "open", date: new Date() });
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

    app.get("/api/settings", async (req, res) => { const d = await settings.findOne({ id: "config" }); res.json(d || {}); });
    app.post("/api/updateSettings", async (req, res) => { await settings.updateOne({ id: "config" }, { $set: req.body }, { upsert: true }); res.json({ success: true }); });
    app.get("/api/balance", async (req, res) => { const u = await users.findOne({ userId: req.query.userId }); res.json({ balance: u ? u.balance : 0 }); });
    app.post("/api/deposit", async (req, res) => { await transactions.insertOne({ ...req.body, status: "pending", type: "deposit", date: new Date() }); res.json({ success: true }); });
    app.get("/api/admin/requests", async (req, res) => { const list = await transactions.find({ status: "pending" }).toArray(); res.json(list); });
    app.post("/api/admin/handleRequest", async (req, res) => {
        const { id, action } = req.body;
        const request = await transactions.findOne({ _id: new ObjectId(id) });
        if (action === "approve") {
            await transactions.updateOne({ _id: new ObjectId(id) }, { $set: { status: "approved" } });
            if (request.type === "deposit") await users.updateOne({ userId: request.userId }, { $inc: { balance: parseInt(request.amount) } }, { upsert: true });
        } else { await transactions.updateOne({ _id: new ObjectId(id) }, { $set: { status: "rejected" } }); }
        res.json({ success: true });
    });

    server.listen(process.env.PORT || 3000);
}
run();

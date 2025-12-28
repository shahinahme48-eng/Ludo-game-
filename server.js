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

    // --- পেমেন্ট রিকোয়েস্ট রিসিভ করা (ইউজার থেকে) ---
    app.post("/api/deposit", async (req, res) => {
        const { userId, amount, trxId } = req.body;
        await transactions.insertOne({ 
            userId, 
            amount: parseInt(amount), 
            trxId, 
            status: "pending", 
            type: "deposit", 
            date: new Date() 
        });
        res.json({ success: true });
    });

    // --- পেন্ডিং রিকোয়েস্ট পাঠানো (অ্যাডমিনের জন্য) ---
    app.get("/api/admin/requests", async (req, res) => {
        const list = await transactions.find({ status: "pending" }).toArray();
        res.json(list);
    });

    // --- অ্যাডমিন হ্যান্ডেল (Approve/Reject) ---
    app.post("/api/admin/handleRequest", async (req, res) => {
        const { id, action } = req.body;
        const request = await transactions.findOne({ _id: new ObjectId(id) });
        if (action === "approve") {
            await transactions.updateOne({ _id: new ObjectId(id) }, { $set: { status: "approved" } });
            if (request.type === "deposit") {
                await users.updateOne({ userId: request.userId }, { $inc: { balance: parseInt(request.amount) } }, { upsert: true });
            }
        } else {
            await transactions.updateOne({ _id: new ObjectId(id) }, { $set: { status: "rejected" } });
        }
        res.json({ success: true });
    });

    // বাকি সব রুট আগের মতোই থাকবে (Settings, Balance, Matches)
    app.get("/api/getMatches", async (req, res) => res.json(await matches.find({ status: "open" }).toArray()));
    app.get("/api/balance", async (req, res) => { const u = await users.findOne({ userId: req.query.userId }); res.json({ balance: u ? u.balance : 0 }); });
    app.get("/api/settings", async (req, res) => res.json(await settings.findOne({id:"config"}) || {bikash:"017XXXXXXXX"}));
    app.post("/api/updateSettings", async (req, res) => { await settings.updateOne({id:"config"},{$set:req.body},{upsert:true}); res.json({success:true}); });
    app.post("/api/createMatch", async (req, res) => { await matches.insertOne({ ...req.body, players: [], status: "open", date: new Date() }); res.json({ success: true }); });

    io.on("connection", (socket) => {
        socket.on("joinRoom", (id) => socket.join(id));
        socket.on("rollDice", (d) => io.to(d.roomId).emit("diceRolled", d));
    });

    server.listen(process.env.PORT || 3000);
}
run();

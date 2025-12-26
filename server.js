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

    // --- টুর্নামেন্ট লিস্ট এবং ডিলিট করার এপিআই ---
    app.get("/api/getMatches", async (req, res) => {
        // লবিতে শুধু খোলা টুর্নামেন্ট দেখাবে
        const list = await matches.find({ status: "open" }).toArray();
        res.json(list);
    });

    app.get("/api/admin/allMatches", async (req, res) => {
        // অ্যাডমিন প্যানেলের জন্য সব টুর্নামেন্ট
        const list = await matches.find().sort({ date: -1 }).toArray();
        res.json(list);
    });

    app.post("/api/admin/deleteMatch", async (req, res) => {
        const { id } = req.body;
        await matches.deleteOne({ _id: new ObjectId(id) });
        res.json({ success: true });
    });

    // টুর্নামেন্ট তৈরি (Admin)
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

    // পেমেন্ট অ্যাপ্রুভাল লজিক (Fixed)
    app.post("/api/admin/handleRequest", async (req, res) => {
        const { id, action } = req.body;
        const request = await transactions.findOne({ _id: new ObjectId(id) });
        if (action === "approve") {
            await transactions.updateOne({ _id: new ObjectId(id) }, { $set: { status: "approved" } });
            await users.updateOne({ userId: request.userId }, { $inc: { balance: parseInt(request.amount) } }, { upsert: true });
        } else {
            await transactions.updateOne({ _id: new ObjectId(id) }, { $set: { status: "rejected" } });
        }
        res.json({ success: true });
    });

    // বাকি কমন এপিআইগুলো (Settings, Balance, Deposit, etc.)
    app.get("/api/settings", async (req, res) => { res.json(await settings.findOne({id:"config"}) || {}); });
    app.post("/api/updateSettings", async (req, res) => { await settings.updateOne({id:"config"},{$set:req.body},{upsert:true}); res.json({success:true}); });
    app.get("/api/balance", async (req, res) => { const u = await users.findOne({userId:req.query.userId}); res.json({balance: u?u.balance:0}); });
    app.post("/api/deposit", async (req, res) => { await transactions.insertOne({...req.body, status:"pending", date:new Date()}); res.json({success:true}); });
    app.get("/api/admin/requests", async (req, res) => { res.json(await transactions.find({status:"pending"}).toArray()); });

    io.on("connection", (socket) => {
        socket.on("joinRoom", (id) => socket.join(id));
        socket.on("rollDice", (d) => io.to(d.roomId).emit("diceRolled", d));
    });

    server.listen(process.env.PORT || 3000);
}
run();

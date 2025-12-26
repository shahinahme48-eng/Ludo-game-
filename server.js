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

    // --- টুনামেন্ট জয়েনিং লজিক (নিখুঁত ফিক্স) ---
    app.post("/api/joinMatch", async (req, res) => {
        try {
            const { matchId, userId } = req.body;
            if (!matchId || !userId) return res.status(400).json({ error: "তথ্য অসম্পূর্ণ!" });

            const match = await matches.findOne({ _id: new ObjectId(matchId) });
            if (!match) return res.status(404).json({ error: "ম্যাচ খুঁজে পাওয়া যায়নি!" });

            const user = await users.findOne({ userId: userId });
            if (!user || user.balance < match.entryFee) {
                return res.status(400).json({ error: "ব্যালেন্স নেই, রিচার্জ করুন" });
            }

            if (match.players.includes(userId)) {
                return res.status(400).json({ error: "ইতিমধ্যেই জয়েন করেছেন" });
            }

            if (match.players.length >= match.mode) {
                return res.status(400).json({ error: "ম্যাচটি হাউজফুল!" });
            }

            // টাকা কেটে নেওয়া এবং প্লেয়ার লিস্টে নাম তোলা
            await users.updateOne({ userId: userId }, { $inc: { balance: -parseInt(match.entryFee) } });
            await matches.updateOne({ _id: new ObjectId(matchId) }, { $push: { players: userId } });

            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: "সার্ভার এরর: জয়েন করা যাচ্ছে না" });
        }
    });

    // --- টুর্নামেন্ট তৈরি (Admin) ---
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

    // --- টুর্নামেন্ট ডিলিট (Admin) ---
    app.post("/api/admin/deleteMatch", async (req, res) => {
        const { id } = req.body;
        await matches.deleteOne({ _id: new ObjectId(id) });
        res.json({ success: true });
    });

    // লবিতে পাঠানোর জন্য ডাটা
    app.get("/api/getMatches", async (req, res) => {
        const list = await matches.find({ status: "open" }).toArray();
        res.json(list);
    });

    // পেমেন্ট হ্যান্ডলিং
    app.post("/api/deposit", async (req, res) => {
        await transactions.insertOne({ ...req.body, status: "pending", date: new Date() });
        res.json({ success: true });
    });

    app.get("/api/balance", async (req, res) => {
        const user = await users.findOne({ userId: req.query.userId });
        res.json({ balance: user ? user.balance : 0 });
    });

    app.get("/api/settings", async (req, res) => {
        const data = await settings.findOne({ id: "config" });
        res.json(data || { bikash: "017XXXXXXXX" });
    });

    // সকেট কানেকশন
    io.on("connection", (socket) => {
        socket.on("joinRoom", (id) => socket.join(id));
        socket.on("rollDice", (d) => io.to(d.roomId).emit("diceRolled", d));
    });

    server.listen(process.env.PORT || 3000, () => console.log("Server Live"));
}
run();

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
    try {
        await client.connect();
        const db = client.db("ludocash");
        const matches = db.collection("matches");
        const users = db.collection("users");
        const settings = db.collection("settings");
        const transactions = db.collection("transactions");

        console.log("Connected to MongoDB");

        // --- সময় পরিষ্কার করার ফাংশন ---
        function normalizeTime(timeStr) {
            if (!timeStr) return "";
            return timeStr.replace(/[:\s\.]/g, '').replace(/^0+/, '').toUpperCase().trim();
        }

        // --- টুর্নামেন্ট অটো-মনিটর (প্রতি ১৫ সেকেন্ডে চেক) ---
        setInterval(async () => {
            const now = new Date();
            const bdTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Dhaka" }));
            
            const currentTimeRaw = bdTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            const currentTime = normalizeTime(currentTimeRaw);
            
            bdTime.setMinutes(bdTime.getMinutes() + 1);
            const oneMinLaterRaw = bdTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            const oneMinLater = normalizeTime(oneMinLaterRaw);

            const allOpenMatches = await matches.find({ status: "open" }).toArray();

            for (let m of allOpenMatches) {
                const matchTime = normalizeTime(m.startTime);

                // ১. ১ মিনিট আগের নোটিফিকেশন
                if (matchTime === oneMinLater) {
                    io.to(m._id.toString()).emit("oneMinWarning", { msg: "আপনার ম্যাচ ১ মিনিট পর শুরু হবে!" });
                }

                // ২. গেম স্টার্ট (সময় হওয়া মাত্র)
                if (matchTime === currentTime) {
                    if (m.players.length >= 2) {
                        await matches.updateOne({ _id: m._id }, { $set: { status: "playing" } });
                        io.to(m._id.toString()).emit("gameStartNow", { 
                            matchId: m._id.toString(), 
                            roomCode: m.roomCode,
                            prize: m.prize,
                            currentTurn: m.players[0]
                        });
                    } else {
                        // প্লেয়ার না থাকলে ম্যাচ বাতিল বা রিমুভ
                        await matches.updateOne({ _id: m._id }, { $set: { status: "expired" } });
                    }
                }
            }
        }, 15000);

        // --- ইউজার এবং ব্যালেন্স এপিআই ---
        app.get("/api/balance", async (req, res) => {
            const user = await users.findOne({ userId: req.query.userId });
            const referCount = await users.countDocuments({ referredBy: req.query.userId });
            res.json({ balance: user ? user.balance : 0, referClaimed: user ? user.referClaimed : false, referCount });
        });

        app.get("/api/settings", async (req, res) => {
            const data = await settings.findOne({ id: "config" });
            res.json(data || { bikash: "017XXXXXXXX", wa: "8801700000000", referBonus: 10 });
        });

        // --- টুর্নামেন্ট এপিআই (শক্তিশালী জয়েনিং) ---
        app.get("/api/getMatches", async (req, res) => {
            const list = await matches.find({ status: "open" }).toArray();
            res.json(list);
        });

        app.post("/api/joinMatch", async (req, res) => {
            const { matchId, userId } = req.body;
            try {
                const match = await matches.findOne({ _id: new ObjectId(matchId) });
                const user = await users.findOne({ userId });

                if (!user || user.balance < match.entryFee) return res.status(400).json({ error: "ব্যালেন্স পর্যাপ্ত নয়" });
                if (match.players.length >= match.mode) return res.status(400).json({ error: "ম্যাচটি হাউজফুল" });
                if (match.players.includes(userId)) return res.status(400).json({ error: "ইতিমধ্যেই জয়েন করেছেন" });

                await users.updateOne({ userId }, { $inc: { balance: -parseInt(match.entryFee) } });
                await matches.updateOne({ _id: new ObjectId(matchId) }, { $push: { players: userId } });
                res.json({ success: true });
            } catch (e) { res.status(500).json({ error: "Joining Error" }); }
        });

        // --- অ্যাডমিন এপিআই ---
        app.post("/api/createMatch", async (req, res) => {
            await matches.insertOne({ ...req.body, players: [], status: "open", date: new Date() });
            res.json({ success: true });
        });

        app.post("/api/admin/deleteMatch", async (req, res) => {
            const { id } = req.body;
            await matches.deleteOne({ _id: new ObjectId(id) });
            res.json({ success: true });
        });

        app.post("/api/updateSettings", async (req, res) => {
            await settings.updateOne({ id: "config" }, { $set: req.body }, { upsert: true });
            res.json({ success: true });
        });

        app.get("/api/admin/requests", async (req, res) => {
            const list = await transactions.find({ status: "pending" }).toArray();
            res.json(list);
        });

        app.get("/api/admin/users", async (req, res) => {
            const all = await users.find().toArray();
            const userList = await Promise.all(all.map(async (u) => {
                const count = await users.countDocuments({ referredBy: u.userId });
                return { userId: u.userId, balance: u.balance, referCount: count };
            }));
            res.json(userList);
        });

        app.post("/api/admin/handleRequest", async (req, res) => {
            const { id, action } = req.body;
            const r = await transactions.findOne({ _id: new ObjectId(id) });
            if (action === "approve") {
                await transactions.updateOne({ _id: new ObjectId(id) }, { $set: { status: "approved" } });
                if (r.type === "deposit") await users.updateOne({ userId: r.userId }, { $inc: { balance: parseInt(r.amount) } }, { upsert: true });
            } else {
                await transactions.updateOne({ _id: new ObjectId(id) }, { $set: { status: "rejected" } });
                if (r.type === "withdraw") await users.updateOne({ userId: r.userId }, { $inc: { balance: parseInt(r.amount) } });
            }
            res.json({ success: true });
        });

        // --- সকেট কানেকশন (মাল্টিপ্লেয়ার) ---
        io.on("connection", (socket) => {
            socket.on("joinRoom", (id) => socket.join(id));
            socket.on("rollDice", (d) => io.to(d.roomId).emit("diceRolled", d));
            socket.on("movePiece", (d) => io.to(d.roomId).emit("pieceMoved", d));
        });

        const PORT = process.env.PORT || 3000;
        server.listen(PORT, () => console.log("Server running on port " + PORT));
    } catch (error) {
        console.error("Critical Error:", error);
    }
}

run();

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
    const settings = db.collection("settings");
    const transactions = db.collection("transactions");

    // --- উন্নত টুর্নামেন্ট টাইম মনিটর ---
    setInterval(async () => {
        const now = new Date();
        // বাংলাদেশ সময় বের করা
        const bdTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Dhaka"}));
        let hours = bdTime.getHours();
        let minutes = bdTime.getMinutes();
        let ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12; // 0 কে 12 করা
        minutes = minutes < 10 ? '0'+minutes : minutes;
        
        // বর্তমান সময় ফরম্যাট (যেমন: 8:40 AM)
        const currentTime = hours + ":" + minutes + " " + ampm;

        // ১ মিনিট পরের সময় (নোটিফিকেশনের জন্য)
        let nextMin = new Date(bdTime.getTime() + 60000);
        let nHours = nextMin.getHours();
        let nMinutes = nextMin.getMinutes();
        let nAmpm = nHours >= 12 ? 'PM' : 'AM';
        nHours = nHours % 12; nHours = nHours ? nHours : 12;
        nMinutes = nMinutes < 10 ? '0'+nMinutes : nMinutes;
        const oneMinLater = nHours + ":" + nMinutes + " " + nAmpm;

        // ১ মিনিট আগে নোটিফিকেশন পাঠানো
        const upcoming = await matches.find({ status: "open", startTime: oneMinLater }).toArray();
        upcoming.forEach(m => {
            io.to(m._id.toString()).emit("oneMinWarning", { msg: "আপনার ম্যাচ ১ মিনিট পর শুরু হবে!" });
        });

        // টাইম হয়ে গেলে ম্যাচ স্টার্ট অথবা ডিলিট করা
        const matchesToStart = await matches.find({ status: "open", startTime: currentTime }).toArray();
        for (let m of matchesToStart) {
            if (m.players.length >= 2) {
                // ২ বা তার বেশি প্লেয়ার থাকলে গেম স্টার্ট
                await matches.updateOne({ _id: m._id }, { $set: { status: "playing" } });
                io.to(m._id.toString()).emit("gameStartNow", { matchId: m._id, roomCode: m.roomCode });
            } else {
                // পর্যাপ্ত প্লেয়ার না থাকলে লবি থেকে রিমুভ (টাকা রিফান্ড লজিক চাইলে পরে যোগ করা যাবে)
                await matches.updateOne({ _id: m._id }, { $set: { status: "cancelled" } });
                console.log("Match Cancelled due to lack of players: " + m._id);
            }
        }
    }, 20000); // প্রতি ২০ সেকেন্ডে চেক করবে

    // --- API Routes (অপরিবর্তিত) ---
    app.get("/api/settings", async (req, res) => { const d = await settings.findOne({ id: "config" }); res.json(d || {}); });
    app.post("/api/updateSettings", async (req, res) => { await settings.updateOne({ id: "config" }, { $set: req.body }, { upsert: true }); res.json({ success: true }); });
    app.get("/api/getMatches", async (req, res) => { const list = await matches.find({ status: "open" }).toArray(); res.json(list); });
    app.post("/api/createMatch", async (req, res) => { await matches.insertOne({ ...req.body, players: [], status: "open", date: new Date() }); res.json({ success: true }); });
    app.post("/api/joinMatch", async (req, res) => {
        const { matchId, userId } = req.body;
        const match = await matches.findOne({ _id: new ObjectId(matchId) });
        const user = await users.findOne({ userId });
        if (!user || user.balance < match.entryFee) return res.status(400).json({ error: "ব্যালেন্স নেই" });
        await users.updateOne({ userId }, { $inc: { balance: -parseInt(match.entryFee) } });
        await matches.updateOne({ _id: new ObjectId(matchId) }, { $push: { players: userId } });
        res.json({ success: true });
    });
    app.get("/api/balance", async (req, res) => { const u = await users.findOne({ userId: req.query.userId }); res.json({ balance: u ? u.balance : 0 }); });
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

    io.on("connection", (socket) => {
        socket.on("joinRoom", (id) => socket.join(id));
        socket.on("rollDice", (d) => io.to(d.roomId).emit("diceRolled", d));
    });

    server.listen(process.env.PORT || 3000);
}
run();

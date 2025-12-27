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

    // --- টুর্নামেন্ট মনিটর (Time Based Start) ---
    setInterval(async () => {
        const now = new Date();
        const bdTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Dhaka"}));
        const format = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase().replace(/\./g, '');
        const currentTime = format(bdTime);
        const oneMinLater = format(new Date(bdTime.getTime() + 60000));

        const upcoming = await matches.find({ status: "open", startTime: oneMinLater }).toArray();
        upcoming.forEach(m => io.to(m._id.toString()).emit("oneMinWarning", { msg: "ম্যাচ ১ মিনিট পর শুরু হবে!" }));

        const toStart = await matches.find({ status: "open", startTime: currentTime }).toArray();
        for (let m of toStart) {
            if (m.players.length >= 2) {
                await matches.updateOne({ _id: m._id }, { $set: { status: "playing" } });
                io.to(m._id.toString()).emit("gameStartNow", { matchId: m._id, roomCode: m.roomCode, prize: m.prize, currentTurn: m.players[0] });
            } else {
                await matches.updateOne({ _id: m._id }, { $set: { status: "expired" } });
            }
        }
    }, 15000);

    // APIs
    app.get("/api/settings", async (req, res) => res.json(await settings.findOne({ id: "config" }) || { bikash: "017XXXXXXXX", wa: "8801700000000" }));
    app.post("/api/updateSettings", async (req, res) => { await settings.updateOne({ id: "config" }, { $set: req.body }, { upsert: true }); res.json({ success: true }); });
    app.get("/api/balance", async (req, res) => { const u = await users.findOne({ userId: req.query.userId }); res.json({ balance: u ? u.balance : 0 }); });
    
    app.post("/api/transaction", async (req, res) => {
        const { userId, amount, type } = req.body;
        if (type === "withdraw") {
            const user = await users.findOne({ userId });
            if (!user || user.balance < amount) return res.status(400).json({ error: "ব্যালেন্স কম" });
            await users.updateOne({ userId }, { $inc: { balance: -parseInt(amount) } });
        }
        await transactions.insertOne({ ...req.body, status: "pending", date: new Date() });
        res.json({ success: true });
    });

    app.get("/api/getMatches", async (req, res) => res.json(await matches.find({ status: "open" }).toArray()));
    app.post("/api/createMatch", async (req, res) => { await matches.insertOne({ ...req.body, players: [], status: "open", date: new Date() }); res.json({ success: true }); });
    app.post("/api/joinMatch", async (req, res) => {
        const { matchId, userId, pass } = req.body;
        const match = await matches.findOne({ _id: new ObjectId(matchId) });
        if (match.roomPass !== pass) return res.status(400).json({ error: "ভুল পাসওয়ার্ড!" });
        await matches.updateOne({ _id: new ObjectId(matchId) }, { $addToSet: { players: userId } });
        res.json({ success: true });
    });

    app.get("/api/admin/requests", async (req, res) => res.json(await transactions.find({ status: "pending" }).toArray()));
    app.post("/api/admin/handleRequest", async (req, res) => {
        const { id, action } = req.body;
        const r = await transactions.findOne({ _id: new ObjectId(id) });
        if (action === "approve" && r.type === "deposit") {
            await users.updateOne({ userId: r.userId }, { $inc: { balance: parseInt(r.amount) } }, { upsert: true });
        } else if (action === "reject" && r.type === "withdraw") {
            await users.updateOne({ userId: r.userId }, { $inc: { balance: parseInt(r.amount) } });
        }
        await transactions.updateOne({ _id: new ObjectId(id) }, { $set: { status: action === "approve" ? "approved" : "rejected" } });
        res.json({ success: true });
    });

    io.on("connection", (socket) => {
        socket.on("joinRoom", (id) => socket.join(id));
        socket.on("rollDice", (d) => io.to(d.roomId).emit("diceRolled", d));
        socket.on("movePiece", (d) => io.to(d.roomId).emit("pieceMoved", d));
    });

    server.listen(process.env.PORT || 3000);
}
run();

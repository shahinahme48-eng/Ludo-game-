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

    function normalizeTime(t) {
        if(!t) return "";
        return t.replace(/[:\s\.]/g, '').replace(/^0+/, '').toUpperCase().trim();
    }

    // --- টুর্নামেন্ট টাইম মনিটর ---
    setInterval(async () => {
        const now = new Date();
        const bdTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Dhaka"}));
        const currentTime = normalizeTime(bdTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }));

        const openMatches = await matches.find({ status: "open" }).toArray();
        for (let m of openMatches) {
            if (normalizeTime(m.startTime) === currentTime) {
                if (m.players.length >= 2) {
                    await matches.updateOne({ _id: m._id }, { $set: { status: "playing" } });
                    io.to(m._id.toString()).emit("gameStartNow", { 
                        matchId: m._id.toString(), 
                        roomCode: m.roomCode,
                        prize: m.prize 
                    });
                } else {
                    await matches.updateOne({ _id: m._id }, { $set: { status: "expired" } });
                }
            }
        }
    }, 15000);

    // টুর্নামেন্ট তৈরি (Admin)
    app.post("/api/createMatch", async (req, res) => {
        const { entryFee, prize, mode, startTime, roomCode, roomPass } = req.body;
        await matches.insertOne({ 
            entryFee: parseInt(entryFee), 
            prize: parseInt(prize), 
            mode: parseInt(mode), 
            startTime, 
            roomCode, 
            roomPass, 
            players: [], 
            status: "open", 
            date: new Date() 
        });
        res.json({ success: true });
    });

    // টুর্নামেন্ট জয়েন (Password Check)
    app.post("/api/joinMatch", async (req, res) => {
        const { matchId, userId, pass } = req.body;
        const match = await matches.findOne({ _id: new ObjectId(matchId) });
        const user = await users.findOne({ userId });

        if (match.roomPass !== pass) return res.status(400).json({ error: "ভুল পাসওয়ার্ড!" });
        if (user.balance < match.entryFee) return res.status(400).json({ error: "ব্যালেন্স নেই" });
        if (match.players.length >= match.mode) return res.status(400).json({ error: "রুম ফুল" });

        await users.updateOne({ userId }, { $inc: { balance: -parseInt(match.entryFee) } });
        await matches.updateOne({ _id: new ObjectId(matchId) }, { $addToSet: { players: userId } });
        res.json({ success: true });
    });

    // লবি ডাটা
    app.get("/api/getMatches", async (req, res) => res.json(await matches.find({ status: "open" }).toArray()));
    app.get("/api/balance", async (req, res) => {
        const u = await users.findOne({ userId: req.query.userId });
        res.json({ balance: u ? u.balance : 0 });
    });

    // সকেট লজিক
    io.on("connection", (socket) => {
        socket.on("joinRoom", (id) => socket.join(id));
        socket.on("rollDice", (d) => io.to(d.roomId).emit("diceRolled", d));
        socket.on("movePiece", (d) => io.to(d.roomId).emit("pieceMoved", d));
    });

    server.listen(process.env.PORT || 3000);
}
run();

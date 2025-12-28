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

    // --- অটোমেটিক টাইম মনিটর (Bangladesh Time Fix) ---
    setInterval(async () => {
        const now = new Date();
        const bdTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Dhaka"}));
        const format = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase().replace(/\s/g, '');
        
        const currentTime = format(bdTime);
        const oneMinLater = format(new Date(bdTime.getTime() + 60000));

        // ১. ১ মিনিট আগের নোটিশ
        const upcoming = await matches.find({ status: "open" }).toArray();
        upcoming.forEach(m => {
            if(m.startTime.toUpperCase().replace(/\s/g, '') === oneMinLater) {
                io.to(m._id.toString()).emit("oneMinWarning", { msg: "ম্যাচ ১ মিনিট পর শুরু হবে!" });
            }
        });

        // ২. গেম স্টার্ট লজিক
        const toStart = await matches.find({ status: "open" }).toArray();
        for (let m of toStart) {
            if (m.startTime.toUpperCase().replace(/\s/g, '') === currentTime) {
                if (m.players.length >= 2) {
                    await matches.updateOne({ _id: m._id }, { $set: { status: "playing" } });
                    io.to(m._id.toString()).emit("gameStartNow", { 
                        matchId: m._id.toString(), 
                        roomCode: m.roomCode,
                        prize: m.prize,
                        currentTurn: m.players[0]
                    });
                } else {
                    await matches.updateOne({ _id: m._id }, { $set: { status: "expired" } });
                }
            }
        }
    }, 15000);

    // APIs
    app.get("/api/getMatches", async (req, res) => res.json(await matches.find({ status: "open" }).toArray()));
    app.post("/api/createMatch", async (req, res) => {
        await matches.insertOne({ ...req.body, players: [], status: "open", date: new Date() });
        res.json({ success: true });
    });
    app.post("/api/joinMatch", async (req, res) => {
        const { matchId, userId, pass } = req.body;
        const match = await matches.findOne({ _id: new ObjectId(matchId) });
        if (match.roomPass !== pass) return res.status(400).json({ error: "ভুল পাসওয়ার্ড!" });
        const user = await users.findOne({ userId });
        if (!user || user.balance < match.entryFee) return res.status(400).json({ error: "ব্যালেন্স নেই" });
        
        await users.updateOne({ userId }, { $inc: { balance: -parseInt(match.entryFee) } });
        await matches.updateOne({ _id: new ObjectId(matchId) }, { $addToSet: { players: userId } });
        res.json({ success: true });
    });
    app.get("/api/balance", async (req, res) => {
        const u = await users.findOne({ userId: req.query.userId });
        res.json({ balance: u ? u.balance : 0 });
    });

    // Multiplayer Socket
    io.on("connection", (socket) => {
        socket.on("joinRoom", (id) => socket.join(id));
        socket.on("rollDice", (d) => io.to(d.roomId).emit("diceRolled", d));
        socket.on("movePiece", (d) => io.to(d.roomId).emit("pieceMoved", d));
    });

    server.listen(process.env.PORT || 3000);
}
run();

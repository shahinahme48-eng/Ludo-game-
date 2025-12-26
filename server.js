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

    let roomTurns = {}; // প্রতিটি রুমের বর্তমান টার্ন সেভ রাখার জন্য

    // --- টুর্নামেন্ট মনিটর ---
    setInterval(async () => {
        const now = new Date();
        const bdTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Dhaka"}));
        const currentTime = bdTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase().replace(/\./g, '');

        const toStart = await matches.find({ status: "open", startTime: currentTime }).toArray();
        for (let m of toStart) {
            if (m.players.length >= 2) {
                await matches.updateOne({ _id: m._id }, { $set: { status: "playing" } });
                roomTurns[m._id.toString()] = 0; // প্রথম প্লেয়ারের টার্ন সেট করা
                io.to(m._id.toString()).emit("gameStartNow", { 
                    matchId: m._id.toString(), 
                    roomCode: m.roomCode,
                    players: m.players,
                    currentTurn: m.players[0]
                });
            }
        }
    }, 15000);

    // APIs
    app.get("/api/getMatches", async (req, res) => res.json(await matches.find({ status: "open" }).toArray()));
    app.post("/api/joinMatch", async (req, res) => {
        const { matchId, userId } = req.body;
        await matches.updateOne({ _id: new ObjectId(matchId) }, { $addToSet: { players: userId } });
        res.json({ success: true });
    });
    app.get("/api/balance", async (req, res) => {
        const u = await users.findOne({ userId: req.query.userId });
        res.json({ balance: u ? u.balance : 0 });
    });
    app.get("/api/settings", async (req, res) => res.json(await settings.findOne({id:"config"}) || {bikash:"017XXXXXXXX"}));

    // --- Multiplayer Socket Sync ---
    io.on("connection", (socket) => {
        socket.on("joinRoom", (id) => socket.join(id));

        socket.on("rollDice", (data) => {
            io.to(data.roomId).emit("diceRolled", data);
        });

        socket.on("movePiece", async (data) => {
            const match = await matches.findOne({ _id: new ObjectId(data.roomId) });
            if(!match) return;

            // টার্ন পরিবর্তন লজিক (৬ না পড়লে টার্ন বদলাবে)
            let nextTurnPlayer = data.player; 
            if (data.diceValue !== 6) {
                let currentIndex = match.players.indexOf(data.player);
                let nextIndex = (currentIndex + 1) % match.players.length;
                nextTurnPlayer = match.players[nextIndex];
            }

            io.to(data.roomId).emit("pieceMoved", {
                ...data,
                nextTurn: nextTurnPlayer
            });
        });
    });

    server.listen(process.env.PORT || 3000);
}
run();

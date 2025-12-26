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

    // --- টুর্নামেন্ট স্টার্ট ডিটেক্টর ---
    setInterval(async () => {
        const now = new Date();
        const bdTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Dhaka"}));
        const currentTime = bdTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase().replace(/\./g, '');

        const toStart = await matches.find({ status: "open", startTime: currentTime }).toArray();
        for (let m of toStart) {
            if (m.players.length >= 2) {
                await matches.updateOne({ _id: m._id }, { $set: { status: "playing" } });
                io.to(m._id.toString()).emit("gameStartNow", { 
                    matchId: m._id.toString(), 
                    roomCode: m.roomCode, 
                    prize: m.prize,
                    players: m.players,
                    currentTurn: m.players[0] // প্রথম প্লেয়ারের চাল
                });
            }
        }
    }, 15000);

    // --- APIs ---
    app.get("/api/getMatches", async (req, res) => res.json(await matches.find({ status: "open" }).toArray()));
    app.post("/api/createMatch", async (req, res) => { await matches.insertOne({ ...req.body, players: [], status: "open", date: new Date() }); res.json({ success: true }); });
    app.post("/api/joinMatch", async (req, res) => {
        const { matchId, userId, fee } = req.body;
        const user = await users.findOne({ userId });
        if (user.balance < fee) return res.status(400).json({ error: "ব্যালেন্স নেই" });
        await users.updateOne({ userId }, { $inc: { balance: -parseInt(fee) } });
        await matches.updateOne({ _id: new ObjectId(matchId) }, { $addToSet: { players: userId } });
        res.json({ success: true });
    });
    app.get("/api/balance", async (req, res) => { const u = await users.findOne({ userId: req.query.userId }); res.json({ balance: u ? u.balance : 0 }); });
    app.get("/api/settings", async (req, res) => res.json(await settings.findOne({id:"config"}) || {bikash:"017XXXXXXXX"}));
    app.post("/api/updateSettings", async (req, res) => { await settings.updateOne({id:"config"},{$set:req.body},{upsert:true}); res.json({success:true}); });

    // --- সকেট কানেকশন (টার্ন এবং মুভমেন্ট) ---
    io.on("connection", (socket) => {
        socket.on("joinRoom", (id) => socket.join(id));
        
        socket.on("rollDice", (d) => io.to(d.roomId).emit("diceRolled", d));

        socket.on("movePiece", async (data) => {
            // টার্ন পরিবর্তন লজিক (৬ না পড়লে টার্ন বদলাবে)
            let match = await matches.findOne({ _id: new ObjectId(data.roomId) });
            let nextPlayer = data.userId;
            if (data.dice !== 6) {
                let idx = match.players.indexOf(data.userId);
                nextPlayer = match.players[(idx + 1) % match.players.length];
            }
            io.to(data.roomId).emit("pieceMoved", { ...data, nextTurn: nextPlayer });
        });

        // বিজয়ী ঘোষণা এবং টাকা প্রদান
        socket.on("declareWinner", async (data) => {
            const { userId, prize, roomId } = data;
            await users.updateOne({ userId }, { $inc: { balance: parseInt(prize) } });
            await matches.updateOne({ _id: new ObjectId(roomId) }, { $set: { status: "finished" } });
            io.to(roomId).emit("gameOver", { winner: userId, prize });
        });
    });

    server.listen(process.env.PORT || 3000);
}
run();

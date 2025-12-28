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

    // সকেট কানেকশন (টার্ন এবং মুভমেন্ট সিঙ্ক)
    io.on("connection", (socket) => {
        socket.on("joinRoom", (id) => socket.join(id));

        socket.on("rollDice", (data) => {
            io.to(data.roomId).emit("diceRolled", data);
        });

        socket.on("movePiece", async (data) => {
            const match = await matches.findOne({ _id: new ObjectId(data.roomId) });
            let nextPlayer = data.userId;

            // ৬ না পড়লে পরবর্তী প্লেয়ারের টার্ন আসবে
            if (data.diceValue !== 6) {
                const players = match.players;
                let currentIndex = players.indexOf(data.userId);
                nextPlayer = players[(currentIndex + 1) % players.length];
            }
            
            io.to(data.roomId).emit("pieceMoved", { ...data, nextTurn: nextPlayer });
        });
    });

    // বাকি লবি এবং ব্যালেন্স এপিআই আগের মতোই থাকবে...
    app.get("/api/getMatches", async (req, res) => res.json(await matches.find({ status: "open" }).toArray()));
    app.post("/api/createMatch", async (req, res) => { await matches.insertOne({ ...req.body, players: [], status: "open", date: new Date() }); res.json({ success: true }); });
    app.get("/api/balance", async (req, res) => { const u = await users.findOne({ userId: req.query.userId }); res.json({ balance: u ? u.balance : 0 }); });
    app.post("/api/joinMatch", async (req, res) => {
        const { matchId, userId, fee } = req.body;
        await users.updateOne({ userId }, { $inc: { balance: -parseInt(fee) } });
        await matches.updateOne({ _id: new ObjectId(matchId) }, { $addToSet: { players: userId } });
        res.json({ success: true });
    });

    server.listen(process.env.PORT || 3000);
}
run();

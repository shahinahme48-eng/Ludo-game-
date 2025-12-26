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

    // লবি এবং টুর্নামেন্ট এপিআই
    app.get("/api/getMatches", async (req, res) => {
        const list = await matches.find({ status: "open" }).toArray();
        res.json(list);
    });

    app.post("/api/joinMatch", async (req, res) => {
        const { matchId, userId } = req.body;
        const match = await matches.findOne({ _id: new ObjectId(matchId) });
        if (match.players.length >= match.mode) return res.status(400).json({ error: "ম্যাচ ফুল!" });
        
        await matches.updateOne({ _id: new ObjectId(matchId) }, { $push: { players: userId } });
        
        // যদি প্লেয়ার পূর্ণ হয়, গেম শুরু হবে
        if (match.players.length + 1 == match.mode) {
            await matches.updateOne({ _id: new ObjectId(matchId) }, { $set: { status: "playing" } });
            io.to(matchId).emit("gameStarted", { players: [...match.players, userId] });
        }
        res.json({ success: true });
    });

    // কমন এপিআই (ওয়ালেট ও সেটিংস)
    app.get("/api/balance", async (req, res) => {
        const user = await users.findOne({ userId: req.query.userId });
        res.json({ balance: user ? user.balance : 0 });
    });
    app.get("/api/settings", async (req, res) => {
        res.json(await settings.findOne({id:"config"}) || {});
    });

    // সকেট কানেকশন (চাল আদান-প্রদান)
    io.on("connection", (socket) => {
        socket.on("joinRoom", (id) => socket.join(id));
        
        socket.on("rollDice", (data) => {
            const roll = Math.floor(Math.random() * 6) + 1;
            io.to(data.roomId).emit("diceRolled", { ...data, roll });
        });

        socket.on("moveGuti", (data) => {
            io.to(data.roomId).emit("gutiMoved", data);
        });
    });

    server.listen(process.env.PORT || 3000);
}
run();

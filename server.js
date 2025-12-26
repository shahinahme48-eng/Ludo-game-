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

    // --- API Routes ---
    app.get("/api/settings", async (req, res) => {
        const data = await settings.findOne({ id: "config" });
        res.json(data || { bikash: "017XXXXXXXX", referBonus: 10 });
    });

    app.get("/api/balance", async (req, res) => {
        const user = await users.findOne({ userId: req.query.userId });
        res.json({ balance: user ? user.balance : 0 });
    });

    app.post("/api/createMatch", async (req, res) => {
        await matches.insertOne({ ...req.body, players: [], status: "open", date: new Date() });
        res.json({ success: true });
    });

    app.get("/api/getMatches", async (req, res) => {
        const list = await matches.find({ status: "open" }).toArray();
        res.json(list);
    });

    // --- Multiplayer & Turn Management ---
    let gameStates = {};

    io.on("connection", (socket) => {
        socket.on("joinRoom", (roomId) => {
            socket.join(roomId);
            if (!gameStates[roomId]) {
                gameStates[roomId] = { turnIndex: 0, players: [] };
            }
        });

        socket.on("rollDice", (data) => {
            io.to(data.roomId).emit("diceRolled", { ...data, socketId: socket.id });
        });

        socket.on("movePiece", (data) => {
            io.to(data.roomId).emit("pieceMoved", data);
        });

        // গুটি কাটা গেলে মেসেজ পাঠানো
        socket.on("killNotification", (data) => {
            io.to(data.roomId).emit("showToast", { msg: data.msg });
        });

        // অটোমেটিক উইনার এবং টাকা ট্রান্সফার
        socket.on("declareWinner", async (data) => {
            const { userId, prize, roomId } = data;
            await users.updateOne({ userId }, { $inc: { balance: parseInt(prize) } });
            await matches.updateOne({ _id: new ObjectId(roomId) }, { $set: { status: "finished", winner: userId } });
            io.to(roomId).emit("gameOver", { winner: userId, prize });
        });
    });

    server.listen(process.env.PORT || 3000);
}
run();

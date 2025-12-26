const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { MongoClient, ObjectId } = require("mongodb");
const cors = require("cors");

const app = express();

// এই অংশটি সব ওয়েবসাইট থেকে কানেকশন নেওয়ার অনুমতি দিবে
app.use(cors({
    origin: "*",
    methods: ["GET", "POST"]
}));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function run() {
    try {
        await client.connect();
        const db = client.db("ludocash");
        const users = db.collection("users");
        const settings = db.collection("settings");
        const transactions = db.collection("transactions");
        const matches = db.collection("matches");

        // --- API Routes ---
        app.get("/", (req, res) => res.send("Ludo Server is Running Live!"));

        app.get("/api/settings", async (req, res) => {
            const data = await settings.findOne({ id: "config" });
            res.json(data || { bikash: "017XXXXXXXX", wa: "8801700000000", referBonus: 10 });
        });

        app.post("/api/updateSettings", async (req, res) => {
            await settings.updateOne({ id: "config" }, { $set: req.body }, { upsert: true });
            res.json({ success: true });
        });

        app.get("/api/balance", async (req, res) => {
            const user = await users.findOne({ userId: req.query.userId });
            res.json({ balance: user ? user.balance : 0 });
        });

        app.post("/api/deposit", async (req, res) => {
            await transactions.insertOne({ ...req.body, status: "pending", date: new Date() });
            res.json({ success: true });
        });

        app.get("/api/getMatches", async (req, res) => {
            const list = await matches.find({ status: "open" }).toArray();
            res.json(list);
        });

        // --- Multiplayer Socket ---
        io.on("connection", (socket) => {
            socket.on("joinRoom", (id) => socket.join(id));
            socket.on("rollDice", (d) => io.to(d.roomId).emit("diceRolled", d));
        });

        const PORT = process.env.PORT || 3000;
        server.listen(PORT, () => console.log("Server Running on " + PORT));
    } catch (e) {
        console.error("Database Error:", e);
    }
}
run();

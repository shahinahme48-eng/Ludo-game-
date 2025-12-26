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

    // --- সময় নরমাল করার ফাংশন ---
    function cleanTime(t) {
        return t.replace(/[:\s\.]/g, '').toUpperCase();
    }

    // --- টুর্নামেন্ট অটো-মনিটর (প্রতি ১০ সেকেন্ডে চেক) ---
    setInterval(async () => {
        const now = new Date();
        const bdTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Dhaka"}));
        
        const currentT = bdTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const currentClean = cleanTime(currentT);

        // ১ মিনিট পরের সময় (নোটিফিকেশনের জন্য)
        bdTime.setMinutes(bdTime.getMinutes() + 1);
        const nextT = bdTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const nextClean = cleanTime(nextT);

        const allMatches = await matches.find({ status: "open" }).toArray();

        for (let m of allMatches) {
            const matchClean = cleanTime(m.startTime);

            // ১. নোটিফিকেশন (১ মিনিট আগে)
            if (matchClean === nextClean) {
                io.to(m._id.toString()).emit("oneMinWarning", { msg: "আপনার ম্যাচ ১ মিনিট পর শুরু হবে!" });
            }

            // ২. গেম স্টার্ট (বর্তমান সময় >= ম্যাচের সময় এবং প্লেয়ার ২ জন)
            if (matchClean === currentClean) {
                if (m.players.length >= 2) {
                    await matches.updateOne({ _id: m._id }, { $set: { status: "playing" } });
                    io.to(m._id.toString()).emit("gameStartNow", { matchId: m._id.toString(), roomCode: m.roomCode });
                    console.log("Match Started: " + m.startTime);
                } else {
                    // যদি সময় হয়ে যায় কিন্তু ২ জন না থাকে, তবে ম্যাচ বাতিল/রিমুভ
                    await matches.updateOne({ _id: m._id }, { $set: { status: "expired" } });
                }
            }
        }
    }, 10000);

    // APIs
    app.get("/api/getMatches", async (req, res) => res.json(await matches.find({ status: "open" }).toArray()));
    app.post("/api/createMatch", async (req, res) => {
        await matches.insertOne({ ...req.body, players: [], status: "open", date: new Date() });
        res.json({ success: true });
    });
    app.post("/api/joinMatch", async (req, res) => {
        const { matchId, userId } = req.body;
        const match = await matches.findOne({ _id: new ObjectId(matchId) });
        if (match.players.length >= match.mode) return res.status(400).json({ error: "ম্যাচ ফুল!" });
        await users.updateOne({ userId }, { $inc: { balance: -parseInt(match.entryFee) } });
        await matches.updateOne({ _id: new ObjectId(matchId) }, { $push: { players: userId } });
        res.json({ success: true });
    });
    app.get("/api/balance", async (req, res) => {
        const u = await users.findOne({ userId: req.query.userId });
        res.json({ balance: u ? u.balance : 0 });
    });
    app.get("/api/settings", async (req, res) => res.json(await settings.findOne({id:"config"}) || {bikash:"017XXXXXXXX"}));
    app.post("/api/updateSettings", async (req, res) => { await settings.updateOne({id:"config"},{$set:req.body},{upsert:true}); res.json({success:true}); });
    app.get("/api/admin/requests", async (req, res) => res.json(await transactions.find({status:"pending"}).toArray()));
    app.post("/api/admin/approve", async (req, res) => {
        const r = await transactions.findOne({_id: new ObjectId(req.body.id)});
        if(r) {
            await transactions.updateOne({_id: new ObjectId(req.body.id)}, {$set:{status:"approved"}});
            await users.updateOne({userId: r.userId}, {$inc:{balance:parseInt(r.amount)}}, {upsert:true});
        }
        res.json({success:true});
    });

    io.on("connection", (socket) => {
        socket.on("joinRoom", (id) => {
            socket.join(id);
            console.log("Joined Room: " + id);
        });
        socket.on("rollDice", (d) => io.to(d.roomId).emit("diceRolled", d));
    });

    server.listen(process.env.PORT || 3000);
}
run();

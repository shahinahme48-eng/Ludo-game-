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

    // --- Deposit & Withdraw APIs ---
    app.post("/api/deposit", async (req, res) => {
        await transactions.insertOne({ ...req.body, status: "pending", type: "deposit", date: new Date() });
        res.json({ success: true });
    });

    app.post("/api/withdraw", async (req, res) => {
        const { userId, amount, phone } = req.body;
        const user = await users.findOne({ userId });
        if (!user || user.balance < amount) return res.status(400).json({ error: "পর্যাপ্ত ব্যালেন্স নেই!" });

        // উইথড্র রিকোয়েস্ট করার সাথে সাথে ইউজারের ব্যালেন্স কেটে নেওয়া হচ্ছে
        await users.updateOne({ userId }, { $inc: { balance: -parseInt(amount) } });
        await transactions.insertOne({ userId, amount: parseInt(amount), phone, status: "pending", type: "withdraw", date: new Date() });
        res.json({ success: true });
    });

    // --- Admin Handling (Approve/Reject) ---
    app.post("/api/admin/handleRequest", async (req, res) => {
        const { id, action } = req.body;
        const request = await transactions.findOne({ _id: new ObjectId(id) });
        if (!request) return res.status(404).send("Not found");

        if (action === "approve") {
            await transactions.updateOne({ _id: new ObjectId(id) }, { $set: { status: "approved" } });
            // যদি ডিপোজিট হয়, তবেই ব্যালেন্সে টাকা যোগ হবে
            if (request.type === "deposit") {
                await users.updateOne({ userId: request.userId }, { $inc: { balance: parseInt(request.amount) } }, { upsert: true });
            }
        } else if (action === "reject") {
            await transactions.updateOne({ _id: new ObjectId(id) }, { $set: { status: "rejected" } });
            // যদি উইথড্র রিজেক্ট হয়, তবে ইউজারের টাকা রিফান্ড/ফেরত দিতে হবে
            if (request.type === "withdraw") {
                await users.updateOne({ userId: request.userId }, { $inc: { balance: parseInt(request.amount) } });
            }
        }
        res.json({ success: true });
    });

    // বাকি লবি এবং সেটিংস এপিআই (আগের মতো)
    app.get("/api/settings", async (req, res) => { const d = await settings.findOne({ id: "config" }); res.json(d || {}); });
    app.post("/api/updateSettings", async (req, res) => { await settings.updateOne({ id: "config" }, { $set: req.body }, { upsert: true }); res.json({ success: true }); });
    app.get("/api/balance", async (req, res) => { const u = await users.findOne({ userId: req.query.userId }); res.json({ balance: u ? u.balance : 0 }); });
    app.get("/api/admin/requests", async (req, res) => { const list = await transactions.find({ status: "pending" }).toArray(); res.json(list); });

    server.listen(process.env.PORT || 3000);
}
run();

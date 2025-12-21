const io = require("socket.io")(process.env.PORT || 3000, {
  cors: { origin: "*" }
});

let rooms = {};

io.on("connection", (socket) => {
  console.log("A player connected:", socket.id);

  // রুম জয়েন করা
  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);
    if (!rooms[roomId]) rooms[roomId] = { players: [] };
    if (!rooms[roomId].players.includes(socket.id)) {
        rooms[roomId].players.push(socket.id);
    }
    io.to(roomId).emit("playerJoined", rooms[roomId].players.length);
  });

  // ডাইস রোল সিঙ্ক করা
  socket.on("rollDice", (data) => {
    io.to(data.roomId).emit("diceRolled", {
      value: data.value,
      player: socket.id
    });
  });

  // গুটি মুভমেন্ট সিঙ্ক করা
  socket.on("movePiece", (data) => {
    socket.to(data.roomId).emit("pieceMoved", data);
  });

  // চ্যাট মেসেজ সিঙ্ক করা
  socket.on("chat", (data) => {
    io.to(data.roomId).emit("newChat", data);
  });

  socket.on("disconnect", () => {
    console.log("Player disconnected");
  });
});

console.log("Multiplayer Server running on port 3000");

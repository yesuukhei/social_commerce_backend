const socketIo = require("socket.io");

let io;

module.exports = {
  init: (server) => {
    io = socketIo(server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
      },
    });

    io.on("connection", (socket) => {
      console.log("🔌 User connected to socket:", socket.id);

      socket.on("join-conversation", (conversationId) => {
        socket.join(conversationId);
        console.log(
          `👤 Socket ${socket.id} joined conversation: ${conversationId}`,
        );
      });

      socket.on("leave-conversation", (conversationId) => {
        socket.leave(conversationId);
        console.log(
          `👤 Socket ${socket.id} left conversation: ${conversationId}`,
        );
      });

      socket.on("disconnect", () => {
        console.log("🔌 User disconnected from socket");
      });
    });

    return io;
  },
  getIO: () => {
    if (!io) {
      throw new Error("Socket.io not initialized!");
    }
    return io;
  },
};

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const roomHandler_1 = require("./handlers/roomHandler");
const webrtcHandler_1 = require("./handlers/webrtcHandler");
const cinemaHandler_1 = require("./handlers/cinemaHandler");
const guessNumberHandler_1 = require("./handlers/guessNumberHandler");
const drawGuessHandler_1 = require("./handlers/drawGuessHandler");
const wordChainHandler_1 = require("./handlers/wordChainHandler");
const bombDefusalHandler_1 = require("./handlers/bombDefusalHandler");
const detectiveCaricatureHandler_1 = require("./handlers/detectiveCaricatureHandler");
const photoboothHandler_1 = require("./handlers/photoboothHandler");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
// Resolve static dist path dynamically based on build output directory structure
let frontendDist = path_1.default.resolve(__dirname, "../../frontend/dist");
if (!fs_1.default.existsSync(frontendDist)) {
    frontendDist = path_1.default.resolve(__dirname, "../frontend/dist");
}
console.log(`[STATIC SERVE] Serving frontend assets from: ${frontendDist}`);
app.use(express_1.default.static(frontendDist));
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});
const rooms = {};
const roomTimers = {};
function stopRoomTimer(roomCode) {
    if (roomTimers[roomCode]) {
        clearInterval(roomTimers[roomCode]);
        delete roomTimers[roomCode];
    }
}
io.on("connection", (socket) => {
    console.log(`[CONNECTED] Client connected: ${socket.id}`);
    // Universal Start Game Handler
    socket.on("start_game", ({ roomCode, game }) => {
        const room = rooms[roomCode];
        if (!room)
            return;
        stopRoomTimer(roomCode);
        room.currentGame = game;
        if (game === "guess_number") {
            room.gameData = {
                status: "setup",
                p1Secret: null,
                p2Secret: null,
                p1Guesses: [],
                p2Guesses: [],
            };
        }
        else if (game === "draw_guess") {
            room.gameData = {
                status: "select_theme",
                theme: null,
                drawerId: null,
                word: null,
                winner: null,
                reason: "",
            };
        }
        console.log(`[GAME STARTED] Game "${game}" started in room ${roomCode}`);
        io.to(roomCode).emit("game_started", room);
    });
    // Register Modular Handlers
    (0, roomHandler_1.registerRoomHandlers)(io, socket, rooms, stopRoomTimer);
    (0, webrtcHandler_1.registerWebRTCHandlers)(io, socket, rooms);
    (0, cinemaHandler_1.registerCinemaHandlers)(io, socket);
    (0, guessNumberHandler_1.registerGuessNumberHandlers)(io, socket, rooms);
    (0, drawGuessHandler_1.registerDrawGuessHandlers)(io, socket, rooms, roomTimers, stopRoomTimer);
    (0, wordChainHandler_1.registerWordChainHandlers)(io, socket, rooms);
    (0, bombDefusalHandler_1.registerBombDefusalHandlers)(io, socket, rooms);
    (0, detectiveCaricatureHandler_1.registerDetectiveCaricatureHandlers)(io, socket, rooms);
    (0, photoboothHandler_1.registerPhotoBoothHandlers)(io, socket);
});
// Wildcard fallback to serve index.html for client-side routing
app.get("*", (req, res) => {
    const indexPath = path_1.default.join(frontendDist, "index.html");
    if (fs_1.default.existsSync(indexPath)) {
        res.sendFile(indexPath);
    }
    else {
        res.status(404).send(`Frontend assets not found at: ${frontendDist}`);
    }
});
const PORT = Number(process.env.PORT) || 3001;
server.listen(PORT, () => {
    console.log(`\n🚀 Server running at http://localhost:${PORT}\n`);
});

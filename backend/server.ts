import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import fs from "fs";

import { Room } from "./handlers/types";
import { registerRoomHandlers } from "./handlers/roomHandler";
import { registerWebRTCHandlers } from "./handlers/webrtcHandler";
import { registerCinemaHandlers } from "./handlers/cinemaHandler";
import { registerGuessNumberHandlers } from "./handlers/guessNumberHandler";
import { registerDrawGuessHandlers } from "./handlers/drawGuessHandler";
import { registerWordChainHandlers } from "./handlers/wordChainHandler";
import { registerBombDefusalHandlers } from "./handlers/bombDefusalHandler";
import { registerDetectiveCaricatureHandlers } from "./handlers/detectiveCaricatureHandler";

const app = express();
app.use(cors());

// Resolve static dist path dynamically based on build output directory structure
let frontendDist = path.resolve(__dirname, "../../frontend/dist");
if (!fs.existsSync(frontendDist)) {
    frontendDist = path.resolve(__dirname, "../frontend/dist");
}

console.log(`[STATIC SERVE] Serving frontend assets from: ${frontendDist}`);
app.use(express.static(frontendDist));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

const rooms: Record<string, Room> = {};
const roomTimers: Record<string, NodeJS.Timeout> = {};

function stopRoomTimer(roomCode: string) {
    if (roomTimers[roomCode]) {
        clearInterval(roomTimers[roomCode]);
        delete roomTimers[roomCode];
    }
}

io.on("connection", (socket) => {
    console.log(`[CONNECTED] Client connected: ${socket.id}`);

    // Universal Start Game Handler
    socket.on("start_game", ({ roomCode, game }: { roomCode: string; game: string }) => {
        const room = rooms[roomCode];
        if (!room) return;

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
        } else if (game === "draw_guess") {
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
    registerRoomHandlers(io, socket, rooms, stopRoomTimer);
    registerWebRTCHandlers(io, socket, rooms);
    registerCinemaHandlers(io, socket);
    registerGuessNumberHandlers(io, socket, rooms);
    registerDrawGuessHandlers(io, socket, rooms, roomTimers, stopRoomTimer);
    registerWordChainHandlers(io, socket, rooms);
    registerBombDefusalHandlers(io, socket, rooms);
    registerDetectiveCaricatureHandlers(io, socket, rooms);
});

// Wildcard fallback to serve index.html for client-side routing
app.get("*", (req, res) => {
    const indexPath = path.join(frontendDist, "index.html");
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send(`Frontend assets not found at: ${frontendDist}`);
    }
});

const PORT = Number(process.env.PORT) || 3001;
server.listen(PORT, () => {
    console.log(`\n🚀 Server running at http://localhost:${PORT}\n`);
});
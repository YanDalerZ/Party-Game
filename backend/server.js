"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});
const rooms = {};
const roomTimers = {};
// Words database for Draw & Guess
const WORD_LISTS = {
    animal: ["lion", "cat", "dog", "elephant", "penguin", "monkey", "giraffe", "dolphin", "tiger", "bear"],
    thing: ["car", "computer", "phone", "guitar", "clock", "house", "table", "rocket", "airplane", "camera"],
    person: ["doctor", "pilot", "ninja", "chef", "teacher", "king", "detective", "astronaut", "pirate", "artist"],
};
function stopRoomTimer(roomCode) {
    if (roomTimers[roomCode]) {
        clearInterval(roomTimers[roomCode]);
        delete roomTimers[roomCode];
    }
}
io.on("connection", (socket) => {
    console.log(`[CONNECTED] Client connected: ${socket.id}`);
    // Create Room
    socket.on("create_room", (playerName) => {
        const code = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[code] = {
            code,
            players: [{ id: socket.id, name: playerName }],
            currentGame: null,
            gameData: null,
        };
        socket.join(code);
        console.log(`[ROOM CREATED] Code: ${code} by ${playerName} (${socket.id})`);
        socket.emit("room_created", rooms[code]);
    });
    // Join Room
    socket.on("join_room", ({ roomCode, playerName }) => {
        const room = rooms[roomCode === null || roomCode === void 0 ? void 0 : roomCode.toUpperCase()];
        if (!room) {
            console.log(`[JOIN ERROR] Room ${roomCode} not found for ${playerName}`);
            return socket.emit("error_message", "Room not found!");
        }
        if (room.players.length >= 2) {
            console.log(`[JOIN ERROR] Room ${roomCode} full for ${playerName}`);
            return socket.emit("error_message", "Room is full!");
        }
        room.players.push({ id: socket.id, name: playerName });
        socket.join(room.code);
        console.log(`[ROOM JOINED] ${playerName} (${socket.id}) joined ${room.code}`);
        io.to(room.code).emit("room_updated", room);
    });
    // Start Game
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
    // ==========================================
    // GAME 1: GUESS THE NUMBER HANDLERS
    // ==========================================
    socket.on("g1_set_secret", ({ roomCode, secret }) => {
        const room = rooms[roomCode];
        if (!room || room.currentGame !== "guess_number")
            return;
        const isP1 = room.players[0].id === socket.id;
        if (isP1) {
            room.gameData.p1Secret = secret;
        }
        else {
            room.gameData.p2Secret = secret;
        }
        if (room.gameData.p1Secret !== null && room.gameData.p2Secret !== null) {
            room.gameData.status = "playing";
        }
        io.to(roomCode).emit("g1_updated", room.gameData);
    });
    socket.on("g1_guess", ({ roomCode, guess }) => {
        var _a;
        const room = rooms[roomCode];
        if (!room || room.currentGame !== "guess_number")
            return;
        const isP1 = room.players[0].id === socket.id;
        const myGuesses = isP1 ? room.gameData.p1Guesses : room.gameData.p2Guesses;
        const oppSecret = isP1 ? room.gameData.p2Secret : room.gameData.p1Secret;
        myGuesses.push(guess);
        if (guess === oppSecret) {
            room.gameData.status = "gameover";
            const winnerName = (_a = room.players.find((p) => p.id === socket.id)) === null || _a === void 0 ? void 0 : _a.name;
            room.gameData.reason = `${winnerName} guessed the correct number (${oppSecret})!`;
        }
        else if (room.gameData.p1Guesses.length >= 10 && room.gameData.p2Guesses.length >= 10) {
            room.gameData.status = "gameover";
            room.gameData.reason = "Both players ran out of tries! It's a draw!";
        }
        io.to(roomCode).emit("g1_updated", room.gameData);
    });
    // ==========================================
    // GAME 2: DRAW & GUESS HANDLERS
    // ==========================================
    socket.on("g2_select_theme", ({ roomCode, theme }) => {
        const room = rooms[roomCode];
        if (!room || room.currentGame !== "draw_guess")
            return;
        stopRoomTimer(roomCode);
        const words = WORD_LISTS[theme] || WORD_LISTS["thing"];
        const chosenWord = words[Math.floor(Math.random() * words.length)];
        const chosenDrawer = room.players[Math.floor(Math.random() * room.players.length)];
        room.gameData.theme = theme;
        room.gameData.status = "rng_rolling";
        io.to(roomCode).emit("g2_updated", room.gameData);
        setTimeout(() => {
            if (!rooms[roomCode] || rooms[roomCode].currentGame !== "draw_guess")
                return;
            room.gameData.status = "drawing";
            room.gameData.drawerId = chosenDrawer.id;
            room.gameData.word = chosenWord;
            io.to(roomCode).emit("g2_updated", room.gameData);
            let timeLeft = 60;
            io.to(roomCode).emit("g2_timer", timeLeft);
            roomTimers[roomCode] = setInterval(() => {
                timeLeft -= 1;
                io.to(roomCode).emit("g2_timer", timeLeft);
                if (timeLeft <= 0) {
                    stopRoomTimer(roomCode);
                    if (rooms[roomCode]) {
                        rooms[roomCode].gameData.status = "gameover";
                        rooms[roomCode].gameData.winner = "none";
                        rooms[roomCode].gameData.reason = `Time's up! The word was "${chosenWord}".`;
                        io.to(roomCode).emit("g2_updated", rooms[roomCode].gameData);
                    }
                }
            }, 1000);
        }, 2500);
    });
    socket.on("g2_draw_line", ({ roomCode, x0, y0, x1, y1 }) => {
        socket.to(roomCode).emit("g2_draw_line", { x0, y0, x1, y1 });
    });
    socket.on("g2_clear_canvas", (roomCode) => {
        socket.to(roomCode).emit("g2_clear_canvas");
    });
    socket.on("g2_guess", ({ roomCode, guess }) => {
        var _a;
        const room = rooms[roomCode];
        if (!room || room.currentGame !== "draw_guess" || room.gameData.status !== "drawing")
            return;
        const trimmedGuess = guess.trim().toLowerCase();
        const targetWord = room.gameData.word.toLowerCase();
        if (trimmedGuess === targetWord) {
            stopRoomTimer(roomCode);
            room.gameData.status = "gameover";
            room.gameData.winner = socket.id;
            const winnerName = (_a = room.players.find((p) => p.id === socket.id)) === null || _a === void 0 ? void 0 : _a.name;
            room.gameData.reason = `${winnerName} guessed the word "${room.gameData.word}" correctly!`;
            io.to(roomCode).emit("g2_updated", room.gameData);
        }
        else {
            io.to(roomCode).emit("g2_wrong_guess", { id: socket.id, guess });
        }
    });
    // ==========================================
    // WEBRTC SERVER-SIDE RELAYS
    // ==========================================
    socket.on("webrtc_ready", (roomCode) => {
        const room = rooms[roomCode];
        console.log(`[WEBRTC READY] ${socket.id} is ready in room ${roomCode}`);
        if (room && room.players.length === 2) {
            const hostId = room.players[0].id;
            console.log(`[WEBRTC TRIGGER] Both players present. Triggering offer from Host (${hostId})`);
            io.to(hostId).emit("start_webrtc_offer");
        }
        else {
            console.log(`[WEBRTC WAIT] Waiting for second player in room ${roomCode}`);
        }
    });
    socket.on("webrtc_offer", ({ roomCode, offer }) => {
        console.log(`[WEBRTC OFFER] ${socket.id} sent offer to room ${roomCode}`);
        socket.to(roomCode).emit("webrtc_offer", { offer, senderId: socket.id });
    });
    socket.on("webrtc_answer", ({ roomCode, answer }) => {
        console.log(`[WEBRTC ANSWER] ${socket.id} sent answer to room ${roomCode}`);
        socket.to(roomCode).emit("webrtc_answer", { answer, senderId: socket.id });
    });
    socket.on("webrtc_ice_candidate", ({ roomCode, candidate }) => {
        console.log(`[WEBRTC ICE] ${socket.id} sent ICE candidate`);
        socket.to(roomCode).emit("webrtc_ice_candidate", { candidate, senderId: socket.id });
    });
    // Return to Lobby
    socket.on("return_lobby", (roomCode) => {
        stopRoomTimer(roomCode);
        const room = rooms[roomCode];
        if (room) {
            room.currentGame = null;
            room.gameData = null;
            console.log(`[LOBBY RETURN] Room ${roomCode} returned to lobby`);
            io.to(roomCode).emit("room_updated", room);
        }
    });
    // Disconnect
    socket.on("disconnect", () => {
        console.log(`[DISCONNECTED] Client disconnected: ${socket.id}`);
        for (const code in rooms) {
            const room = rooms[code];
            const index = room.players.findIndex((p) => p.id === socket.id);
            if (index !== -1) {
                room.players.splice(index, 1);
                console.log(`[PLAYER REMOVED] Removed ${socket.id} from room ${code}`);
                if (room.players.length === 0) {
                    stopRoomTimer(code);
                    delete rooms[code];
                    console.log(`[ROOM DELETED] Deleted empty room ${code}`);
                }
                else {
                    io.to(code).emit("room_updated", room);
                }
                break;
            }
        }
    });
});
const PORT = 3001;
server.listen(PORT, () => {
    console.log(`\n🚀 Server running at http://localhost:${PORT}\n`);
});

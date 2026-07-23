import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import fs from "fs";

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

interface Player {
    id: string;
    name: string;
}

interface Room {
    code: string;
    players: Player[];
    currentGame: string | null;
    gameData: any;
}

const rooms: Record<string, Room> = {};
const roomTimers: Record<string, NodeJS.Timeout> = {};

// Words database for Draw & Guess
const WORD_LISTS: Record<string, string[]> = {
    animal: ["lion", "cat", "dog", "elephant", "penguin", "monkey", "giraffe", "dolphin", "tiger", "bear"],
    thing: ["car", "computer", "phone", "guitar", "clock", "house", "table", "rocket", "airplane", "camera"],
    person: ["doctor", "pilot", "ninja", "chef", "teacher", "king", "detective", "astronaut", "pirate", "artist"],
};

function stopRoomTimer(roomCode: string) {
    if (roomTimers[roomCode]) {
        clearInterval(roomTimers[roomCode]);
        delete roomTimers[roomCode];
    }
}

io.on("connection", (socket) => {
    console.log(`[CONNECTED] Client connected: ${socket.id}`);

    // Create Room
    socket.on("create_room", (playerName: string) => {
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
        const room = rooms[roomCode?.toUpperCase()];
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

    // ==========================================
    // GAME 1: GUESS THE NUMBER HANDLERS
    // ==========================================
    socket.on("g1_set_secret", ({ roomCode, secret }) => {
        const room = rooms[roomCode];
        if (!room || room.currentGame !== "guess_number") return;

        const isP1 = room.players[0].id === socket.id;
        if (isP1) {
            room.gameData.p1Secret = secret;
        } else {
            room.gameData.p2Secret = secret;
        }

        if (room.gameData.p1Secret !== null && room.gameData.p2Secret !== null) {
            room.gameData.status = "playing";
        }

        io.to(roomCode).emit("g1_updated", room.gameData);
    });

    socket.on("g1_guess", ({ roomCode, guess }) => {
        const room = rooms[roomCode];
        if (!room || room.currentGame !== "guess_number") return;

        const isP1 = room.players[0].id === socket.id;
        const myGuesses = isP1 ? room.gameData.p1Guesses : room.gameData.p2Guesses;
        const oppSecret = isP1 ? room.gameData.p2Secret : room.gameData.p1Secret;

        myGuesses.push(guess);

        if (guess === oppSecret) {
            room.gameData.status = "gameover";
            const winnerName = room.players.find((p) => p.id === socket.id)?.name;
            room.gameData.reason = `${winnerName} guessed the correct number (${oppSecret})!`;
        } else if (room.gameData.p1Guesses.length >= 10 && room.gameData.p2Guesses.length >= 10) {
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
        if (!room || room.currentGame !== "draw_guess") return;

        stopRoomTimer(roomCode);

        const words = WORD_LISTS[theme] || WORD_LISTS["thing"];
        const chosenWord = words[Math.floor(Math.random() * words.length)];
        const chosenDrawer = room.players[Math.floor(Math.random() * room.players.length)];

        room.gameData.theme = theme;
        room.gameData.status = "rng_rolling";
        io.to(roomCode).emit("g2_updated", room.gameData);

        setTimeout(() => {
            if (!rooms[roomCode] || rooms[roomCode].currentGame !== "draw_guess") return;

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

    socket.on("g2_clear_canvas", (roomCode: string) => {
        socket.to(roomCode).emit("g2_clear_canvas");
    });

    socket.on("g2_guess", ({ roomCode, guess }) => {
        const room = rooms[roomCode];
        if (!room || room.currentGame !== "draw_guess" || room.gameData.status !== "drawing") return;

        const trimmedGuess = guess.trim().toLowerCase();
        const targetWord = room.gameData.word.toLowerCase();

        if (trimmedGuess === targetWord) {
            stopRoomTimer(roomCode);
            room.gameData.status = "gameover";
            room.gameData.winner = socket.id;
            const winnerName = room.players.find((p) => p.id === socket.id)?.name;
            room.gameData.reason = `${winnerName} guessed the word "${room.gameData.word}" correctly!`;
            io.to(roomCode).emit("g2_updated", room.gameData);
        } else {
            io.to(roomCode).emit("g2_wrong_guess", { id: socket.id, guess });
        }
    });

    // ==========================================
    // WEBRTC SERVER-SIDE RELAYS
    // ==========================================
    socket.on("webrtc_ready", (roomCode: string) => {
        const room = rooms[roomCode];
        console.log(`[WEBRTC READY] ${socket.id} is ready in room ${roomCode}`);

        if (room && room.players.length === 2) {
            const hostId = room.players[0].id;
            console.log(`[WEBRTC TRIGGER] Both players present. Triggering offer from Host (${hostId})`);
            io.to(hostId).emit("start_webrtc_offer");
        } else {
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
    socket.on("return_lobby", (roomCode: string) => {
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
                } else {
                    io.to(code).emit("room_updated", room);
                }
                break;
            }
        }
    });
    // ==========================================
    // CINEMA / WATCH TOGETHER HANDLERS
    // ==========================================
    socket.on("cinema_change_url", ({ roomCode, url }: { roomCode: string; url: string }) => {
        console.log(`[CINEMA] URL changed in room ${roomCode} to: ${url}`);
        io.to(roomCode).emit("cinema_url_updated", url);
    });
    // ==========================================
    // GAME 4: DUAL-CREATION 7-WORD CHAIN HANDLERS
    // ==========================================

    socket.on("wordchain_submit_chain", ({ roomCode, playerId, chain }) => {
        let room = rooms[roomCode];
        if (!room) return;

        if (!room.gameData || room.currentGame !== "wordchain") {
            room.currentGame = "wordchain";
            room.gameData = {
                playerChains: {},
                chainsToGuess: {},
                playerProgress: {},
                scores: {},
                currentTurn: room.players[0].id,
                gameStatus: "setup",
                winner: null
            };
        }

        const data = room.gameData;
        data.playerChains[playerId] = chain;

        // Initialize player progress tracking
        data.playerProgress[playerId] = {
            guesses: [chain[0], "", "", "", "", "", ""], // Word 1 is revealed by default
            hintsRevealed: [chain[0].length, 1, 1, 1, 1, 1, 1],
            targetIndex: 1
        };
        data.scores[playerId] = 0;

        // When BOTH players have submitted their custom chains
        const players = room.players;
        if (players.length === 2 && data.playerChains[players[0].id] && data.playerChains[players[1].id]) {
            const p1 = players[0].id;
            const p2 = players[1].id;

            // Cross-assign target chains so P1 guesses P2's chain and P2 guesses P1's chain
            data.chainsToGuess[p1] = data.playerChains[p2];
            data.chainsToGuess[p2] = data.playerChains[p1];

            // Set first word automatically revealed in progress
            data.playerProgress[p1].guesses[0] = data.chainsToGuess[p1][0];
            data.playerProgress[p2].guesses[0] = data.chainsToGuess[p2][0];

            data.gameStatus = "playing";
        }

        io.to(roomCode).emit("wordchain_updated", data);
    });

    socket.on("wordchain_make_guess", ({ roomCode, playerId, guess, targetIndex, expectedWord }) => {
        const room = rooms[roomCode];
        if (!room || room.currentGame !== "wordchain") return;

        const data = room.gameData;
        const progress = data.playerProgress[playerId];
        const isCorrect = guess.toUpperCase() === expectedWord.toUpperCase();

        if (isCorrect) {
            progress.guesses[targetIndex] = expectedWord;
            data.scores[playerId] = (data.scores[playerId] || 0) + 10;

            let nextTarget = targetIndex + 1;
            while (nextTarget < 7 && progress.guesses[nextTarget]) {
                nextTarget++;
            }
            progress.targetIndex = nextTarget;

            // Check if player solved the whole chain
            if (nextTarget >= 7) {
                data.gameStatus = "gameover";
                const p1Score = data.scores[room.players[0].id] || 0;
                const p2Score = data.scores[room.players[1]?.id] || 0;

                if (p1Score > p2Score) data.winner = room.players[0].id;
                else if (p2Score > p1Score) data.winner = room.players[1]?.id;
                else data.winner = "draw";
            }
        } else {
            // Turn switches on wrong guess
            const opponent = room.players.find((p) => p.id !== playerId);
            if (opponent) {
                data.currentTurn = opponent.id;
            }
        }

        io.to(roomCode).emit("wordchain_updated", data);
    });

    socket.on("wordchain_request_hint", ({ roomCode, playerId, targetIndex }) => {
        const room = rooms[roomCode];
        if (!room || room.currentGame !== "wordchain") return;

        const data = room.gameData;
        const progress = data.playerProgress[playerId];

        // Increment revealed hint count for player
        progress.hintsRevealed[targetIndex] = (progress.hintsRevealed[targetIndex] || 1) + 1;

        // Turn switches on hint request
        const opponent = room.players.find((p) => p.id !== playerId);
        if (opponent) {
            data.currentTurn = opponent.id;
        }

        io.to(roomCode).emit("wordchain_updated", data);
    });
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
import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
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
const WORDS = {
    animal: ["cat", "dog", "elephant", "giraffe", "penguin"],
    thing: ["car", "house", "clock", "television", "chair"],
    person: ["doctor", "chef", "pilot", "police", "teacher"],
};

function generateRoomCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on("connection", (socket: Socket) => {
    console.log(`User connected: ${socket.id}`);

    // --- LOBBY LOGIC ---
    socket.on("create_room", (playerName: string) => {
        const code = generateRoomCode();
        rooms[code] = { code, players: [{ id: socket.id, name: playerName }], currentGame: null, gameData: {} };
        socket.join(code);
        socket.emit("room_created", rooms[code]);
    });

    socket.on("join_room", ({ roomCode, playerName }) => {
        const code = roomCode.toUpperCase().trim();
        const room = rooms[code];
        if (!room) return socket.emit("error_message", "Room not found!");
        if (room.players.length >= 2) return socket.emit("error_message", "Room is full! (Max 2 players)");

        room.players.push({ id: socket.id, name: playerName });
        socket.join(code);
        io.to(code).emit("room_updated", room);
    });

    socket.on("start_game", ({ roomCode, game }) => {
        const room = rooms[roomCode];
        if (room) {
            room.currentGame = game;
            if (game === "guess_number") {
                room.gameData = { p1Secret: null, p2Secret: null, p1Guesses: [], p2Guesses: [], status: "setup" };
            } else if (game === "draw_guess") {
                room.gameData = { theme: null, drawerId: null, word: null, status: "select_theme", timer: 60 };
            }
            io.to(roomCode).emit("game_started", room);
        }
    });

    socket.on("return_lobby", (roomCode: string) => {
        const room = rooms[roomCode];
        if (room) {
            room.currentGame = null;
            room.gameData = {};
            io.to(roomCode).emit("room_updated", room);
        }
    });

    // --- GAME 1 LOGIC: GUESS THE NUMBER ---
    socket.on("g1_set_secret", ({ roomCode, secret }) => {
        const room = rooms[roomCode];
        if (!room) return;
        const isP1 = room.players[0].id === socket.id;
        if (isP1) room.gameData.p1Secret = secret;
        else room.gameData.p2Secret = secret;

        if (room.gameData.p1Secret !== null && room.gameData.p2Secret !== null) {
            room.gameData.status = "playing";
        }
        io.to(roomCode).emit("g1_updated", room.gameData);
    });

    socket.on("g1_guess", ({ roomCode, guess }) => {
        const room = rooms[roomCode];
        if (!room || room.gameData.status !== "playing") return;

        const isP1 = room.players[0].id === socket.id;
        const opponentSecret = isP1 ? room.gameData.p2Secret : room.gameData.p1Secret;
        const myGuesses = isP1 ? room.gameData.p1Guesses : room.gameData.p2Guesses;

        if (myGuesses.length >= 10) return; // out of guesses
        myGuesses.push(guess);

        let winner = null;
        let reason = "";

        // Win condition 1: Guessed correctly
        if (guess === opponentSecret) {
            winner = socket.id;
            reason = "Guessed exactly right!";
            room.gameData.status = "gameover";
        }
        // Win condition 2: Both used 10 guesses, calculate closest
        else if (room.gameData.p1Guesses.length === 10 && room.gameData.p2Guesses.length === 10) {
            const p1Best = Math.min(...room.gameData.p1Guesses.map((g: number) => Math.abs(g - room.gameData.p2Secret)));
            const p2Best = Math.min(...room.gameData.p2Guesses.map((g: number) => Math.abs(g - room.gameData.p1Secret)));

            room.gameData.status = "gameover";
            if (p1Best < p2Best) {
                winner = room.players[0].id;
                reason = "Player 1 had the closest guess!";
            } else if (p2Best < p1Best) {
                winner = room.players[1].id;
                reason = "Player 2 had the closest guess!";
            } else {
                winner = "tie";
                reason = "It's a perfect tie!";
            }
        }

        room.gameData.winner = winner;
        room.gameData.reason = reason;
        io.to(roomCode).emit("g1_updated", room.gameData);
    });

    // --- GAME 2 LOGIC: DRAW AND GUESS ---
    socket.on("g2_select_theme", ({ roomCode, theme }) => {
        const room = rooms[roomCode];
        if (!room) return;

        // Pick random drawer and word
        const drawerIndex = Math.floor(Math.random() * 2);
        const drawer = room.players[drawerIndex];
        const wordList = WORDS[theme as keyof typeof WORDS];
        const word = wordList[Math.floor(Math.random() * wordList.length)];

        room.gameData.theme = theme;
        room.gameData.drawerId = drawer.id;
        room.gameData.word = word;
        room.gameData.status = "rng_rolling";

        io.to(roomCode).emit("g2_updated", room.gameData);

        // Server handles the 3 second RNG delay, then starts drawing phase
        setTimeout(() => {
            if (rooms[roomCode]) {
                rooms[roomCode].gameData.status = "drawing";
                io.to(roomCode).emit("g2_updated", rooms[roomCode].gameData);

                // Start 60s timer
                const timerInterval = setInterval(() => {
                    const r = rooms[roomCode];
                    if (!r || r.currentGame !== "draw_guess" || r.gameData.status !== "drawing") {
                        clearInterval(timerInterval);
                        return;
                    }
                    r.gameData.timer -= 1;
                    io.to(roomCode).emit("g2_timer", r.gameData.timer);

                    if (r.gameData.timer <= 0) {
                        clearInterval(timerInterval);
                        r.gameData.status = "gameover";
                        r.gameData.winner = "none";
                        r.gameData.reason = `Time's up! The word was: ${r.gameData.word}`;
                        io.to(roomCode).emit("g2_updated", r.gameData);
                    }
                }, 1000);
            }
        }, 3000);
    });

    socket.on("g2_draw_line", ({ roomCode, x0, y0, x1, y1 }) => {
        socket.to(roomCode).emit("g2_draw_line", { x0, y0, x1, y1 });
    });

    socket.on("g2_clear_canvas", (roomCode) => {
        socket.to(roomCode).emit("g2_clear_canvas");
    });

    socket.on("g2_guess", ({ roomCode, guess }) => {
        const room = rooms[roomCode];
        if (!room || room.gameData.status !== "drawing") return;

        if (guess.toLowerCase().trim() === room.gameData.word.toLowerCase()) {
            room.gameData.status = "gameover";
            room.gameData.winner = socket.id; // The guesser wins
            room.gameData.reason = `Correct! The word was ${room.gameData.word}`;
            io.to(roomCode).emit("g2_updated", room.gameData);
        } else {
            io.to(roomCode).emit("g2_wrong_guess", { id: socket.id, guess });
        }
    });

    socket.on("disconnect", () => {
        console.log(`User disconnected: ${socket.id}`);
        for (const code in rooms) {
            rooms[code].players = rooms[code].players.filter(p => p.id !== socket.id);
            if (rooms[code].players.length === 0) delete rooms[code];
            else io.to(code).emit("room_updated", rooms[code]);
        }
    });
});

const PORT = 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
import { Server, Socket } from "socket.io";
import { Room } from "./types";

const WORD_LISTS: Record<string, string[]> = {
    animal: ["lion", "cat", "dog", "elephant", "penguin", "monkey", "giraffe", "dolphin", "tiger", "bear"],
    thing: ["car", "computer", "phone", "guitar", "clock", "house", "table", "rocket", "airplane", "camera"],
    person: ["doctor", "pilot", "ninja", "chef", "teacher", "king", "detective", "astronaut", "pirate", "artist"],
};

export function registerDrawGuessHandlers(
    io: Server,
    socket: Socket,
    rooms: Record<string, Room>,
    roomTimers: Record<string, NodeJS.Timeout>,
    stopRoomTimer: (code: string) => void
) {
    socket.on("g2_select_theme", ({ roomCode, theme }: { roomCode: string; theme: string }) => {
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
                        io.to(roomCode).emit("room_updated", rooms[roomCode]); // Update scoreboard just in case
                    }
                }
            }, 1000);
        }, 2500);
    });

    socket.on("g2_draw_line", ({ roomCode, x0, y0, x1, y1 }: { roomCode: string; x0: number; y0: number; x1: number; y1: number }) => {
        socket.to(roomCode).emit("g2_draw_line", { x0, y0, x1, y1 });
    });

    socket.on("g2_clear_canvas", (roomCode: string) => {
        socket.to(roomCode).emit("g2_clear_canvas");
    });

    socket.on("g2_guess", ({ roomCode, guess }: { roomCode: string; guess: string }) => {
        const room = rooms[roomCode];
        if (!room || room.currentGame !== "draw_guess" || room.gameData.status !== "drawing") return;

        const trimmedGuess = guess.trim().toLowerCase();
        const targetWord = room.gameData.word.toLowerCase();

        if (trimmedGuess === targetWord) {
            stopRoomTimer(roomCode);
            room.gameData.status = "gameover";
            room.gameData.winner = socket.id;

            // Add a point to the winner
            room.scores[socket.id] = (room.scores[socket.id] || 0) + 1;

            const winnerName = room.players.find((p) => p.id === socket.id)?.name;
            room.gameData.reason = `${winnerName} guessed the word "${room.gameData.word}" correctly!`;

            io.to(roomCode).emit("g2_updated", room.gameData);
            io.to(roomCode).emit("room_updated", room); // Broadcast new scores
        } else {
            io.to(roomCode).emit("g2_wrong_guess", { id: socket.id, guess });
        }
    });

    socket.on("g2_play_again", (roomCode: string) => {
        const room = rooms[roomCode];
        if (!room || room.currentGame !== "draw_guess") return;

        room.gameData = {
            status: "select_theme",
            theme: null,
            word: null,
            drawerId: null,
            winner: null,
            reason: null
        };
        io.to(roomCode).emit("g2_updated", room.gameData);
    });
}
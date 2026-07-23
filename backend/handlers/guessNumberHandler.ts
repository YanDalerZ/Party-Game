import { Server, Socket } from "socket.io";
import { Room } from "./types";

export function registerGuessNumberHandlers(io: Server, socket: Socket, rooms: Record<string, Room>) {
    socket.on("g1_set_secret", ({ roomCode, secret }: { roomCode: string; secret: string }) => {
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

    socket.on("g1_guess", ({ roomCode, guess }: { roomCode: string; guess: string }) => {
        const room = rooms[roomCode];
        if (!room || room.currentGame !== "guess_number") return;

        const isP1 = room.players[0].id === socket.id;
        const myGuesses = isP1 ? room.gameData.p1Guesses : room.gameData.p2Guesses;
        const oppSecret = isP1 ? room.gameData.p2Secret : room.gameData.p1Secret;

        // Compare logic: check character matching at the exact index
        const matches = guess.split('').map((char, index) => char === oppSecret[index]);
        const isWin = matches.every((m) => m === true);

        myGuesses.push({ guess, matches });

        if (isWin) {
            room.gameData.status = "gameover";

            // Add a point to the winner
            room.scores[socket.id] = (room.scores[socket.id] || 0) + 1;

            const winnerName = room.players.find((p) => p.id === socket.id)?.name;
            room.gameData.reason = `${winnerName} guessed the correct code!`;
            io.to(roomCode).emit("room_updated", room); // Broadcast new scores
        }

        io.to(roomCode).emit("g1_updated", room.gameData);
    });

    socket.on("g1_play_again", (roomCode: string) => {
        const room = rooms[roomCode];
        if (!room || room.currentGame !== "guess_number") return;

        room.gameData = {
            status: "setup",
            p1Secret: null,
            p2Secret: null,
            p1Guesses: [],
            p2Guesses: []
        };
        io.to(roomCode).emit("g1_updated", room.gameData);
    });
}
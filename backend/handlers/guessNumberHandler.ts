import { Server, Socket } from "socket.io";
import { Room } from "./types";

export function registerGuessNumberHandlers(io: Server, socket: Socket, rooms: Record<string, Room>) {
    socket.on("g1_set_secret", ({ roomCode, secret }: { roomCode: string; secret: number }) => {
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

    socket.on("g1_guess", ({ roomCode, guess }: { roomCode: string; guess: number }) => {
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
}
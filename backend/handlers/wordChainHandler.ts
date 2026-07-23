import { Server, Socket } from "socket.io";
import { Room } from "./types";

export function registerWordChainHandlers(io: Server, socket: Socket, rooms: Record<string, Room>) {
    socket.on("wordchain_submit_chain", ({ roomCode, playerId, chain }: { roomCode: string; playerId: string; chain: string[] }) => {
        const room = rooms[roomCode];
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
                winner: null,
            };
        }

        const data = room.gameData;
        data.playerChains[playerId] = chain;

        data.playerProgress[playerId] = {
            guesses: [chain[0], "", "", "", "", "", ""],
            hintsRevealed: [chain[0].length, 1, 1, 1, 1, 1, 1],
            targetIndex: 1,
        };
        data.scores[playerId] = 0;

        const players = room.players;
        if (players.length === 2 && data.playerChains[players[0].id] && data.playerChains[players[1].id]) {
            const p1 = players[0].id;
            const p2 = players[1].id;

            data.chainsToGuess[p1] = data.playerChains[p2];
            data.chainsToGuess[p2] = data.playerChains[p1];

            data.playerProgress[p1].guesses[0] = data.chainsToGuess[p1][0];
            data.playerProgress[p2].guesses[0] = data.chainsToGuess[p2][0];

            data.gameStatus = "playing";
        }

        io.to(roomCode).emit("wordchain_updated", data);
    });

    socket.on(
        "wordchain_make_guess",
        ({
            roomCode,
            playerId,
            guess,
            targetIndex,
            expectedWord,
        }: {
            roomCode: string;
            playerId: string;
            guess: string;
            targetIndex: number;
            expectedWord: string;
        }) => {
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

                if (nextTarget >= 7) {
                    data.gameStatus = "gameover";
                    const p1Score = data.scores[room.players[0].id] || 0;
                    const p2Score = data.scores[room.players[1]?.id] || 0;

                    if (p1Score > p2Score) data.winner = room.players[0].id;
                    else if (p2Score > p1Score) data.winner = room.players[1]?.id;
                    else data.winner = "draw";
                }
            } else {
                const opponent = room.players.find((p) => p.id !== playerId);
                if (opponent) {
                    data.currentTurn = opponent.id;
                }
            }

            io.to(roomCode).emit("wordchain_updated", data);
        }
    );

    socket.on("wordchain_request_hint", ({ roomCode, playerId, targetIndex }: { roomCode: string; playerId: string; targetIndex: number }) => {
        const room = rooms[roomCode];
        if (!room || room.currentGame !== "wordchain") return;

        const data = room.gameData;
        const progress = data.playerProgress[playerId];

        progress.hintsRevealed[targetIndex] = (progress.hintsRevealed[targetIndex] || 1) + 1;

        const opponent = room.players.find((p) => p.id !== playerId);
        if (opponent) {
            data.currentTurn = opponent.id;
        }

        io.to(roomCode).emit("wordchain_updated", data);
    });
}
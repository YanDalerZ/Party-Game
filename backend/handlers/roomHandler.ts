import { Server, Socket } from "socket.io";
import { Room } from "./types";

export function registerRoomHandlers(
    io: Server,
    socket: Socket,
    rooms: Record<string, Room>,
    stopRoomTimer: (code: string) => void
) {
    // Create Room
    socket.on("create_room", (playerName: string) => {
        const code = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[code] = {
            code,
            players: [{ id: socket.id, name: playerName }],
            currentGame: null,
            gameData: null,
            scores: { [socket.id]: 0 },
            globalScores: { [socket.id]: 0 } // Initialize globalScores
        };
        socket.join(code);
        console.log(`[ROOM CREATED] Code: ${code} by ${playerName} (${socket.id})`);
        socket.emit("room_created", rooms[code]);
    });

    // Join Room
    socket.on("join_room", ({ roomCode, playerName }: { roomCode: string; playerName: string }) => {
        const code = roomCode?.toUpperCase();
        const room = rooms[code];

        if (!room) {
            console.log(`[JOIN ERROR] Room ${roomCode} not found for ${playerName}`);
            return socket.emit("error_message", "Room not found!");
        }
        if (room.players.length >= 2) {
            console.log(`[JOIN ERROR] Room ${roomCode} full for ${playerName}`);
            return socket.emit("error_message", "Room is full!");
        }

        room.players.push({ id: socket.id, name: playerName });
        room.scores[socket.id] = 0; // Initialize score for player 2
        room.globalScores[socket.id] = 0; // Initialize globalScore for player 2

        socket.join(room.code);
        console.log(`[ROOM JOINED] ${playerName} (${socket.id}) joined ${room.code}`);
        io.to(room.code).emit("room_updated", room);
    });

    // Start Game
    socket.on("start_game", ({ roomCode, game }: { roomCode: string; game: string }) => {
        const room = rooms[roomCode];
        if (room) {
            room.currentGame = game;

            if (game === "guess_number") {
                room.gameData = { status: "setup", p1Secret: null, p2Secret: null, p1Guesses: [], p2Guesses: [] };
            } else if (game === "draw_guess") {
                room.gameData = { status: "select_theme", theme: null, word: null, drawerId: null, winner: null, reason: null };
            }

            io.to(roomCode).emit("game_started", room);
        }
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
}
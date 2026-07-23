import { Server, Socket } from "socket.io";
import { Room } from "./types";

// Store pending disconnects so we can cancel them if the player reconnects quickly
const pendingDisconnects: Record<string, NodeJS.Timeout> = {};

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
            globalScores: { [socket.id]: 0 }
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
        room.scores[socket.id] = 0;
        room.globalScores[socket.id] = 0;

        socket.join(room.code);
        console.log(`[ROOM JOINED] ${playerName} (${socket.id}) joined ${room.code}`);
        io.to(room.code).emit("room_updated", room);
    });

    // Handle Rejoining via localStorage
    socket.on("rejoin_room", ({ roomCode, previousSocketId, playerName }: { roomCode: string; previousSocketId: string; playerName: string }) => {
        const code = roomCode?.toUpperCase();
        const room = rooms[code];

        if (!room) {
            return socket.emit("error_message", "Room no longer exists!");
        }

        // Cancel the pending disconnect destruction if the player came back fast enough
        if (pendingDisconnects[previousSocketId]) {
            clearTimeout(pendingDisconnects[previousSocketId]);
            delete pendingDisconnects[previousSocketId];
        }

        // Find the player in the room array using their old socket ID
        const playerIndex = room.players.findIndex(p => p.id === previousSocketId);

        if (playerIndex !== -1) {
            // Update the player's socket ID to the new one
            room.players[playerIndex].id = socket.id;

            // Transfer scores from the old socket ID to the new one
            if (room.scores[previousSocketId] !== undefined) {
                room.scores[socket.id] = room.scores[previousSocketId];
                delete room.scores[previousSocketId];
            }
            if (room.globalScores[previousSocketId] !== undefined) {
                room.globalScores[socket.id] = room.globalScores[previousSocketId];
                delete room.globalScores[previousSocketId];
            }

            socket.join(code);
            console.log(`[ROOM REJOINED] ${playerName} reconnected to ${code} (New ID: ${socket.id})`);
            io.to(code).emit("room_updated", room);

            // Re-broadcast the game start event so they see the current game immediately
            if (room.currentGame) {
                socket.emit("game_started", room);
            }
        } else {
            // If the player isn't found (perhaps the grace period expired), they must rejoin normally
            socket.emit("error_message", "Session expired, please join again.");
        }
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

    // Disconnect with Grace Period
    socket.on("disconnect", () => {
        console.log(`[DISCONNECTED] Client disconnected: ${socket.id}`);

        for (const code in rooms) {
            const room = rooms[code];
            const index = room.players.findIndex((p) => p.id === socket.id);

            if (index !== -1) {
                // Instead of immediately deleting, set a 10-second grace period timer
                pendingDisconnects[socket.id] = setTimeout(() => {
                    // Check if the room still exists
                    if (rooms[code]) {
                        // Find the index AGAIN just in case the array mutated
                        const currentIndex = rooms[code].players.findIndex((p) => p.id === socket.id);
                        if (currentIndex !== -1) {
                            rooms[code].players.splice(currentIndex, 1);
                            console.log(`[PLAYER REMOVED] Removed ${socket.id} from room ${code} after grace period`);

                            if (rooms[code].players.length === 0) {
                                stopRoomTimer(code);
                                delete rooms[code];
                                console.log(`[ROOM DELETED] Deleted empty room ${code}`);
                            } else {
                                io.to(code).emit("room_updated", rooms[code]);
                            }
                        }
                    }
                    delete pendingDisconnects[socket.id];
                }, 10000); // 10 seconds to refresh and rejoin

                break; // Exit the loop since we found the player
            }
        }
    });
}
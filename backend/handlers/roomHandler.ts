import { Server, Socket } from "socket.io";
import { Room } from "./types";

// Store pending disconnects so we can cancel them if the player reconnects quickly
const pendingDisconnects: Record<string, NodeJS.Timeout> = {};

// Helper to ensure payload is clean and free of circular references
function sanitizeGameData(gameData: any): any {
    if (!gameData) return null;

    return JSON.parse(
        JSON.stringify(gameData, (key, value) => {
            if (
                key === "timer" ||
                key === "interval" ||
                key === "timeout" ||
                (value && typeof value === "object" && value.constructor?.name === "Timeout") ||
                typeof value === "function"
            ) {
                return undefined;
            }
            return value;
        })
    );
}

export function sanitizeRoom(room: any) {
    return {
        code: room.code,
        players: room.players,
        currentGame: room.currentGame,
        gameData: sanitizeGameData(room.gameData),
        scores: room.scores,
        globalScores: room.globalScores,
        isPrivate: room.isPrivate ?? false,
    };
}

// Helper to get array of all available public rooms
function getPublicRooms(rooms: Record<string, any>) {
    return Object.values(rooms)
        .filter((room) => !room.isPrivate && room.players.length < 2)
        .map((room) => ({
            code: room.code,
            hostName: room.players[0]?.name || "Unknown",
            playerCount: room.players.length,
        }));
}

// Helper to broadcast public room list to everyone not currently in a full room
function broadcastPublicRooms(io: Server, rooms: Record<string, any>) {
    io.emit("public_rooms_list", getPublicRooms(rooms));
}

export function registerRoomHandlers(
    io: Server,
    socket: Socket,
    rooms: Record<string, Room & { isPrivate?: boolean }>,
    stopRoomTimer: (code: string) => void
) {
    // Send list of public rooms on request
    socket.on("get_public_rooms", () => {
        socket.emit("public_rooms_list", getPublicRooms(rooms));
    });

    // Create Room (with isPrivate setting)
    socket.on("create_room", ({ playerName, isPrivate }: { playerName: string; isPrivate: boolean }) => {
        const code = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[code] = {
            code,
            players: [{ id: socket.id, name: playerName }],
            currentGame: null,
            gameData: null,
            scores: { [socket.id]: 0 },
            globalScores: { [socket.id]: 0 },
            isPrivate: Boolean(isPrivate),
        };
        socket.join(code);
        console.log(`[ROOM CREATED] Code: ${code} (${isPrivate ? "Private" : "Public"}) by ${playerName} (${socket.id})`);

        socket.emit("room_created", sanitizeRoom(rooms[code]));
        broadcastPublicRooms(io, rooms);
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

        io.to(room.code).emit("room_updated", sanitizeRoom(room));
        broadcastPublicRooms(io, rooms);
    });

    // Handle Rejoining via localStorage
    socket.on("rejoin_room", ({ roomCode, previousSocketId, playerName }: { roomCode: string; previousSocketId: string; playerName: string }) => {
        const code = roomCode?.toUpperCase();
        const room = rooms[code];

        if (!room) {
            return socket.emit("error_message", "Room no longer exists!");
        }

        if (pendingDisconnects[previousSocketId]) {
            clearTimeout(pendingDisconnects[previousSocketId]);
            delete pendingDisconnects[previousSocketId];
        }

        const playerIndex = room.players.findIndex(p => p.id === previousSocketId);

        if (playerIndex !== -1) {
            room.players[playerIndex].id = socket.id;

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

            const cleanRoom = sanitizeRoom(room);
            io.to(code).emit("room_updated", cleanRoom);

            if (room.currentGame) {
                socket.emit("game_started", cleanRoom);
            }
        } else {
            socket.emit("error_message", "Session expired, please join again.");
        }
    });

    // Leave Room explicitly
    socket.on("leave_room", ({ roomCode }: { roomCode: string }) => {
        const room = rooms[roomCode];
        if (room) {
            const index = room.players.findIndex((p) => p.id === socket.id);
            if (index !== -1) {
                room.players.splice(index, 1);
                socket.leave(roomCode);

                if (room.players.length === 0) {
                    stopRoomTimer(roomCode);
                    delete rooms[roomCode];
                } else {
                    io.to(roomCode).emit("room_updated", sanitizeRoom(room));
                }
                broadcastPublicRooms(io, rooms);
            }
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
            } else if (game === "photobooth") {
                room.gameData = { bgUrl: null, stripFrames: [] };
            }

            io.to(roomCode).emit("game_started", sanitizeRoom(room));
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
            io.to(roomCode).emit("room_updated", sanitizeRoom(room));
        }
    });

    // Disconnect with Grace Period
    socket.on("disconnect", () => {
        console.log(`[DISCONNECTED] Client disconnected: ${socket.id}`);

        for (const code in rooms) {
            const room = rooms[code];
            const index = room.players.findIndex((p) => p.id === socket.id);

            if (index !== -1) {
                pendingDisconnects[socket.id] = setTimeout(() => {
                    if (rooms[code]) {
                        const currentIndex = rooms[code].players.findIndex((p) => p.id === socket.id);
                        if (currentIndex !== -1) {
                            rooms[code].players.splice(currentIndex, 1);
                            console.log(`[PLAYER REMOVED] Removed ${socket.id} from room ${code} after grace period`);

                            if (rooms[code].players.length === 0) {
                                stopRoomTimer(code);
                                delete rooms[code];
                                console.log(`[ROOM DELETED] Deleted empty room ${code}`);
                            } else {
                                io.to(code).emit("room_updated", sanitizeRoom(rooms[code]));
                            }
                            broadcastPublicRooms(io, rooms);
                        }
                    }
                    delete pendingDisconnects[socket.id];
                }, 10000);

                break;
            }
        }
    });

    socket.on("exit_to_dashboard", ({ roomCode }: { roomCode: string }) => {
        const room = rooms[roomCode];
        if (!room) return;

        if (room.gameData?.timer) {
            clearInterval(room.gameData.timer);
            clearTimeout(room.gameData.timer);
        }

        room.currentGame = null;
        room.gameData = null;

        io.to(roomCode).emit("room_updated", sanitizeRoom(room));
    });
}
import { Server, Socket } from "socket.io";
import { Room } from "./types";

interface WallObstacle {
    id: string;
    z: number;
    speed: number;
    shape: "rectangle" | "circle" | "diamond";
    holeWidth: number;
    holeHeight: number;
}

interface WallDodgeGameState {
    status: "WAITING" | "COUNTDOWN" | "PLAYING" | "GAME_OVER";
    scores: Record<string, number>;
    lives: Record<string, number>;
    walls: WallObstacle[];
    round: number;
}

const gameStates: Record<string, WallDodgeGameState> = {};
const hitCooldowns: Record<string, number> = {};

export function registerBoxDodgeHandlers(io: Server, socket: Socket, rooms: Record<string, Room>) {
    const spawnWalls = (roomCode: string) => {
        const shapes: ("rectangle" | "circle" | "diamond")[] = ["rectangle", "circle", "diamond"];
        const walls: WallObstacle[] = [
            {
                id: Math.random().toString(36).substring(7),
                z: 1.0,
                speed: 0.012,
                shape: shapes[Math.floor(Math.random() * shapes.length)],
                holeWidth: 0.35,
                holeHeight: 0.4,
            },
            {
                id: Math.random().toString(36).substring(7),
                z: 0.55,
                speed: 0.014,
                shape: shapes[Math.floor(Math.random() * shapes.length)],
                holeWidth: 0.38,
                holeHeight: 0.42,
            }
        ];
        return walls;
    };

    socket.on("dodge_start_game", (roomCode: string) => {
        const room = rooms[roomCode];
        if (!room) return;

        const initialScores: Record<string, number> = {};
        const initialLives: Record<string, number> = {};

        room.players.forEach((p) => {
            initialScores[p.id] = 0;
            initialLives[p.id] = 3;
        });

        gameStates[roomCode] = {
            status: "COUNTDOWN",
            scores: initialScores,
            lives: initialLives,
            walls: [],
            round: 1,
        };

        io.to(roomCode).emit("dodge_state_sync", gameStates[roomCode]);

        let countdown = 3;
        io.to(roomCode).emit("dodge_countdown", countdown);

        const interval = setInterval(() => {
            countdown -= 1;
            if (countdown > 0) {
                io.to(roomCode).emit("dodge_countdown", countdown);
            } else {
                clearInterval(interval);
                io.to(roomCode).emit("dodge_countdown", null);

                if (gameStates[roomCode]) {
                    gameStates[roomCode].status = "PLAYING";
                    gameStates[roomCode].walls = spawnWalls(roomCode);
                    io.to(roomCode).emit("dodge_state_sync", gameStates[roomCode]);
                }
            }
        }, 1000);
    });

    socket.on("dodge_update_walls", ({ roomCode, walls }: { roomCode: string; walls: WallObstacle[] }) => {
        const gameState = gameStates[roomCode];
        if (gameState && gameState.status === "PLAYING") {
            gameState.walls = walls;
            io.to(roomCode).emit("dodge_state_sync", gameState);
        }
    });

    socket.on("dodge_wall_hit", ({ roomCode, playerId, wallId }: { roomCode: string; playerId: string; wallId: string }) => {
        const gameState = gameStates[roomCode];
        if (!gameState || gameState.status !== "PLAYING") return;

        // Cooldown check to prevent multiple rapid deductions per wall hit
        const now = Date.now();
        const cooldownKey = `${roomCode}_${playerId}_${wallId}`;
        if (hitCooldowns[cooldownKey] && now - hitCooldowns[cooldownKey] < 1500) {
            return;
        }
        hitCooldowns[cooldownKey] = now;

        // Deduct 1 heart
        gameState.lives[playerId] = Math.max(0, (gameState.lives[playerId] ?? 3) - 1);

        // Check if game over
        const allDead = Object.values(gameState.lives).every((lives) => lives <= 0);
        if (allDead) {
            gameState.status = "GAME_OVER";
            gameState.walls = [];
        }

        io.to(roomCode).emit("dodge_state_sync", gameState);
    });
}
import { Server, Socket } from "socket.io";
import { Room } from "./types";

interface BoxObstacle {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    z: number;
    speed: number;
}

interface BoxDodgeGameState {
    status: "WAITING" | "COUNTDOWN" | "PLAYING" | "GAME_OVER";
    scores: Record<string, number>;
    lives: Record<string, number>;
    boxes: BoxObstacle[];
    round: number;
}

const gameStates: Record<string, BoxDodgeGameState> = {};
const hitCooldowns: Record<string, number> = {};

export function registerBoxDodgeHandlers(io: Server, socket: Socket, rooms: Record<string, Room>) {
    const spawnBoxes = (roomCode: string) => {
        const boxes: BoxObstacle[] = [
            {
                id: Math.random().toString(36).substring(7),
                x: (Math.random() - 0.5) * 0.8,
                y: (Math.random() - 0.5) * 0.6,
                width: 0.25,
                height: 0.25,
                z: 1.0,
                speed: 0.012,
            },
            {
                id: Math.random().toString(36).substring(7),
                x: (Math.random() - 0.5) * 0.8,
                y: (Math.random() - 0.5) * 0.6,
                width: 0.22,
                height: 0.22,
                z: 0.6,
                speed: 0.014,
            }
        ];
        return boxes;
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
            boxes: [],
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
                    gameStates[roomCode].boxes = spawnBoxes(roomCode);
                    io.to(roomCode).emit("dodge_state_sync", gameStates[roomCode]);
                }
            }
        }, 1000);
    });

    socket.on("dodge_update_boxes", ({ roomCode, boxes }: { roomCode: string; boxes: BoxObstacle[] }) => {
        const gameState = gameStates[roomCode];
        if (gameState && gameState.status === "PLAYING") {
            gameState.boxes = boxes;
            io.to(roomCode).emit("dodge_state_sync", gameState);
        }
    });

    socket.on("dodge_box_hit", ({ roomCode, playerId, boxId }: { roomCode: string; playerId: string; boxId: string }) => {
        const gameState = gameStates[roomCode];
        if (!gameState || gameState.status !== "PLAYING") return;

        // Cooldown check to prevent multiple rapid deductions per hit
        const now = Date.now();
        const cooldownKey = `${roomCode}_${playerId}_${boxId}`;
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
            gameState.boxes = [];
        }

        io.to(roomCode).emit("dodge_state_sync", gameState);
    });
}
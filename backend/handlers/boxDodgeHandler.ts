import { Server, Socket } from "socket.io";
import { Room } from "./types";

export type ShapeType = "CUBE" | "BARRIER_WIDE" | "PILLAR_TALL" | "DIAMOND" | "WALL_FULL" | "HORIZONTAL_STRIP";

export interface BoxObstacle {
    id: string;
    shape: ShapeType;
    x: number;      // Center X offset (-0.7 to 0.7 for edge-to-edge coverage)
    y: number;      // Center Y offset (-0.7 to 0.7 for top-to-bottom coverage)
    width: number;  // Base width scale
    height: number; // Base height scale
    z: number;      // Depth distance (1.0 = far horizon, 0.0 = player contact)
    speed: number;  // Movement velocity along Z axis
    color: string;  // Visual theme accent
}

export interface BoxDodgeGameState {
    status: "WAITING" | "COUNTDOWN" | "PLAYING" | "GAME_OVER";
    scores: Record<string, number>;
    lives: Record<string, number>;
    boxes: BoxObstacle[];
    round: number;
    gameStartTime: number;
    speedMultiplier: number;
}

const gameStates: Record<string, BoxDodgeGameState> = {};
const hitCooldowns: Record<string, number> = {};

const COLOR_PALETTE = ["#00f3ff", "#ff0055", "#ffe600", "#a855f7", "#00ff66", "#ff7700"];

function createSingleObstacle(speedMultiplier: number): BoxObstacle {
    const shapes: ShapeType[] = [
        "CUBE",
        "BARRIER_WIDE",
        "PILLAR_TALL",
        "DIAMOND",
        "WALL_FULL",
        "HORIZONTAL_STRIP"
    ];

    const chosenShape = shapes[Math.floor(Math.random() * shapes.length)];

    // Position targets across full screen spectrum (top, bottom, corners, center)
    const positionPresets = [
        { x: -0.6, y: -0.65 }, // Top-Left Corner
        { x: 0.6, y: -0.65 },  // Top-Right Corner
        { x: -0.6, y: 0.65 },  // Bottom-Left Corner
        { x: 0.6, y: 0.65 },   // Bottom-Right Corner
        { x: 0.0, y: -0.7 },   // Upper High Center
        { x: 0.0, y: 0.7 },    // Lower Bottom Center
        { x: -0.65, y: 0.0 },  // Far Left
        { x: 0.65, y: 0.0 },   // Far Right
        { x: (Math.random() - 0.5) * 1.3, y: (Math.random() - 0.5) * 1.3 } // Random Everywhere
    ];

    const preset = positionPresets[Math.floor(Math.random() * positionPresets.length)];
    let x = preset.x;
    let y = preset.y;
    let width = 0.35;
    let height = 0.35;

    switch (chosenShape) {
        case "BARRIER_WIDE":
            width = 0.8;
            height = 0.25;
            break;
        case "PILLAR_TALL":
            width = 0.25;
            height = 0.8;
            break;
        case "HORIZONTAL_STRIP":
            width = 0.95;
            height = 0.2;
            y = Math.random() > 0.5 ? 0.6 : -0.6; // High or Low sweep
            break;
        case "DIAMOND":
            width = 0.4;
            height = 0.4;
            break;
        case "WALL_FULL":
            width = 0.55;
            height = 0.55;
            break;
        case "CUBE":
        default:
            width = 0.35;
            height = 0.35;
            break;
    }

    const baseSpeed = 0.012 + Math.random() * 0.004;

    return {
        id: Math.random().toString(36).substring(2, 9),
        shape: chosenShape,
        x,
        y,
        width,
        height,
        z: 1.0,
        speed: baseSpeed * speedMultiplier,
        color: COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)],
    };
}

export function registerBoxDodgeHandlers(io: Server, socket: Socket, rooms: Record<string, Room>) {
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
            gameStartTime: Date.now(),
            speedMultiplier: 1.0,
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
                    gameStates[roomCode].gameStartTime = Date.now();
                    // EXACTLY 1 OBSTACLE AT A TIME
                    gameStates[roomCode].boxes = [createSingleObstacle(1.0)];
                    io.to(roomCode).emit("dodge_state_sync", gameStates[roomCode]);
                }
            }
        }, 1000);
    });

    socket.on("dodge_update_boxes", ({ roomCode, boxes }: { roomCode: string; boxes: BoxObstacle[] }) => {
        const gameState = gameStates[roomCode];
        if (gameState && gameState.status === "PLAYING") {
            const timeElapsedSeconds = (Date.now() - gameState.gameStartTime) / 1000;
            const newMultiplier = 1.0 + timeElapsedSeconds * 0.035; // Progressive speed boost
            gameState.speedMultiplier = newMultiplier;

            // Score ticks for surviving players
            Object.keys(gameState.scores).forEach((pId) => {
                if ((gameState.lives[pId] ?? 0) > 0) {
                    gameState.scores[pId] = Math.floor(timeElapsedSeconds * 10);
                }
            });

            // Replace obstacle as soon as it reaches depth boundary
            gameState.boxes = boxes.map((box) => {
                if (box.z <= 0.0) {
                    return createSingleObstacle(gameState.speedMultiplier);
                }
                return box;
            });

            // Ensure count stays locked to strictly 1 active obstacle
            if (gameState.boxes.length > 1) {
                gameState.boxes = [gameState.boxes[0]];
            }

            io.to(roomCode).emit("dodge_state_sync", gameState);
        }
    });

    socket.on("dodge_box_hit", ({ roomCode, playerId, boxId }: { roomCode: string; playerId: string; boxId: string }) => {
        const gameState = gameStates[roomCode];
        if (!gameState || gameState.status !== "PLAYING") return;

        const now = Date.now();
        const cooldownKey = `${roomCode}_${playerId}_${boxId}`;
        if (hitCooldowns[cooldownKey] && now - hitCooldowns[cooldownKey] < 1200) {
            return;
        }
        hitCooldowns[cooldownKey] = now;

        // Deduct 1 life
        gameState.lives[playerId] = Math.max(0, (gameState.lives[playerId] ?? 3) - 1);

        // Respawn next shape immediately on collision hit
        gameState.boxes = [createSingleObstacle(gameState.speedMultiplier)];

        // Check overall elimination
        const allDead = Object.values(gameState.lives).every((lives) => lives <= 0);
        if (allDead) {
            gameState.status = "GAME_OVER";
            gameState.boxes = [];
        }

        io.to(roomCode).emit("dodge_state_sync", gameState);
    });
}
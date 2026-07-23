import { Server, Socket } from "socket.io";

const FALLBACK_IMAGES = [
    "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500",
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=500",
    "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=500",
    "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=500",
];

async function fetchRandomSuspectImage(): Promise<string> {
    const randomId = Math.floor(Math.random() * 100);

    try {
        const picsumUrl = `https://picsum.photos/id/${randomId + 10}/500/500`;
        const response = await fetch(picsumUrl, { method: "HEAD" });
        if (response.ok) {
            return response.url;
        }
    } catch {
        // Fall back gracefully if request fails or network drops
    }

    return FALLBACK_IMAGES[Math.floor(Math.random() * FALLBACK_IMAGES.length)];
}

export function registerDetectiveCaricatureHandlers(io: Server, socket: Socket, rooms: Record<string, any>) {
    function sendDetectiveUpdate(roomCode: string) {
        const room = rooms[roomCode];
        if (!room) return;

        room.players.forEach((p: any) => {
            const myRole = p.id === room.gameData.describer ? "describer" : "artist";
            io.to(p.id).emit("detective_updated", {
                ...room.gameData,
                myRole,
            });
        });
    }

    socket.on("detective_start", async (roomCode: string) => {
        const room = rooms[roomCode];
        if (!room || room.players.length < 2) return;

        if (room.gameData?.timer) {
            clearInterval(room.gameData.timer);
        }

        const describer = room.players[Math.floor(Math.random() * room.players.length)].id;
        const artist = room.players.find((p: any) => p.id !== describer)!.id;

        const suspectImage = await fetchRandomSuspectImage();

        room.currentGame = "detective";
        room.gameData = {
            describer,
            artist,
            timeLeft: 60,
            suspectImage,
            finalCanvas: null,
            gameStatus: "playing",
            timer: null
        };

        room.gameData.timer = setInterval(() => {
            if (room.gameData && room.gameData.gameStatus === "playing") {
                room.gameData.timeLeft -= 1;
                if (room.gameData.timeLeft <= 0) {
                    room.gameData.gameStatus = "reveal";
                    clearInterval(room.gameData.timer);
                }
                sendDetectiveUpdate(roomCode);
            }
        }, 1000);

        sendDetectiveUpdate(roomCode);
    });

    socket.on("detective_sync_canvas", ({ roomCode, canvasData }: { roomCode: string; canvasData: string }) => {
        const room = rooms[roomCode];
        if (!room || room.currentGame !== "detective" || !room.gameData) return;
        room.gameData.finalCanvas = canvasData;
        sendDetectiveUpdate(roomCode);
    });

    socket.on("detective_end", ({ roomCode, success }: { roomCode: string; success: boolean }) => {
        const room = rooms[roomCode];
        if (!room || room.currentGame !== "detective") return;

        if (success) {
            room.players.forEach((p: any) => {
                room.globalScores[p.id] = (room.globalScores[p.id] || 0) + 5;
            });
            io.to(roomCode).emit("room_updated", room);
        }

        socket.emit("return_lobby", roomCode);
    });
}
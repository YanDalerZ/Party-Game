import { Server, Socket } from "socket.io";
import { Room } from "./types";

const FALLBACK_IMAGES = [
    "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500",
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=500",
    "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=500",
    "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=500",
];

async function fetchRandomSuspectImage(): Promise<string> {
    const randomId = Math.floor(Math.random() * 1000);
    const searchQueries = ["portrait", "face", "person", "man", "woman", "human"];
    const selectedQuery = searchQueries[Math.floor(Math.random() * searchQueries.length)];

    try {
        // Direct Unsplash keyword source endpoint with a random seed to prevent caching
        const sourceUrl = `https://source.unsplash.com/featured/500x500/?${selectedQuery}&sig=${randomId}`;
        const response = await fetch(sourceUrl, { method: "HEAD" });

        if (response.ok && response.url) {
            return response.url;
        }
    } catch {
        // Picsum photo API alternative
        try {
            const picsumUrl = `https://picsum.photos/id/${(randomId % 100) + 10}/500/500`;
            const picsumResp = await fetch(picsumUrl, { method: "HEAD" });
            if (picsumResp.ok) return picsumResp.url;
        } catch {
            // Fall back to stored static links if internet calls fail
        }
    }

    return FALLBACK_IMAGES[Math.floor(Math.random() * FALLBACK_IMAGES.length)];
}

export function registerDetectiveCaricatureHandlers(io: Server, socket: Socket, rooms: Record<string, Room>) {
    function sendDetectiveUpdate(roomCode: string) {
        const room = rooms[roomCode];
        if (!room) return;

        room.players.forEach((p) => {
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

        const describer = room.players[Math.floor(Math.random() * room.players.length)].id;
        const artist = room.players.find((p) => p.id !== describer)!.id;

        // Dynamically scrape/fetch an online portrait image
        const suspectImage = await fetchRandomSuspectImage();

        room.currentGame = "detective";
        room.gameData = {
            describer,
            artist,
            timeLeft: 60,
            suspectImage,
            finalCanvas: null,
            gameStatus: "playing",
        };

        if (room.gameData.timer) clearInterval(room.gameData.timer);
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
        if (!room || room.currentGame !== "detective") return;
        room.gameData.finalCanvas = canvasData;
        sendDetectiveUpdate(roomCode);
    });
}
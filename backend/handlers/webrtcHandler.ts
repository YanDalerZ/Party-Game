import { Server, Socket } from "socket.io";
import { Room } from "./types";

export function registerWebRTCHandlers(io: Server, socket: Socket, rooms: Record<string, Room>) {
    socket.on("webrtc_ready", (roomCode: string) => {
        const room = rooms[roomCode];
        console.log(`[WEBRTC READY] ${socket.id} is ready in room ${roomCode}`);

        if (room && room.players.length === 2) {
            const hostId = room.players[0].id;
            console.log(`[WEBRTC TRIGGER] Both players present. Triggering offer from Host (${hostId})`);
            io.to(hostId).emit("start_webrtc_offer");
        } else {
            console.log(`[WEBRTC WAIT] Waiting for second player in room ${roomCode}`);
        }
    });

    socket.on("webrtc_offer", ({ roomCode, offer }: { roomCode: string; offer: any }) => {
        console.log(`[WEBRTC OFFER] ${socket.id} sent offer to room ${roomCode}`);
        socket.to(roomCode).emit("webrtc_offer", { offer, senderId: socket.id });
    });

    socket.on("webrtc_answer", ({ roomCode, answer }: { roomCode: string; answer: any }) => {
        console.log(`[WEBRTC ANSWER] ${socket.id} sent answer to room ${roomCode}`);
        socket.to(roomCode).emit("webrtc_answer", { answer, senderId: socket.id });
    });

    socket.on("webrtc_ice_candidate", ({ roomCode, candidate }: { roomCode: string; candidate: any }) => {
        console.log(`[WEBRTC ICE] ${socket.id} sent ICE candidate`);
        socket.to(roomCode).emit("webrtc_ice_candidate", { candidate, senderId: socket.id });
    });
}
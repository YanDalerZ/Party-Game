import { Server, Socket } from "socket.io";

export function registerCinemaHandlers(io: Server, socket: Socket) {
    socket.on("cinema_change_url", ({ roomCode, url }: { roomCode: string; url: string }) => {
        console.log(`[CINEMA] URL changed in room ${roomCode} to: ${url}`);
        io.to(roomCode).emit("cinema_url_updated", url);
    });
}
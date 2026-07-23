import { Server, Socket } from "socket.io";

export function registerCinemaHandlers(io: Server, socket: Socket) {
    // Change Video URL
    socket.on("cinema_change_url", ({ roomCode, url }: { roomCode: string; url: string }) => {
        console.log(`[CINEMA] URL changed in room ${roomCode} to: ${url}`);
        io.to(roomCode).emit("cinema_url_updated", url);
    });

    // Synchronize Play, Pause, and Seek events
    socket.on("cinema_sync_action", ({ roomCode, action, currentTime }: { roomCode: string; action: "play" | "pause" | "seek"; currentTime: number }) => {
        console.log(`[CINEMA] Action: ${action} at ${currentTime}s in room ${roomCode}`);
        // Broadcast to everyone ELSE in the room to prevent event feedback loops
        socket.to(roomCode).emit("cinema_sync_action", { action, currentTime });
    });
}
import { Server, Socket } from "socket.io";

export function registerCinemaHandlers(io: Server, socket: Socket) {
    // Sync Video URL
    socket.on("cinema_change_url", ({ roomCode, url }: { roomCode: string; url: string }) => {
        io.to(roomCode).emit("cinema_url_updated", url);
    });

    // Sync Video Controls (Play, Pause, Seek)
    socket.on("cinema_sync_action", ({ roomCode, action, currentTime }: { roomCode: string; action: string; currentTime: number }) => {
        socket.to(roomCode).emit("cinema_sync_action", { action, currentTime });
    });

    // WebRTC Screen Sharing Relay Events
    socket.on("cinema_screen_offer", ({ roomCode, offer }) => {
        socket.to(roomCode).emit("cinema_screen_offer", { offer });
    });

    socket.on("cinema_screen_answer", ({ roomCode, answer }) => {
        socket.to(roomCode).emit("cinema_screen_answer", { answer });
    });

    socket.on("cinema_screen_ice", ({ roomCode, candidate }) => {
        socket.to(roomCode).emit("cinema_screen_ice", { candidate });
    });

    socket.on("cinema_screen_stop", ({ roomCode }) => {
        socket.to(roomCode).emit("cinema_screen_stop");
    });
}
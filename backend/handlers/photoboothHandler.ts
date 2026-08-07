import { Server, Socket } from "socket.io";

export function registerPhotoBoothHandlers(io: Server, socket: Socket) {
    // Sync Background Selection
    socket.on("photobooth_change_bg", ({ roomCode, bgUrl }: { roomCode: string; bgUrl: string }) => {
        io.to(roomCode).emit("photobooth_bg_updated", bgUrl);
    });

    // Sync Photo Strip Countdown & Snap Signal
    socket.on("photobooth_start_sequence", ({ roomCode }: { roomCode: string }) => {
        io.to(roomCode).emit("photobooth_sequence_started");
    });

    // Broadcast newly captured frame to photo strip
    socket.on("photobooth_add_strip_frame", ({ roomCode, frameUrl }: { roomCode: string; frameUrl: string }) => {
        io.to(roomCode).emit("photobooth_strip_frame_added", frameUrl);
    });

    // Clear photo strip for new session
    socket.on("photobooth_clear_strip", ({ roomCode }: { roomCode: string }) => {
        io.to(roomCode).emit("photobooth_strip_cleared");
    });
}
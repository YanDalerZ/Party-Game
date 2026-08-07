import { Server, Socket } from "socket.io";

export function registerPhotoBoothHandlers(io: Server, socket: Socket) {
    socket.on("photobooth_change_bg", ({ roomCode, bgUrl }: { roomCode: string; bgUrl: string }) => {
        io.to(roomCode).emit("photobooth_bg_updated", bgUrl);
    });

    socket.on("photobooth_take_photo", ({ roomCode }: { roomCode: string }) => {
        io.to(roomCode).emit("photobooth_photo_taken");
    });
}
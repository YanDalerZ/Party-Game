import { io, Socket } from "socket.io-client";

// Detect if running locally or deployed on production
const isLocal =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

const SERVER_URL = isLocal ? "http://localhost:3001" : window.location.origin;

export const socket: Socket = io(SERVER_URL, {
    transports: ["websocket", "polling"],
});
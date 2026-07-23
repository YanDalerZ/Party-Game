import { io, Socket } from "socket.io-client";

// In production, you would change this to your hosted backend URL
const SERVER_URL = "http://localhost:3001";
export const socket: Socket = io(SERVER_URL);
import { Server, Socket } from "socket.io";

const BOMB_PASSWORDS = ["REACT", "SOCKET", "NODEJS", "CYBER", "SNAKE"];

export function registerBombDefusalHandlers(io: Server, socket: Socket, rooms: Record<string, any>) {
    function sendBombUpdate(roomCode: string) {
        const room = rooms[roomCode];
        if (!room) return;

        room.players.forEach((p: any) => {
            const role = p.id === room.gameData.defuser ? "defuser" : "expert";
            io.to(p.id).emit("bomb_updated", {
                ...room.gameData,
                role,
            });
        });
    }

    socket.on("bomb_start", (roomCode: string) => {
        const room = rooms[roomCode];
        if (!room || room.players.length < 2) return;

        if (room.gameData?.timer) {
            clearInterval(room.gameData.timer);
        }

        const defuser = room.players[Math.floor(Math.random() * room.players.length)].id;
        const expert = room.players.find((p: any) => p.id !== defuser)!.id;
        const password = BOMB_PASSWORDS[Math.floor(Math.random() * BOMB_PASSWORDS.length)];

        room.currentGame = "bomb";
        room.gameData = {
            defuser,
            expert,
            timeLeft: 180,
            strikes: 0,
            gameStatus: "playing",
            winner: false,
            config: {
                wires: ["bg-red-500", "bg-blue-500", "bg-yellow-500", "bg-red-500"],
                cutWires: [],
                wiresDefused: false,
                keypadDefused: false,
                passwordDefused: false,
                buttonDefused: false,
                buttonColor: "bg-red-600 border-red-400",
                buttonText: "DETONATE",
            },
            manual: {
                keypadCode: "1479",
                password: password,
            },
            timer: null
        };

        room.gameData.timer = setInterval(() => {
            if (room.gameData && room.gameData.gameStatus === "playing") {
                room.gameData.timeLeft -= 1;
                if (room.gameData.timeLeft <= 0) {
                    room.gameData.gameStatus = "gameover";
                    room.gameData.winner = false;
                    clearInterval(room.gameData.timer);
                }
                sendBombUpdate(roomCode);
            }
        }, 1000);

        sendBombUpdate(roomCode);
    });

    socket.on(
        "bomb_action",
        ({
            roomCode,
            type,
            wireIndex,
            password,
            code,
        }: {
            roomCode: string;
            type: string;
            wireIndex?: number;
            password?: string;
            code?: string;
        }) => {
            const room = rooms[roomCode];
            if (!room || room.currentGame !== "bomb" || !room.gameData) return;

            const data = room.gameData;
            if (data.gameStatus !== "playing") return;

            if (type === "cut_wire" && wireIndex !== undefined) {
                if (!data.config.cutWires.includes(wireIndex)) {
                    data.config.cutWires.push(wireIndex);
                    if (wireIndex === 1) {
                        data.config.wiresDefused = true;
                    } else {
                        data.strikes += 1;
                    }
                }
            } else if (type === "submit_password" && password) {
                if (password.toUpperCase() === data.manual.password) {
                    data.config.passwordDefused = true;
                } else {
                    data.strikes += 1;
                }
            } else if (type === "submit_keypad" && code) {
                if (code === data.manual.keypadCode) {
                    data.config.keypadDefused = true;
                } else {
                    data.strikes += 1;
                }
            } else if (type === "press_button") {
                data.config.buttonDefused = true;
            }

            if (data.strikes >= 3) {
                data.gameStatus = "gameover";
                data.winner = false;
                if (data.timer) clearInterval(data.timer);
            }

            if (
                data.config.wiresDefused &&
                data.config.keypadDefused &&
                data.config.passwordDefused &&
                data.config.buttonDefused
            ) {
                data.gameStatus = "gameover";
                data.winner = true;
                if (data.timer) clearInterval(data.timer);

                // Add global scores for both co-op players
                room.players.forEach((p: any) => {
                    room.globalScores[p.id] = (room.globalScores[p.id] || 0) + 10;
                });
                io.to(roomCode).emit("room_updated", room);
            }

            sendBombUpdate(roomCode);
        }
    );
}
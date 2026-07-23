import React, { useState, useEffect, useRef } from "react";
import { socket } from "./socket";
import { type Room } from "./App";

interface Props { room: Room; myId: string; }

export default function DrawGuess({ room, myId }: Props) {
    const [data, setData] = useState(room.gameData);
    const [timer, setTimer] = useState(60);
    const [rngDisplay, setRngDisplay] = useState("Selecting Drawer...");
    const [guessInput, setGuessInput] = useState("");
    const [chatLog, setChatLog] = useState<string[]>([]);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;

    useEffect(() => {
        socket.on("g2_updated", (newData: any) => setData(newData));
        socket.on("g2_timer", (t: number) => setTimer(t));
        socket.on("g2_wrong_guess", (info: { id: string, guess: string }) => {
            const p = room.players.find(x => x.id === info.id);
            setChatLog(prev => [...prev, `${p?.name} guessed: ${info.guess}`]);
        });

        socket.on("g2_draw_line", ({ x0, y0, x1, y1 }) => { drawLine(x0, y0, x1, y1, false); });
        socket.on("g2_clear_canvas", () => {
            const ctx = canvasRef.current?.getContext("2d");
            if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        });

        return () => {
            socket.off("g2_updated");
            socket.off("g2_timer");
            socket.off("g2_wrong_guess");
            socket.off("g2_draw_line");
            socket.off("g2_clear_canvas");
        };
    }, [room.players]);

    // RNG Animation logic
    useEffect(() => {
        if (data.status === "rng_rolling") {
            let toggle = true;
            const interval = setInterval(() => {
                setRngDisplay(toggle ? room.players[0].name : room.players[1].name);
                toggle = !toggle;
            }, 150);
            return () => clearInterval(interval);
        }
    }, [data.status, room.players]);

    const selectTheme = (theme: string) => {
        socket.emit("g2_select_theme", { roomCode: room.code, theme });
    };

    const submitGuess = () => {
        if (!guessInput.trim()) return;
        socket.emit("g2_guess", { roomCode: room.code, guess: guessInput });
        setGuessInput("");
    };

    const returnToLobby = () => socket.emit("return_lobby", room.code);

    // Canvas Drawing Logic
    const drawLine = (x0: number, y0: number, x1: number, y1: number, emit: boolean) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = "black";
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.stroke();
        ctx.closePath();

        if (emit) socket.emit("g2_draw_line", { roomCode: room.code, x0, y0, x1, y1 });
    };

    const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (data.status !== "drawing" || data.drawerId !== myId) return;
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        isDrawing = true;
        lastX = e.clientX - rect.left;
        lastY = e.clientY - rect.top;
    };

    const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isDrawing || data.status !== "drawing" || data.drawerId !== myId) return;
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        drawLine(lastX, lastY, x, y, true);
        lastX = x;
        lastY = y;
    };

    const onMouseUp = () => { isDrawing = false; };
    const clearCanvas = () => {
        if (data.drawerId === myId) {
            socket.emit("g2_clear_canvas", room.code);
            const ctx = canvasRef.current?.getContext("2d");
            if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
    };

    const containerStyle: React.CSSProperties = { maxWidth: "800px", margin: "40px auto", padding: "20px", background: "white", borderRadius: "8px", boxShadow: "0 2px 10px rgba(0,0,0,0.1)" };
    const btnStyle: React.CSSProperties = { background: "#28a745", color: "white", padding: "10px 20px", border: "none", borderRadius: "4px", cursor: "pointer", margin: "5px" };
    const canvasStyle: React.CSSProperties = { border: "2px solid #ccc", background: "#fff", cursor: data.drawerId === myId ? "crosshair" : "default" };

    return (
        <div style={containerStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2>Game 2: Draw & Guess</h2>
                {data.status === "drawing" && <h2 style={{ color: timer <= 10 ? "red" : "black" }}>⏳ {timer}s</h2>}
            </div>
            <hr />

            {data.status === "select_theme" && (
                <div style={{ textAlign: "center", padding: "40px 0" }}>
                    <h3>Choose a Theme to start</h3>
                    <button style={btnStyle} onClick={() => selectTheme("animal")}>Animals</button>
                    <button style={btnStyle} onClick={() => selectTheme("thing")}>Things</button>
                    <button style={btnStyle} onClick={() => selectTheme("person")}>People / Jobs</button>
                </div>
            )}

            {data.status === "rng_rolling" && (
                <div style={{ textAlign: "center", padding: "60px 0" }}>
                    <h3>Spinning the wheel for the Drawer...</h3>
                    <h1 style={{ fontSize: "48px", color: "#0066cc" }}>{rngDisplay}</h1>
                </div>
            )}

            {data.status === "drawing" && (
                <div style={{ display: "flex", gap: "20px" }}>
                    <div>
                        <div style={{ marginBottom: "10px", fontWeight: "bold" }}>
                            {data.drawerId === myId ? (
                                <span style={{ color: "red" }}>You are drawing: {data.word.toUpperCase()}</span>
                            ) : (
                                <span style={{ color: "blue" }}>Guess what {room.players.find(p => p.id === data.drawerId)?.name} is drawing!</span>
                            )}
                        </div>

                        <canvas
                            ref={canvasRef}
                            width={500}
                            height={400}
                            style={canvasStyle}
                            onMouseDown={onMouseDown}
                            onMouseMove={onMouseMove}
                            onMouseUp={onMouseUp}
                            onMouseOut={onMouseUp}
                        />
                        {data.drawerId === myId && <button style={{ ...btnStyle, display: "block", marginTop: "10px", background: "#dc3545" }} onClick={clearCanvas}>Clear Canvas</button>}
                    </div>

                    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                        <h3>Guesses</h3>
                        <div style={{ flex: 1, border: "1px solid #eee", background: "#f9f9f9", padding: "10px", overflowY: "auto", maxHeight: "300px" }}>
                            {chatLog.map((log, i) => <div key={i} style={{ marginBottom: "5px" }}>{log}</div>)}
                        </div>

                        {data.drawerId !== myId && (
                            <div style={{ marginTop: "10px", display: "flex" }}>
                                <input
                                    style={{ flex: 1, padding: "10px" }}
                                    placeholder="Type guess here..."
                                    value={guessInput}
                                    onChange={e => setGuessInput(e.target.value)}
                                    onKeyDown={e => e.key === "Enter" && submitGuess()}
                                />
                                <button style={{ ...btnStyle, margin: "0 0 0 10px" }} onClick={submitGuess}>Guess</button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {data.status === "gameover" && (
                <div style={{ textAlign: "center", padding: "20px", background: "#e6ffe6", borderRadius: "8px", marginTop: "20px" }}>
                    <h2>Game Over!</h2>
                    <h3 style={{ color: "#28a745" }}>{data.reason}</h3>
                    {data.winner !== "none" && <p>Winner: <b>{room.players.find(p => p.id === data.winner)?.name}</b></p>}
                    <button style={{ ...btnStyle, marginTop: "20px", background: "#0066cc" }} onClick={returnToLobby}>Back to Lobby</button>
                </div>
            )}
        </div>
    );
}
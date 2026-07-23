import React, { useState, useEffect, useRef } from "react";
import { socket } from "./socket";
import { type Room } from "./App";
import VideoCall from "./VideoCall";

interface Props {
    room: Room;
    myId: string;
}

export default function DrawGuess({ room, myId }: Props) {
    const [data, setData] = useState(room.gameData);
    const [timer, setTimer] = useState(60);
    const [rngDisplay, setRngDisplay] = useState("Selecting Drawer...");
    const [guessInput, setGuessInput] = useState("");
    const [chatLog, setChatLog] = useState<{ name: string; guess: string }[]>([]);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);

    const isDrawing = useRef(false);
    const lastPos = useRef({ x: 0, y: 0 });

    useEffect(() => {
        socket.on("g2_updated", (newData: any) => setData(newData));
        socket.on("g2_timer", (t: number) => setTimer(t));
        socket.on("g2_wrong_guess", (info: { id: string; guess: string }) => {
            const p = room.players.find((x) => x.id === info.id);
            if (p) {
                setChatLog((prev) => [...prev, { name: p.name, guess: info.guess }]);
            }
        });

        socket.on("g2_draw_line", ({ x0, y0, x1, y1 }) => {
            drawLine(x0, y0, x1, y1, false);
        });

        socket.on("g2_clear_canvas", () => {
            clearLocalCanvas();
        });

        return () => {
            socket.off("g2_updated");
            socket.off("g2_timer");
            socket.off("g2_wrong_guess");
            socket.off("g2_draw_line");
            socket.off("g2_clear_canvas");
        };
    }, [room.players]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [chatLog]);

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

    const clearLocalCanvas = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    };

    const drawLine = (
        x0: number,
        y0: number,
        x1: number,
        y1: number,
        emit: boolean
    ) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.stroke();
        ctx.closePath();

        if (emit) {
            socket.emit("g2_draw_line", { roomCode: room.code, x0, y0, x1, y1 });
        }
    };

    const getCanvasCoordinates = (
        clientX: number,
        clientY: number
    ): { x: number; y: number } | null => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY,
        };
    };

    const startDrawing = (clientX: number, clientY: number) => {
        if (data.status !== "drawing" || data.drawerId !== myId) return;
        const coords = getCanvasCoordinates(clientX, clientY);
        if (!coords) return;
        isDrawing.current = true;
        lastPos.current = coords;
    };

    const moveDrawing = (clientX: number, clientY: number) => {
        if (
            !isDrawing.current ||
            data.status !== "drawing" ||
            data.drawerId !== myId
        )
            return;
        const coords = getCanvasCoordinates(clientX, clientY);
        if (!coords) return;

        drawLine(lastPos.current.x, lastPos.current.y, coords.x, coords.y, true);
        lastPos.current = coords;
    };

    const stopDrawing = () => {
        isDrawing.current = false;
    };

    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        startDrawing(e.clientX, e.clientY);
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        moveDrawing(e.clientX, e.clientY);
    };

    const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
        if (e.touches.length > 0) {
            startDrawing(e.touches[0].clientX, e.touches[0].clientY);
        }
    };

    const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
        if (e.touches.length > 0) {
            moveDrawing(e.touches[0].clientX, e.touches[0].clientY);
        }
    };

    const clearCanvas = () => {
        if (data.drawerId === myId) {
            socket.emit("g2_clear_canvas", room.code);
            clearLocalCanvas();
        }
    };

    const submitGuess = () => {
        if (!guessInput.trim()) return;
        socket.emit("g2_guess", { roomCode: room.code, guess: guessInput });
        setGuessInput("");
    };

    const isDrawer = data.drawerId === myId;
    const drawerName = room.players.find((p) => p.id === data.drawerId)?.name;
    const opponent = room.players.find((p) => p.id !== myId);
    const opponentName = opponent ? opponent.name : "Opponent";

    return (
        <div className="flex flex-col landscape:flex-row portrait:flex-col lg:flex-row min-h-screen lg:h-screen bg-slate-900 text-white overflow-x-hidden">
            {/* Video Call: Top bar in Vertical/Portrait, Left sidebar in Landscape */}
            <div className="w-full portrait:w-full landscape:w-72 lg:w-80 shrink-0 border-b portrait:border-b landscape:border-b-0 landscape:border-r lg:border-b-0 lg:border-r border-slate-700 bg-slate-800/40">
                <VideoCall roomCode={room.code} opponentName={opponentName} />
            </div>

            {/* Main Game Area */}
            <div className="flex-1 flex flex-col min-w-0 p-3 sm:p-6 lg:p-8 overflow-y-auto">
                <div className="max-w-5xl mx-auto w-full flex flex-col flex-1 gap-4">
                    {/* Header Bar */}
                    <div className="flex flex-wrap sm:flex-nowrap justify-between items-center gap-3 bg-slate-800 p-4 sm:p-6 rounded-xl sm:rounded-2xl shadow-lg border border-slate-700 shrink-0">
                        <div>
                            <h2 className="text-xl sm:text-3xl font-bold text-violet-400">
                                Draw & Guess
                            </h2>
                            <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
                                Scribble and solve before time runs out!
                            </p>
                        </div>

                        <div className="flex items-center gap-4 ml-auto sm:ml-0">
                            {data.status === "drawing" && (
                                <div
                                    className={`text-2xl sm:text-4xl font-black ${timer <= 10 ? "text-red-500 animate-pulse" : "text-white"
                                        }`}
                                >
                                    {timer}s
                                </div>
                            )}
                            <button
                                onClick={() => socket.emit("return_lobby", room.code)}
                                className="bg-slate-700 hover:bg-slate-600 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition"
                            >
                                Exit
                            </button>
                        </div>
                    </div>

                    {/* Canvas & Interactive Card */}
                    <div className="flex-1 bg-slate-800 rounded-xl sm:rounded-2xl border border-slate-700 shadow-xl overflow-hidden flex flex-col relative min-h-[450px]">
                        {/* Category Select Modal */}
                        {data.status === "select_theme" && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-800/95 backdrop-blur-sm z-20 p-4 text-center">
                                <h3 className="text-2xl sm:text-3xl font-bold mb-6 sm:mb-8">
                                    Choose a Category
                                </h3>
                                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 w-full max-w-xs sm:max-w-none justify-center">
                                    {["animal", "thing", "person"].map((t) => (
                                        <button
                                            key={t}
                                            onClick={() =>
                                                socket.emit("g2_select_theme", {
                                                    roomCode: room.code,
                                                    theme: t,
                                                })
                                            }
                                            className="bg-violet-600 hover:bg-violet-500 px-6 sm:px-8 py-3 sm:py-4 rounded-xl text-lg sm:text-xl font-bold capitalize transition shadow-lg shadow-violet-500/20"
                                        >
                                            {t}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* RNG Drawer Rolling Modal */}
                        {data.status === "rng_rolling" && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-800/95 z-20 p-4">
                                <div className="text-xs sm:text-sm font-bold text-violet-400 uppercase tracking-widest mb-2 sm:mb-4">
                                    Selecting Drawer
                                </div>
                                <h1 className="text-3xl sm:text-6xl font-black text-white animate-bounce text-center">
                                    {rngDisplay}
                                </h1>
                            </div>
                        )}

                        {/* Game Over Screen */}
                        {data.status === "gameover" && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/95 z-30 p-6 text-center">
                                <div className="text-5xl sm:text-6xl mb-4 sm:mb-6">
                                    {data.winner !== "none" ? "🎉" : "⏳"}
                                </div>
                                <h2 className="text-2xl sm:text-4xl font-black text-violet-400 mb-2 sm:mb-4">
                                    {data.reason}
                                </h2>
                                {data.winner !== "none" && (
                                    <p className="text-lg sm:text-xl text-slate-300 mb-6 sm:mb-8">
                                        Winner:{" "}
                                        <span className="text-white font-bold">
                                            {room.players.find((p) => p.id === data.winner)?.name}
                                        </span>
                                    </p>
                                )}
                                <button
                                    onClick={() => socket.emit("return_lobby", room.code)}
                                    className="bg-violet-600 hover:bg-violet-500 px-6 sm:px-8 py-2.5 sm:py-3 rounded-xl font-bold transition"
                                >
                                    Play Again
                                </button>
                            </div>
                        )}

                        {/* Workspace */}
                        <div className="flex-1 flex flex-col lg:flex-row min-h-0">
                            {/* Canvas Container */}
                            <div className="flex-1 p-3 sm:p-6 flex flex-col items-center justify-start lg:justify-center border-b lg:border-b-0 lg:border-r border-slate-700 bg-slate-800/50">
                                <div className="w-full max-w-[600px] mb-3 text-center">
                                    {isDrawer ? (
                                        <div className="bg-red-500/20 border border-red-500 text-red-300 py-2 sm:py-3 px-4 sm:px-6 rounded-xl font-medium text-sm sm:text-lg inline-block w-full sm:w-auto">
                                            Draw:{" "}
                                            <span className="font-black text-white uppercase tracking-wider">
                                                {data.word}
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="bg-blue-500/20 border border-blue-500 text-blue-300 py-2 sm:py-3 px-4 sm:px-6 rounded-xl font-medium text-sm sm:text-lg inline-block w-full sm:w-auto">
                                            Guess what{" "}
                                            <span className="font-bold text-white">{drawerName}</span>{" "}
                                            is drawing!
                                        </div>
                                    )}
                                </div>

                                <div className="bg-white p-1 sm:p-2 rounded-xl shadow-inner relative w-full max-w-[600px] aspect-[16/9] touch-none">
                                    {!isDrawer && <div className="absolute inset-0 z-10" />}
                                    <canvas
                                        ref={canvasRef}
                                        width={600}
                                        height={337}
                                        className={`w-full h-full bg-white rounded-lg ${isDrawer ? "cursor-crosshair" : "cursor-default"
                                            }`}
                                        onMouseDown={handleMouseDown}
                                        onMouseMove={handleMouseMove}
                                        onMouseUp={stopDrawing}
                                        onMouseLeave={stopDrawing}
                                        onTouchStart={handleTouchStart}
                                        onTouchMove={handleTouchMove}
                                        onTouchEnd={stopDrawing}
                                    />
                                </div>

                                {isDrawer && (
                                    <button
                                        onClick={clearCanvas}
                                        className="mt-3 sm:mt-4 bg-slate-700 hover:bg-slate-600 text-white px-4 sm:px-6 py-2 rounded-lg text-xs sm:text-sm font-medium transition flex items-center gap-2"
                                    >
                                        <svg
                                            className="w-4 h-4"
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth="2"
                                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                            ></path>
                                        </svg>
                                        Clear Canvas
                                    </button>
                                )}
                            </div>

                            {/* Chat & Live Guesses Panel */}
                            <div className="w-full lg:w-80 flex flex-col bg-slate-900/50 h-64 lg:h-auto min-h-[200px]">
                                <div className="p-3 sm:p-4 border-b border-slate-700 bg-slate-800 font-semibold text-slate-300 text-xs sm:text-sm">
                                    Live Guesses
                                </div>

                                <div className="flex-1 p-3 sm:p-4 overflow-y-auto space-y-2 sm:space-y-3">
                                    {chatLog.length === 0 && (
                                        <p className="text-slate-500 text-xs sm:text-sm text-center italic mt-2">
                                            No guesses yet...
                                        </p>
                                    )}
                                    {chatLog.map((log, i) => (
                                        <div key={i} className="text-xs sm:text-sm break-words">
                                            <span className="font-bold text-violet-400">
                                                {log.name}:{" "}
                                            </span>
                                            <span className="text-slate-300">{log.guess}</span>
                                        </div>
                                    ))}
                                    <div ref={chatEndRef} />
                                </div>

                                {!isDrawer && data.status === "drawing" && (
                                    <div className="p-2 sm:p-4 bg-slate-800 border-t border-slate-700">
                                        <div className="flex gap-2">
                                            <input
                                                className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-violet-500 placeholder-slate-500 text-xs sm:text-sm"
                                                placeholder="Type guess..."
                                                value={guessInput}
                                                onChange={(e) => setGuessInput(e.target.value)}
                                                onKeyDown={(e) => e.key === "Enter" && submitGuess()}
                                            />
                                            <button
                                                onClick={submitGuess}
                                                className="bg-violet-600 hover:bg-violet-500 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition shrink-0"
                                            >
                                                Send
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
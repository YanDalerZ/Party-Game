import React, { useState, useEffect, useRef } from "react";
import { socket } from "./socket";
import { type Room } from "./App";
import VideoCall from "./VideoCall";

interface Props { room: Room; myId: string; }

export default function DrawGuess({ room, myId }: Props) {
    const [data, setData] = useState(room.gameData);
    const [timer, setTimer] = useState(60);
    const [rngDisplay, setRngDisplay] = useState("Selecting Drawer...");
    const [guessInput, setGuessInput] = useState("");
    const [chatLog, setChatLog] = useState<{ name: string, guess: string }[]>([]);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    let isDrawing = false;
    let lastX = 0; let lastY = 0;

    useEffect(() => {
        socket.on("g2_updated", (newData: any) => setData(newData));
        socket.on("g2_timer", (t: number) => setTimer(t));
        socket.on("g2_wrong_guess", (info: { id: string, guess: string }) => {
            const p = room.players.find(x => x.id === info.id);
            if (p) setChatLog(prev => [...prev, { name: p.name, guess: info.guess }]);
        });

        socket.on("g2_draw_line", ({ x0, y0, x1, y1 }) => { drawLine(x0, y0, x1, y1, false); });
        socket.on("g2_clear_canvas", () => {
            const ctx = canvasRef.current?.getContext("2d");
            if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        });

        return () => {
            socket.off("g2_updated"); socket.off("g2_timer"); socket.off("g2_wrong_guess");
            socket.off("g2_draw_line"); socket.off("g2_clear_canvas");
        };
    }, [room.players]);

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

    const drawLine = (x0: number, y0: number, x1: number, y1: number, emit: boolean) => {
        const canvas = canvasRef.current; if (!canvas) return;
        const ctx = canvas.getContext("2d"); if (!ctx) return;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
        ctx.strokeStyle = "#3b82f6"; ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.stroke(); ctx.closePath();
        if (emit) socket.emit("g2_draw_line", { roomCode: room.code, x0, y0, x1, y1 });
    };

    const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (data.status !== "drawing" || data.drawerId !== myId) return;
        const rect = canvasRef.current?.getBoundingClientRect(); if (!rect) return;
        isDrawing = true; lastX = e.clientX - rect.left; lastY = e.clientY - rect.top;
    };

    const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isDrawing || data.status !== "drawing" || data.drawerId !== myId) return;
        const rect = canvasRef.current?.getBoundingClientRect(); if (!rect) return;
        const x = e.clientX - rect.left; const y = e.clientY - rect.top;
        drawLine(lastX, lastY, x, y, true);
        lastX = x; lastY = y;
    };

    const onMouseUp = () => { isDrawing = false; };
    const clearCanvas = () => {
        if (data.drawerId === myId) {
            socket.emit("g2_clear_canvas", room.code);
            const ctx = canvasRef.current?.getContext("2d");
            if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
    };

    const submitGuess = () => {
        if (!guessInput.trim()) return;
        socket.emit("g2_guess", { roomCode: room.code, guess: guessInput });
        setGuessInput("");
    };

    const isDrawer = data.drawerId === myId;
    const drawerName = room.players.find(p => p.id === data.drawerId)?.name;
    const opponent = room.players.find((p) => p.id !== myId);
    const opponentName = opponent ? opponent.name : "Opponent";
    return (
        <div className="flex h-screen bg-slate-900 text-white overflow-hidden">
            {/* LEFT: Video Call Sidebar */}
            <VideoCall roomCode={room.code} opponentName={opponentName} />

            {/* RIGHT: Game Board */}
            <div className="flex-1 overflow-y-auto p-8">
                <div className="max-w-5xl mx-auto h-full flex flex-col">

                    <div className="flex justify-between items-center bg-slate-800 p-6 rounded-2xl shadow-lg border border-slate-700 mb-6 shrink-0">
                        <div>
                            <h2 className="text-3xl font-bold text-violet-400">Draw & Guess</h2>
                            <p className="text-slate-400 mt-1">Scribble and solve before time runs out!</p>
                        </div>
                        {data.status === "drawing" && (
                            <div className={`text-4xl font-black ${timer <= 10 ? 'text-red-500 animate-pulse' : 'text-white'}`}>
                                {timer}s
                            </div>
                        )}
                        <button onClick={() => socket.emit("return_lobby", room.code)} className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm font-medium transition">
                            Exit to Lobby
                        </button>
                    </div>

                    <div className="flex-1 bg-slate-800 rounded-2xl border border-slate-700 shadow-xl overflow-hidden flex flex-col relative">

                        {data.status === "select_theme" && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-800/90 backdrop-blur-sm z-20">
                                <h3 className="text-3xl font-bold mb-8">Choose a Category</h3>
                                <div className="flex gap-4">
                                    {["animal", "thing", "person"].map(t => (
                                        <button key={t} onClick={() => socket.emit("g2_select_theme", { roomCode: room.code, theme: t })}
                                            className="bg-violet-600 hover:bg-violet-500 px-8 py-4 rounded-xl text-xl font-bold capitalize transition shadow-lg shadow-violet-500/20">
                                            {t}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {data.status === "rng_rolling" && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-800/95 z-20">
                                <div className="text-sm font-bold text-violet-400 uppercase tracking-widest mb-4">Selecting Drawer</div>
                                <h1 className="text-6xl font-black text-white animate-bounce">{rngDisplay}</h1>
                            </div>
                        )}

                        {data.status === "gameover" && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/95 z-30 p-8 text-center">
                                <div className="text-6xl mb-6">{data.winner !== "none" ? "🎉" : "⏳"}</div>
                                <h2 className="text-4xl font-black text-violet-400 mb-4">{data.reason}</h2>
                                {data.winner !== "none" && <p className="text-xl text-slate-300 mb-8">Winner: <span className="text-white font-bold">{room.players.find(p => p.id === data.winner)?.name}</span></p>}
                                <button onClick={() => socket.emit("return_lobby", room.code)} className="bg-violet-600 hover:bg-violet-500 px-8 py-3 rounded-xl font-bold transition">Play Again</button>
                            </div>
                        )}

                        {/* Main Drawing Area Layout */}
                        <div className="flex-1 flex flex-col lg:flex-row">

                            {/* Canvas Area */}
                            <div className="flex-1 p-6 flex flex-col items-center justify-center border-b lg:border-b-0 lg:border-r border-slate-700 bg-slate-800/50">
                                <div className="w-full max-w-[600px] mb-4 text-center">
                                    {isDrawer ? (
                                        <div className="bg-red-500/20 border border-red-500 text-red-300 py-3 px-6 rounded-xl font-medium text-lg inline-block">
                                            Draw: <span className="font-black text-white uppercase tracking-wider">{data.word}</span>
                                        </div>
                                    ) : (
                                        <div className="bg-blue-500/20 border border-blue-500 text-blue-300 py-3 px-6 rounded-xl font-medium text-lg inline-block">
                                            Guess what <span className="font-bold text-white">{drawerName}</span> is drawing!
                                        </div>
                                    )}
                                </div>

                                <div className="bg-white p-2 rounded-xl shadow-inner relative w-full max-w-[600px] aspect-video">
                                    {/* Overlay blocker for guesser */}
                                    {!isDrawer && <div className="absolute inset-0 z-10" />}
                                    <canvas
                                        ref={canvasRef}
                                        width={600}
                                        height={337}
                                        className={`w-full h-full bg-white rounded-lg ${isDrawer ? 'cursor-crosshair' : 'cursor-default'}`}
                                        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseOut={onMouseUp}
                                    />
                                </div>

                                {isDrawer && (
                                    <button onClick={clearCanvas} className="mt-4 bg-slate-700 hover:bg-slate-600 text-white px-6 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                        Clear Canvas
                                    </button>
                                )}
                            </div>

                            {/* Chat / Guesses Area */}
                            <div className="w-full lg:w-80 flex flex-col bg-slate-900/50">
                                <div className="p-4 border-b border-slate-700 bg-slate-800 font-semibold text-slate-300">Live Guesses</div>
                                <div className="flex-1 p-4 overflow-y-auto space-y-3">
                                    {chatLog.length === 0 && <p className="text-slate-500 text-sm text-center italic mt-4">No guesses yet...</p>}
                                    {chatLog.map((log, i) => (
                                        <div key={i} className="text-sm">
                                            <span className="font-bold text-violet-400">{log.name}: </span>
                                            <span className="text-slate-300">{log.guess}</span>
                                        </div>
                                    ))}
                                </div>

                                {!isDrawer && data.status === "drawing" && (
                                    <div className="p-4 bg-slate-800 border-t border-slate-700">
                                        <div className="flex gap-2">
                                            <input
                                                className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-violet-500 placeholder-slate-500 text-sm"
                                                placeholder="Type guess..."
                                                value={guessInput}
                                                onChange={e => setGuessInput(e.target.value)}
                                                onKeyDown={e => e.key === "Enter" && submitGuess()}
                                            />
                                            <button onClick={submitGuess} className="bg-violet-600 hover:bg-violet-500 px-4 py-2 rounded-lg text-sm font-bold transition">
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
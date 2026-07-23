import React, { useState, useEffect, useRef } from "react";
import { socket } from "./socket";
import VideoCall from "./VideoCall";
import { type Room } from "./App";

interface Props {
    room: Room;
    myId: string;
}

export default function DetectiveCaricature({ room, myId }: Props) {
    const [gameState, setGameState] = useState<any>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const isDrawingRef = useRef(false);

    const opponent = room.players.find((p) => p.id !== myId);
    const opponentName = opponent ? opponent.name : "Opponent";

    useEffect(() => {
        const handleDetectiveUpdated = (data: any) => setGameState(data);
        socket.on("detective_updated", handleDetectiveUpdated);

        return () => {
            socket.off("detective_updated", handleDetectiveUpdated);
        };
    }, []);

    const handleEndGameWithScore = (success: boolean) => {
        socket.emit("detective_end", { roomCode: room.code, success });
    };

    const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
        if (!canvasRef.current) return { x: 0, y: 0 };
        const rect = canvasRef.current.getBoundingClientRect();

        let clientX = 0;
        let clientY = 0;

        if ("touches" in e) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        return {
            x: clientX - rect.left,
            y: clientY - rect.top,
        };
    };

    const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
        if (!gameState || gameState.myRole !== "artist" || gameState.gameStatus !== "playing") return;
        isDrawingRef.current = true;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const { x, y } = getCanvasCoordinates(e);
        ctx.beginPath();
        ctx.moveTo(x, y);
    };

    const stopDrawing = () => {
        if (!isDrawingRef.current) return;
        isDrawingRef.current = false;

        if (canvasRef.current) {
            const dataUrl = canvasRef.current.toDataURL();
            socket.emit("detective_sync_canvas", { roomCode: room.code, canvasData: dataUrl });
        }
    };

    const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
        if (!isDrawingRef.current || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const { x, y } = getCanvasCoordinates(e);

        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.strokeStyle = "#ffffff";

        ctx.lineTo(x, y);
        ctx.stroke();
    };

    if (!gameState) {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-slate-900 text-white">
                <h1 className="text-3xl font-black mb-4">🕵️‍♂️ Detective Caricature</h1>
                <div className="animate-spin text-4xl mt-4">⏳</div>
            </div>
        );
    }

    const { myRole, timeLeft, gameStatus, suspectImage, finalCanvas } = gameState;

    return (
        <div className="flex flex-col md:flex-row h-screen bg-slate-950 text-white overflow-hidden">
            <div className="w-full md:w-80 h-64 md:h-full border-b md:border-b-0 md:border-r border-slate-800 shrink-0 flex flex-col">
                <VideoCall roomCode={room.code} opponentName={opponentName} />
                <div className="p-4 mt-auto">
                    <button onClick={() => socket.emit("return_lobby", room.code)} className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-2 rounded-xl transition text-sm">
                        Exit to Lobby
                    </button>
                </div>
            </div>

            <div className="flex-1 flex flex-col p-4 overflow-y-auto">
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex justify-between items-center mb-4">
                    <div>
                        <h1 className="text-xl font-bold">Role: <span className={myRole === "describer" ? "text-amber-400" : "text-emerald-400"}>{myRole.toUpperCase()}</span></h1>
                        <p className="text-xs text-slate-400">
                            {myRole === "describer" ? "Describe the suspect face features to the artist!" : "Draw the suspect sketch based on vocal clues!"}
                        </p>
                    </div>
                    <div className="text-center">
                        <span className="text-xs text-slate-400 block">TIME REMAINING</span>
                        <span className="text-2xl font-mono font-bold text-amber-400">{timeLeft}s</span>
                    </div>
                </div>

                {gameStatus === "playing" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
                        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col items-center justify-center">
                            <h2 className="text-xs font-bold text-slate-400 mb-3 uppercase">Suspect Target Photo</h2>
                            {myRole === "describer" ? (
                                <img src={suspectImage} alt="Suspect" className="max-h-80 rounded-xl object-cover shadow-lg border border-slate-700" />
                            ) : (
                                <div className="h-80 w-full bg-slate-950 rounded-xl flex items-center justify-center text-slate-600 text-sm font-semibold border border-slate-800">
                                    🔒 HIDDEN FROM ARTIST
                                </div>
                            )}
                        </div>

                        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col items-center justify-center">
                            <h2 className="text-xs font-bold text-slate-400 mb-3 uppercase">Caricature Sketch Board</h2>
                            <canvas
                                ref={canvasRef}
                                width={350}
                                height={320}
                                onMouseDown={startDrawing}
                                onMouseUp={stopDrawing}
                                onMouseLeave={stopDrawing}
                                onMouseMove={draw}
                                onTouchStart={startDrawing}
                                onTouchEnd={stopDrawing}
                                onTouchMove={draw}
                                className={`bg-slate-950 rounded-xl border border-slate-800 touch-none ${myRole === "artist" ? "cursor-crosshair bg-slate-900" : "pointer-events-none"}`}
                            />
                        </div>
                    </div>
                )}

                {gameStatus === "reveal" && (
                    <div className="flex-1 bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center">
                        <h2 className="text-2xl font-black text-amber-400 mb-6">🎭 THE REVEAL COMPARISON</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-2xl w-full mb-6">
                            <div className="text-center">
                                <span className="text-xs font-bold text-slate-400 block mb-2">ORIGINAL SUSPECT</span>
                                <img src={suspectImage} alt="Original Suspect" className="w-full h-64 rounded-xl object-cover border border-slate-700 shadow-xl" />
                            </div>
                            <div className="text-center">
                                <span className="text-xs font-bold text-slate-400 block mb-2">ARTIST SKETCH</span>
                                <img src={finalCanvas || "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="} alt="Artist Sketch" className="w-full h-64 rounded-xl object-cover border border-slate-700 shadow-xl bg-slate-950" />
                            </div>
                        </div>

                        <div className="flex gap-4">
                            <button onClick={() => handleEndGameWithScore(true)} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-6 py-3 rounded-xl transition">
                                Good Match! (+5 pts)
                            </button>
                            <button onClick={() => handleEndGameWithScore(false)} className="bg-red-600 hover:bg-red-500 text-white font-bold px-6 py-3 rounded-xl transition">
                                Terrible Match (0 pts)
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
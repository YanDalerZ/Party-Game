import { useState, useEffect, useRef } from "react";
import { socket } from "./socket";
import VideoCall from "./VideoCall";

interface Props {
    room: { code: string; players: { id: string; name: string }[] };
    myId: string;
}

export default function DetectiveCaricature({ room, myId }: Props) {
    const [gameState, setGameState] = useState<any>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [isDrawing, setIsDrawing] = useState(false);

    const opponent = room.players.find((p) => p.id !== myId);
    const opponentName = opponent ? opponent.name : "Opponent";

    useEffect(() => {
        socket.on("detective_updated", (data) => setGameState(data));
        return () => {
            socket.off("detective_updated");
        };
    }, []);

    const handleStartGame = () => {
        socket.emit("detective_start", room.code);
    };

    const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!gameState || gameState.myRole !== "artist" || gameState.gameStatus !== "playing") return;
        setIsDrawing(true);
        draw(e);
    };

    const stopDrawing = () => {
        setIsDrawing(false);
        if (canvasRef.current) {
            const dataUrl = canvasRef.current.toDataURL();
            socket.emit("detective_sync_canvas", { roomCode: room.code, canvasData: dataUrl });
        }
    };

    const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isDrawing || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.strokeStyle = "#ffffff";

        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
    };

    if (!gameState) {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-slate-900 text-white">
                <h1 className="text-3xl font-black mb-4">🕵️‍♂️ Detective Caricature</h1>
                <p className="text-slate-400 text-sm mb-6 max-w-md text-center">
                    One player describes a suspect's face while the other draws it blind without seeing the photo in 60 seconds!
                </p>
                <button onClick={handleStartGame} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-6 py-3 rounded-xl transition">
                    Randomize Roles & Start 🚀
                </button>
            </div>
        );
    }

    const { myRole, timeLeft, gameStatus, suspectImage, finalCanvas } = gameState;

    return (
        <div className="flex flex-col md:flex-row h-screen bg-slate-950 text-white overflow-hidden">
            <div className="w-full md:w-80 h-64 md:h-full border-b md:border-b-0 md:border-r border-slate-800 shrink-0">
                <VideoCall roomCode={room.code} opponentName={opponentName} />
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
                        {/* Left side: Suspect photo (Only visible to describer) */}
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

                        {/* Right side: Drawing Canvas */}
                        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col items-center justify-center">
                            <h2 className="text-xs font-bold text-slate-400 mb-3 uppercase">Caricature Sketch Board</h2>
                            <canvas
                                ref={canvasRef}
                                width={350}
                                height={320}
                                onMouseDown={startDrawing}
                                onMouseUp={stopDrawing}
                                onMouseMove={draw}
                                className={`bg-slate-950 rounded-xl border border-slate-800 ${myRole === "artist" ? "cursor-crosshair" : "pointer-events-none"}`}
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
                                <img src={suspectImage} className="w-full h-64 rounded-xl object-cover border border-slate-700 shadow-xl" />
                            </div>
                            <div className="text-center">
                                <span className="text-xs font-bold text-slate-400 block mb-2">ARTIST SKETCH</span>
                                <img src={finalCanvas || "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="} className="w-full h-64 rounded-xl object-cover border border-slate-700 shadow-xl bg-slate-950" />
                            </div>
                        </div>
                        <button onClick={handleStartGame} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-6 py-3 rounded-xl transition">
                            Next Round 🔄
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
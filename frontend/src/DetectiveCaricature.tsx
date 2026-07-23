import React, { useState, useEffect, useRef } from "react";
import { socket } from "./socket";
export interface Player {
    id: string;
    name: string;
}
export interface Room {
    code: string;
    players: Player[];
    currentGame: string | null;
    gameData: any;
    scores: Record<string, number>;
    globalScores: Record<string, number>;
}
interface DetectiveCaricatureProps {
    room: Room;
    myId: string;
}

export default function DetectiveCaricature({ room, myId: _myId }: DetectiveCaricatureProps) {
    const [gameState, setGameState] = useState<any>(room.gameData || {});

    // Drawing state
    const [isDrawing, setIsDrawing] = useState(false);
    const [brushColor, setBrushColor] = useState("#000000");
    const [brushSize, setBrushSize] = useState(5);
    const [isEraser, setIsEraser] = useState(false);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const contextRef = useRef<CanvasRenderingContext2D | null>(null);

    const COLORS = [
        { name: "Black", hex: "#000000" },
        { name: "Red", hex: "#ef4444" },
        { name: "Blue", hex: "#3b82f6" },
        { name: "Green", hex: "#22c55e" },
        { name: "Yellow", hex: "#eab308" },
        { name: "Brown", hex: "#92400e" },
    ];

    useEffect(() => {
        // Setup canvas
        const canvas = canvasRef.current;
        if (canvas) {
            // Set actual resolution
            canvas.width = 500;
            canvas.height = 500;

            const context = canvas.getContext("2d");
            if (context) {
                context.lineCap = "round";
                context.lineJoin = "round";
                // Fill white background initially
                context.fillStyle = "#ffffff";
                context.fillRect(0, 0, canvas.width, canvas.height);
                contextRef.current = context;
            }
        }
    }, [gameState.myRole]); // Re-run if role changes

    // Update context when brush settings change
    useEffect(() => {
        if (contextRef.current) {
            contextRef.current.strokeStyle = isEraser ? "#ffffff" : brushColor;
            contextRef.current.lineWidth = brushSize;
        }
    }, [brushColor, brushSize, isEraser]);

    useEffect(() => {
        socket.emit("get_detective_state", room.code);

        const handleUpdate = (data: any) => {
            setGameState(data);

            // If I am the describer, update my view of the canvas
            if (data.myRole === "describer" && data.finalCanvas && canvasRef.current) {
                const img = new Image();
                img.onload = () => {
                    const ctx = canvasRef.current?.getContext("2d");
                    if (ctx) {
                        ctx.clearRect(0, 0, 500, 500);
                        ctx.drawImage(img, 0, 0);
                    }
                };
                img.src = data.finalCanvas;
            }
        };

        socket.on("detective_updated", handleUpdate);

        return () => {
            socket.off("detective_updated", handleUpdate);
        };
    }, [room.code]);

    const startDrawing = ({ nativeEvent }: React.MouseEvent | React.TouchEvent) => {
        if (gameState.myRole !== "artist" || gameState.gameStatus !== "playing") return;

        let offsetX, offsetY;
        if ("touches" in nativeEvent) {
            const rect = canvasRef.current?.getBoundingClientRect();
            offsetX = nativeEvent.touches[0].clientX - (rect?.left || 0);
            offsetY = nativeEvent.touches[0].clientY - (rect?.top || 0);
        } else {
            offsetX = (nativeEvent as MouseEvent).offsetX;
            offsetY = (nativeEvent as MouseEvent).offsetY;
        }

        contextRef.current?.beginPath();
        contextRef.current?.moveTo(offsetX, offsetY);
        setIsDrawing(true);
    };

    const draw = ({ nativeEvent }: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing || gameState.myRole !== "artist" || gameState.gameStatus !== "playing") return;

        nativeEvent.preventDefault(); // Prevent scrolling on touch devices

        let offsetX, offsetY;
        if ("touches" in nativeEvent) {
            const rect = canvasRef.current?.getBoundingClientRect();
            offsetX = nativeEvent.touches[0].clientX - (rect?.left || 0);
            offsetY = nativeEvent.touches[0].clientY - (rect?.top || 0);
        } else {
            offsetX = (nativeEvent as MouseEvent).offsetX;
            offsetY = (nativeEvent as MouseEvent).offsetY;
        }

        contextRef.current?.lineTo(offsetX, offsetY);
        contextRef.current?.stroke();
    };

    const stopDrawing = () => {
        if (!isDrawing) return;
        contextRef.current?.closePath();
        setIsDrawing(false);

        // Sync to backend when stroke ends
        if (canvasRef.current) {
            const canvasData = canvasRef.current.toDataURL("image/png");
            socket.emit("detective_sync_canvas", { roomCode: room.code, canvasData });
        }
    };

    const clearCanvas = () => {
        if (contextRef.current && canvasRef.current) {
            contextRef.current.fillStyle = "#ffffff";
            contextRef.current.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            const canvasData = canvasRef.current.toDataURL("image/png");
            socket.emit("detective_sync_canvas", { roomCode: room.code, canvasData });
        }
    };

    const endGame = (success: boolean) => {
        socket.emit("detective_end", { roomCode: room.code, success });
    };

    if (!gameState.gameStatus) {
        return <div className="text-center p-8">Loading Detective Game...</div>;
    }

    return (
        <div className="flex-1 flex flex-col items-center justify-center p-4">
            <div className="max-w-4xl w-full bg-slate-800 p-6 rounded-2xl shadow-2xl border border-slate-700">

                {/* Header Area */}
                <div className="flex justify-between items-center mb-6 border-b border-slate-700 pb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-white">Detective Caricature 🔍</h2>
                        <p className="text-slate-400">
                            Role: <span className="font-semibold text-cyan-400 uppercase">{gameState.myRole}</span>
                        </p>
                    </div>
                    <div className="text-right">
                        <div className={`text-4xl font-mono font-black ${gameState.timeLeft <= 10 ? 'text-red-500 animate-pulse' : 'text-white'}`}>
                            00:{gameState.timeLeft.toString().padStart(2, '0')}
                        </div>
                        <p className="text-slate-400 text-sm">Time Remaining</p>
                    </div>
                </div>

                {/* Game Area */}
                <div className="flex flex-col md:flex-row gap-6">

                    {/* Left Column: Suspect Image (Describer) or Instructions (Artist) */}
                    <div className="flex-1 flex flex-col items-center bg-slate-900/50 p-4 rounded-xl border border-slate-600/50">
                        {gameState.myRole === "describer" ? (
                            <>
                                <h3 className="text-lg font-semibold text-white mb-4">Describe this Suspect!</h3>
                                {gameState.suspectImage ? (
                                    <img
                                        src={gameState.suspectImage}
                                        alt="Suspect"
                                        className="w-full max-w-sm rounded-lg shadow-md border-2 border-slate-700"
                                    />
                                ) : (
                                    <div className="w-full max-w-sm aspect-square bg-slate-700 animate-pulse rounded-lg" />
                                )}
                                <p className="mt-4 text-sm text-slate-400 text-center">
                                    Detail their face, hair, and accessories to the artist.
                                </p>
                            </>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-center p-6 space-y-4">
                                <div className="text-6xl">👂</div>
                                <h3 className="text-xl font-bold text-white">Listen Carefully!</h3>
                                <p className="text-slate-400">
                                    The Describer is looking at a photo. Draw exactly what they describe to catch the suspect.
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Right Column: Canvas & Toolbar */}
                    <div className="flex-1 flex flex-col items-center">
                        {/* Toolbar (Only for Artist) */}
                        {gameState.myRole === "artist" && gameState.gameStatus === "playing" && (
                            <div className="w-full max-w-sm flex flex-wrap gap-3 mb-4 p-3 bg-slate-900 rounded-xl border border-slate-700 items-center justify-center">

                                {/* Colors */}
                                <div className="flex gap-2 border-r border-slate-700 pr-3">
                                    {COLORS.map((c) => (
                                        <button
                                            key={c.name}
                                            onClick={() => { setBrushColor(c.hex); setIsEraser(false); }}
                                            className={`w-6 h-6 rounded-full border-2 transition-transform ${brushColor === c.hex && !isEraser ? 'scale-125 border-white' : 'border-transparent hover:scale-110'}`}
                                            style={{ backgroundColor: c.hex }}
                                            title={c.name}
                                        />
                                    ))}
                                </div>

                                {/* Eraser */}
                                <button
                                    onClick={() => setIsEraser(true)}
                                    className={`px-3 py-1 rounded-md text-sm font-bold transition-colors ${isEraser ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                                >
                                    Eraser
                                </button>

                                {/* Size Slider */}
                                <div className="flex items-center gap-2 pl-2">
                                    <span className="text-xs text-slate-400">Size:</span>
                                    <input
                                        type="range"
                                        min="1"
                                        max="20"
                                        value={brushSize}
                                        onChange={(e) => setBrushSize(parseInt(e.target.value))}
                                        className="w-20 accent-cyan-500"
                                    />
                                </div>

                                {/* Clear Canvas */}
                                <button
                                    onClick={clearCanvas}
                                    className="ml-auto text-xs text-red-400 hover:text-red-300 font-semibold"
                                >
                                    Clear
                                </button>
                            </div>
                        )}

                        {/* Canvas Area */}
                        <div className="relative">
                            <canvas
                                ref={canvasRef}
                                onMouseDown={startDrawing}
                                onMouseMove={draw}
                                onMouseUp={stopDrawing}
                                onMouseOut={stopDrawing}
                                onTouchStart={startDrawing}
                                onTouchMove={draw}
                                onTouchEnd={stopDrawing}
                                className={`bg-white rounded-lg shadow-inner cursor-crosshair border-4 ${gameState.gameStatus === "reveal" ? "border-amber-500" : "border-slate-600"
                                    }`}
                                style={{
                                    width: '100%',
                                    maxWidth: '400px',
                                    aspectRatio: '1/1',
                                    pointerEvents: (gameState.myRole === "artist" && gameState.gameStatus === "playing") ? 'auto' : 'none'
                                }}
                            />

                            {/* Describer Overlay Text */}
                            {gameState.myRole === "describer" && gameState.gameStatus === "playing" && (
                                <div className="absolute top-2 left-2 bg-slate-900/80 text-cyan-400 text-xs px-2 py-1 rounded font-semibold">
                                    Live View
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Post-Game Reveal Area */}
                {gameState.gameStatus === "reveal" && (
                    <div className="mt-8 pt-6 border-t border-slate-700 animate-fade-in-up">
                        <h3 className="text-2xl font-bold text-center text-amber-400 mb-6">Time's Up! The Reveal...</h3>

                        {gameState.myRole === "artist" && (
                            <div className="flex flex-col items-center mb-8">
                                <p className="text-slate-300 mb-4">Here is the actual suspect you were trying to draw:</p>
                                <img
                                    src={gameState.suspectImage}
                                    alt="Actual Suspect"
                                    className="w-full max-w-xs rounded-lg shadow-lg border-2 border-slate-600"
                                />
                            </div>
                        )}

                        <div className="flex justify-center gap-4">
                            <button
                                onClick={() => endGame(true)}
                                className="bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-8 rounded-lg shadow-lg shadow-green-500/30 transition-all"
                            >
                                It's a Match! (+5 pts)
                            </button>
                            <button
                                onClick={() => endGame(false)}
                                className="bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-8 rounded-lg shadow-lg shadow-red-500/30 transition-all"
                            >
                                No Resemblance
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
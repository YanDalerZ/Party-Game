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
            // Set internal drawing resolution
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

    // Helper to calculate exact coordinates relative to canvas internal scaling
    const getCanvasCoordinates = (nativeEvent: MouseEvent | TouchEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        let clientX = 0;
        let clientY = 0;

        if ("touches" in nativeEvent && nativeEvent.touches.length > 0) {
            clientX = nativeEvent.touches[0].clientX;
            clientY = nativeEvent.touches[0].clientY;
        } else if ("clientX" in nativeEvent) {
            clientX = (nativeEvent as MouseEvent).clientX;
            clientY = (nativeEvent as MouseEvent).clientY;
        }

        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY,
        };
    };

    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
        if (gameState.myRole !== "artist" || gameState.gameStatus !== "playing") return;

        const { x, y } = getCanvasCoordinates(e.nativeEvent);

        contextRef.current?.beginPath();
        contextRef.current?.moveTo(x, y);
        setIsDrawing(true);
    };

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing || gameState.myRole !== "artist" || gameState.gameStatus !== "playing") return;

        // Prevent touchscreen scrolling
        if (e.nativeEvent.cancelable) {
            e.nativeEvent.preventDefault();
        }

        const { x, y } = getCanvasCoordinates(e.nativeEvent);

        contextRef.current?.lineTo(x, y);
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
        return <div className="text-center p-8 text-white">Loading Detective Game...</div>;
    }

    const isArtist = gameState.myRole === "artist";

    return (
        <div className="flex-1 flex flex-col items-center justify-start sm:justify-center p-2 sm:p-4 touch-none select-none">
            <div className="max-w-4xl w-full bg-slate-800 p-3 sm:p-6 rounded-2xl shadow-2xl border border-slate-700">

                {/* Header Area */}
                <div className="flex justify-between items-center mb-3 sm:mb-6 border-b border-slate-700 pb-3">
                    <div>
                        <h2 className="text-lg sm:text-2xl font-bold text-white">Detective Caricature 🔍</h2>
                        <p className="text-xs sm:text-sm text-slate-400">
                            Role: <span className="font-semibold text-cyan-400 uppercase">{gameState.myRole}</span>
                        </p>
                    </div>
                    <div className="text-right">
                        <div className={`text-2xl sm:text-4xl font-mono font-black ${gameState.timeLeft <= 10 ? 'text-red-500 animate-pulse' : 'text-white'}`}>
                            00:{gameState.timeLeft.toString().padStart(2, '0')}
                        </div>
                        <p className="text-slate-400 text-xs sm:text-sm">Time Remaining</p>
                    </div>
                </div>

                {/* Compact Instruction Banner for Artist */}
                {isArtist && gameState.gameStatus === "playing" && (
                    <div className="mb-3 px-3 py-2 bg-slate-900/80 rounded-lg border border-slate-700/60 text-center flex items-center justify-center gap-2">
                        <span className="text-lg sm:text-xl">👂</span>
                        <p className="text-xs sm:text-sm text-slate-300">
                            <strong>Listen closely!</strong> Draw what the describer explains.
                        </p>
                    </div>
                )}

                {/* Game Area Layout */}
                <div className={`flex flex-col ${!isArtist ? 'md:flex-row' : ''} gap-4 sm:gap-6 items-center justify-center`}>

                    {/* Left Column: Only for Describer */}
                    {!isArtist && (
                        <div className="w-full md:flex-1 flex flex-col items-center bg-slate-900/50 p-3 sm:p-4 rounded-xl border border-slate-600/50">
                            <h3 className="text-base sm:text-lg font-semibold text-white mb-2 sm:mb-4">Describe this Suspect!</h3>
                            {gameState.suspectImage ? (
                                <img
                                    src={gameState.suspectImage}
                                    alt="Suspect"
                                    className="w-full max-w-xs sm:max-w-sm rounded-lg shadow-md border-2 border-slate-700 object-contain"
                                />
                            ) : (
                                <div className="w-full max-w-xs sm:max-w-sm aspect-square bg-slate-700 animate-pulse rounded-lg" />
                            )}
                            <p className="mt-2 sm:mt-4 text-xs sm:text-sm text-slate-400 text-center">
                                Detail their face, hair, and features to the artist.
                            </p>
                        </div>
                    )}

                    {/* Right/Main Column: Canvas & Toolbar */}
                    <div className="w-full flex-1 flex flex-col items-center">
                        
                        {/* Toolbar (Artist Only) */}
                        {isArtist && gameState.gameStatus === "playing" && (
                            <div className="w-full max-w-md flex flex-wrap gap-2 sm:gap-3 mb-3 p-2 sm:p-3 bg-slate-900 rounded-xl border border-slate-700 items-center justify-between">

                                {/* Colors */}
                                <div className="flex gap-1.5 sm:gap-2 border-r border-slate-700 pr-2 sm:pr-3">
                                    {COLORS.map((c) => (
                                        <button
                                            key={c.name}
                                            onClick={() => { setBrushColor(c.hex); setIsEraser(false); }}
                                            className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full border-2 transition-transform ${brushColor === c.hex && !isEraser ? 'scale-110 border-white ring-2 ring-cyan-400' : 'border-transparent hover:scale-105'}`}
                                            style={{ backgroundColor: c.hex }}
                                            title={c.name}
                                        />
                                    ))}
                                </div>

                                {/* Eraser */}
                                <button
                                    onClick={() => setIsEraser(!isEraser)}
                                    className={`px-2.5 py-1 rounded-md text-xs sm:text-sm font-bold transition-colors ${isEraser ? 'bg-cyan-600 text-white ring-2 ring-cyan-300' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                                >
                                    Eraser
                                </button>

                                {/* Size Slider */}
                                <div className="flex items-center gap-1.5 pl-1">
                                    <span className="text-xs text-slate-400 hidden sm:inline">Size:</span>
                                    <input
                                        type="range"
                                        min="2"
                                        max="25"
                                        value={brushSize}
                                        onChange={(e) => setBrushSize(parseInt(e.target.value))}
                                        className="w-16 sm:w-20 accent-cyan-500"
                                    />
                                </div>

                                {/* Clear Canvas */}
                                <button
                                    onClick={clearCanvas}
                                    className="text-xs text-red-400 hover:text-red-300 font-semibold px-1"
                                >
                                    Clear
                                </button>
                            </div>
                        )}

                        {/* Canvas Area Container */}
                        <div className="relative w-full max-w-md flex justify-center items-center">
                            <canvas
                                ref={canvasRef}
                                onMouseDown={startDrawing}
                                onMouseMove={draw}
                                onMouseUp={stopDrawing}
                                onMouseLeave={stopDrawing}
                                onTouchStart={startDrawing}
                                onTouchMove={draw}
                                onTouchEnd={stopDrawing}
                                className={`bg-white rounded-lg shadow-inner cursor-crosshair border-4 touch-none ${gameState.gameStatus === "reveal" ? "border-amber-500" : "border-slate-600"
                                    }`}
                                style={{
                                    width: '100%',
                                    aspectRatio: '1/1',
                                    touchAction: 'none',
                                    pointerEvents: (isArtist && gameState.gameStatus === "playing") ? 'auto' : 'none'
                                }}
                            />

                            {/* Describer Overlay Badge */}
                            {gameState.myRole === "describer" && gameState.gameStatus === "playing" && (
                                <div className="absolute top-2 left-2 bg-slate-900/80 text-cyan-400 text-xs px-2 py-1 rounded font-semibold backdrop-blur-sm">
                                    Live Drawing View
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Post-Game Reveal Area */}
                {gameState.gameStatus === "reveal" && (
                    <div className="mt-6 sm:mt-8 pt-4 sm:pt-6 border-t border-slate-700">
                        <h3 className="text-xl sm:text-2xl font-bold text-center text-amber-400 mb-4 sm:mb-6">Time's Up! The Reveal...</h3>

                        {isArtist && (
                            <div className="flex flex-col items-center mb-6">
                                <p className="text-xs sm:text-sm text-slate-300 mb-3">Here is the actual suspect you were trying to draw:</p>
                                <img
                                    src={gameState.suspectImage}
                                    alt="Actual Suspect"
                                    className="w-full max-w-xs rounded-lg shadow-lg border-2 border-slate-600"
                                />
                            </div>
                        )}

                        <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4">
                            <button
                                onClick={() => endGame(true)}
                                className="w-full sm:w-auto bg-green-600 hover:bg-green-500 text-white font-bold py-2.5 sm:py-3 px-6 rounded-lg shadow-lg shadow-green-500/20 transition-all text-sm sm:text-base"
                            >
                                It's a Match! (+5 pts)
                            </button>
                            <button
                                onClick={() => endGame(false)}
                                className="w-full sm:w-auto bg-red-600 hover:bg-red-500 text-white font-bold py-2.5 sm:py-3 px-6 rounded-lg shadow-lg shadow-red-500/20 transition-all text-sm sm:text-base"
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
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
    const [brushOpacity, setBrushOpacity] = useState(1);
    const [brushShape, setBrushShape] = useState<CanvasLineCap>("round");
    const [isEraser, setIsEraser] = useState(false);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const contextRef = useRef<CanvasRenderingContext2D | null>(null);

    // Expanded Palette
    const COLORS = [
        { name: "Black", hex: "#000000" },
        { name: "White", hex: "#ffffff" },
        { name: "Gray", hex: "#6b7280" },
        { name: "Red", hex: "#ef4444" },
        { name: "Orange", hex: "#f97316" },
        { name: "Yellow", hex: "#eab308" },
        { name: "Green", hex: "#22c55e" },
        { name: "Teal", hex: "#14b8a6" },
        { name: "Blue", hex: "#3b82f6" },
        { name: "Indigo", hex: "#6366f1" },
        { name: "Purple", hex: "#a855f7" },
        { name: "Brown", hex: "#92400e" },
    ];

    const BRUSH_SIZES = [2, 5, 10, 20, 35];

    useEffect(() => {
        // Setup canvas
        const canvas = canvasRef.current;
        if (canvas) {
            canvas.width = 500;
            canvas.height = 500;

            const context = canvas.getContext("2d");
            if (context) {
                context.lineCap = brushShape;
                context.lineJoin = brushShape === "square" ? "miter" : "round";
                context.fillStyle = "#ffffff";
                context.fillRect(0, 0, canvas.width, canvas.height);
                contextRef.current = context;
            }
        }
    }, [gameState.myRole]);

    // Convert HEX color + opacity slider value into RGBA string for canvas stroke
    const getStrokeStyle = () => {
        if (isEraser) return "#ffffff";

        let hex = brushColor.replace("#", "");
        if (hex.length === 3) {
            hex = hex.split("").map((c) => c + c).join("");
        }
        const r = parseInt(hex.substring(0, 2), 16) || 0;
        const g = parseInt(hex.substring(2, 4), 16) || 0;
        const b = parseInt(hex.substring(4, 6), 16) || 0;

        return `rgba(${r}, ${g}, ${b}, ${brushOpacity})`;
    };

    // Update context properties on tool change
    useEffect(() => {
        if (contextRef.current) {
            contextRef.current.strokeStyle = getStrokeStyle();
            contextRef.current.lineWidth = brushSize;
            contextRef.current.lineCap = brushShape;
            contextRef.current.lineJoin = brushShape === "square" ? "miter" : "round";
        }
    }, [brushColor, brushSize, brushOpacity, brushShape, isEraser]);

    useEffect(() => {
        socket.emit("get_detective_state", room.code);

        const handleUpdate = (data: any) => {
            if (data) {
                setGameState(data);

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
            }
        };

        socket.on("detective_updated", handleUpdate);

        return () => {
            socket.off("detective_updated", handleUpdate);
        };
    }, [room.code]);

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

    const handleExitGame = () => {
        if (window.confirm("Are you sure you want to return to the game dashboard?")) {
            socket.emit("exit_to_dashboard", { roomCode: room.code });
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
                        <h2 className="text-lg sm:text-2xl font-bold text-white flex items-center gap-2">
                            Detective Caricature 🔍
                        </h2>
                        <p className="text-xs sm:text-sm text-slate-400">
                            Role: <span className="font-semibold text-cyan-400 uppercase">{gameState.myRole}</span>
                        </p>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="text-right">
                            <div className={`text-2xl sm:text-4xl font-mono font-black ${gameState.timeLeft <= 10 ? 'text-red-500 animate-pulse' : 'text-white'}`}>
                                00:{(gameState.timeLeft ?? 0).toString().padStart(2, '0')}
                            </div>
                            <p className="text-slate-400 text-xs sm:text-sm">Time Remaining</p>
                        </div>

                        {/* Exit Button */}
                        <button
                            onClick={handleExitGame}
                            className="bg-red-600 hover:bg-red-500 text-white font-bold text-xs sm:text-sm px-3 py-2 sm:px-4 sm:py-2.5 rounded-lg shadow-md transition-all flex items-center gap-1.5"
                            title="Return to Dashboard"
                        >
                            <span>🚪</span>
                            <span className="hidden sm:inline">Exit to Dashboard</span>
                        </button>
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

                    {/* Right/Main Column: Canvas & Extended Toolbar */}
                    <div className="w-full flex-1 flex flex-col items-center">

                        {/* Expanded Painting Toolbar (Artist Only) */}
                        {isArtist && gameState.gameStatus === "playing" && (
                            <div className="w-full max-w-md flex flex-col gap-2.5 mb-3 p-3 bg-slate-900 rounded-xl border border-slate-700">

                                {/* Row 1: Tools, Shapes, Clear */}
                                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setIsEraser(false)}
                                            className={`px-3 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1 ${!isEraser ? 'bg-cyan-600 text-white ring-2 ring-cyan-300' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                                        >
                                            ✏️ Brush
                                        </button>
                                        <button
                                            onClick={() => setIsEraser(true)}
                                            className={`px-3 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1 ${isEraser ? 'bg-cyan-600 text-white ring-2 ring-cyan-300' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                                        >
                                            扫 Eraser
                                        </button>
                                    </div>

                                    {/* Brush Shape Toggle */}
                                    <div className="flex bg-slate-800 p-0.5 rounded-md border border-slate-700">
                                        <button
                                            onClick={() => setBrushShape("round")}
                                            className={`px-2 py-0.5 rounded text-xs ${brushShape === "round" ? "bg-cyan-500 text-white font-bold" : "text-slate-400"}`}
                                            title="Round Cap"
                                        >
                                            ● Round
                                        </button>
                                        <button
                                            onClick={() => setBrushShape("square")}
                                            className={`px-2 py-0.5 rounded text-xs ${brushShape === "square" ? "bg-cyan-500 text-white font-bold" : "text-slate-400"}`}
                                            title="Square Cap"
                                        >
                                            ■ Square
                                        </button>
                                    </div>

                                    <button
                                        onClick={clearCanvas}
                                        className="text-xs bg-red-950/60 hover:bg-red-900 text-red-400 border border-red-800/80 font-semibold px-2 py-1 rounded transition-colors"
                                    >
                                        Clear
                                    </button>
                                </div>

                                {/* Row 2: Color Palette + Custom Picker */}
                                <div className="flex items-center gap-1.5 flex-wrap border-b border-slate-800 pb-2">
                                    {COLORS.map((c) => (
                                        <button
                                            key={c.name}
                                            onClick={() => { setBrushColor(c.hex); setIsEraser(false); }}
                                            className={`w-6 h-6 rounded-full border-2 transition-transform ${brushColor === c.hex && !isEraser ? 'scale-125 border-white ring-2 ring-cyan-400 z-10' : 'border-transparent hover:scale-110'}`}
                                            style={{ backgroundColor: c.hex }}
                                            title={c.name}
                                        />
                                    ))}

                                    {/* Custom Color Input */}
                                    <label title="Custom Color" className="relative cursor-pointer w-6 h-6 rounded-full overflow-hidden border border-slate-500 flex items-center justify-center bg-slate-800 hover:scale-110 transition-transform">
                                        <span className="text-[10px] text-white pointer-events-none">🎨</span>
                                        <input
                                            type="color"
                                            value={brushColor}
                                            onChange={(e) => { setBrushColor(e.target.value); setIsEraser(false); }}
                                            className="absolute -top-2 -left-2 w-10 h-10 cursor-pointer opacity-0"
                                        />
                                    </label>
                                </div>

                                {/* Row 3: Brush Controls (Presets, Size, Opacity) */}
                                <div className="flex flex-col gap-2">
                                    {/* Size Presets & Slider */}
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-1">
                                            <span className="text-[11px] text-slate-400 mr-1">Presets:</span>
                                            {BRUSH_SIZES.map((size) => (
                                                <button
                                                    key={size}
                                                    onClick={() => setBrushSize(size)}
                                                    className={`w-5 h-5 rounded flex items-center justify-center text-[10px] ${brushSize === size ? "bg-cyan-500 text-white font-bold" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
                                                >
                                                    {size}
                                                </button>
                                            ))}
                                        </div>

                                        <div className="flex items-center gap-1.5 flex-1 justify-end">
                                            <span className="text-[11px] text-slate-400">Size ({brushSize}px):</span>
                                            <input
                                                type="range"
                                                min="1"
                                                max="40"
                                                value={brushSize}
                                                onChange={(e) => setBrushSize(parseInt(e.target.value))}
                                                className="w-20 accent-cyan-500 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                                            />
                                        </div>
                                    </div>

                                    {/* Opacity Slider */}
                                    {!isEraser && (
                                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/60">
                                            <span className="text-[11px] text-slate-400">Opacity ({Math.round(brushOpacity * 100)}%):</span>
                                            <input
                                                type="range"
                                                min="0.1"
                                                max="1"
                                                step="0.05"
                                                value={brushOpacity}
                                                onChange={(e) => setBrushOpacity(parseFloat(e.target.value))}
                                                className="w-32 accent-cyan-500 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                                            />
                                        </div>
                                    )}
                                </div>
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
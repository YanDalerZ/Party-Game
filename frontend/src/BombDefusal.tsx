import { useState, useEffect } from "react";
import { socket } from "./socket";
import VideoCall from "./VideoCall";
import { type Room } from "./App";

interface Props {
    room: Room;
    myId: string;
}

export default function BombDefusal({ room, myId }: Props) {
    const [gameState, setGameState] = useState<any>(null);
    const [passwordInput, setPasswordInput] = useState("");
    const [keypadInput, setKeypadInput] = useState<number[]>([]);

    const opponent = room.players.find((p) => p.id !== myId);
    const opponentName = opponent ? opponent.name : "Opponent";

    useEffect(() => {
        const handleBombUpdated = (data: any) => setGameState(data);
        socket.on("bomb_updated", handleBombUpdated);

        return () => {
            socket.off("bomb_updated", handleBombUpdated);
        };
    }, []);

    const startNewGame = () => {
        socket.emit("bomb_start", room.code);
    };

    const handleWireCut = (index: number) => {
        if (!gameState || gameState.role !== "defuser" || gameState.gameStatus !== "playing") return;
        socket.emit("bomb_action", { roomCode: room.code, type: "cut_wire", wireIndex: index });
    };

    const handlePasswordSubmit = () => {
        if (!passwordInput.trim()) return;
        socket.emit("bomb_action", { roomCode: room.code, type: "submit_password", password: passwordInput.toUpperCase() });
        setPasswordInput("");
    };

    const handleKeypadPress = (num: number) => {
        const updated = [...keypadInput, num];
        setKeypadInput(updated);
        if (updated.length === 4) {
            socket.emit("bomb_action", { roomCode: room.code, type: "submit_keypad", code: updated.join("") });
            setKeypadInput([]);
        }
    };

    const handleButtonClick = () => {
        socket.emit("bomb_action", { roomCode: room.code, type: "press_button" });
    };

    if (!gameState) {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-slate-900 text-white">
                <h1 className="text-3xl font-black mb-4">🧨 Bomb Defusal Co-Op</h1>
                <div className="animate-spin text-4xl mt-4">⏳</div>
            </div>
        );
    }

    const { role, timeLeft, strikes, gameStatus, config, manual } = gameState;

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
                        <h1 className="text-xl font-bold">Role: <span className={role === "defuser" ? "text-red-400" : "text-blue-400"}>{role.toUpperCase()}</span></h1>
                        <p className="text-xs text-slate-400">
                            {role === "defuser" ? "Describe your bomb screen to the expert!" : "Guide the defuser using your manual!"}
                        </p>
                    </div>
                    <div className="flex items-center gap-6">
                        <div className="text-center">
                            <span className="text-xs text-slate-400 block">TIME LEFT</span>
                            <span className={`text-2xl font-mono font-bold ${timeLeft <= 30 ? "text-red-500 animate-pulse" : "text-emerald-400"}`}>
                                {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, "0")}
                            </span>
                        </div>
                        <div className="text-center">
                            <span className="text-xs text-slate-400 block">STRIKES</span>
                            <span className="text-2xl font-bold text-red-500">{"❌".repeat(strikes) || "NONE"}</span>
                        </div>
                    </div>
                </div>

                {gameStatus === "gameover" && (
                    <div className="flex-1 flex flex-col items-center justify-center bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center">
                        <h2 className={`text-3xl font-black mb-2 ${gameState.winner ? "text-emerald-400" : "text-red-500"}`}>
                            {gameState.winner ? "🎉 BOMB DEFUSED SUCCESSFULLY! (+10 pts each)" : "💥 BOOM! BOMB EXPLODED!"}
                        </h2>
                        <button onClick={startNewGame} className="mt-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-6 py-2.5 rounded-xl transition">
                            Play Again 🔄
                        </button>
                    </div>
                )}

                {gameStatus === "playing" && role === "defuser" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
                        <div className={`p-4 bg-slate-900 border rounded-2xl ${config.wiresDefused ? "border-emerald-500/50" : "border-slate-800"}`}>
                            <div className="flex justify-between mb-2">
                                <span className="text-xs font-bold text-slate-400">MODULE 1: WIRES</span>
                                {config.wiresDefused && <span className="text-xs text-emerald-400 font-bold">✓ SOLVED</span>}
                            </div>
                            <div className="flex justify-around items-center h-32 bg-slate-950 rounded-xl p-2">
                                {config.wires.map((wire: string, idx: number) => (
                                    <button
                                        key={idx}
                                        disabled={config.cutWires.includes(idx) || config.wiresDefused}
                                        onClick={() => handleWireCut(idx)}
                                        className={`w-6 h-28 rounded-full border-2 transition ${config.cutWires.includes(idx) ? "bg-slate-800 border-slate-700 opacity-20" : `${wire} border-white/20 hover:scale-105`}`}
                                    />
                                ))}
                            </div>
                        </div>

                        <div className={`p-4 bg-slate-900 border rounded-2xl ${config.keypadDefused ? "border-emerald-500/50" : "border-slate-800"}`}>
                            <div className="flex justify-between mb-2">
                                <span className="text-xs font-bold text-slate-400">MODULE 2: KEYPAD CODE</span>
                                {config.keypadDefused && <span className="text-xs text-emerald-400 font-bold">✓ SOLVED</span>}
                            </div>
                            <div className="flex flex-col items-center gap-2">
                                <div className="font-mono bg-slate-950 text-amber-400 px-4 py-2 rounded-lg text-lg tracking-widest w-full text-center">
                                    {keypadInput.join("") || "____"}
                                </div>
                                <div className="grid grid-cols-3 gap-2 w-full max-w-[180px]">
                                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                                        <button key={n} onClick={() => handleKeypadPress(n)} className="bg-slate-800 hover:bg-slate-700 p-2 rounded-lg text-sm font-bold">
                                            {n}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className={`p-4 bg-slate-900 border rounded-2xl ${config.passwordDefused ? "border-emerald-500/50" : "border-slate-800"}`}>
                            <div className="flex justify-between mb-2">
                                <span className="text-xs font-bold text-slate-400">MODULE 3: DECRYPTOR</span>
                                {config.passwordDefused && <span className="text-xs text-emerald-400 font-bold">✓ SOLVED</span>}
                            </div>
                            <div className="flex flex-col gap-2">
                                <input
                                    type="text"
                                    maxLength={5}
                                    value={passwordInput}
                                    onChange={(e) => setPasswordInput(e.target.value)}
                                    placeholder="Enter 5-letter code"
                                    className="bg-slate-950 border border-slate-800 p-2 rounded-lg text-center font-mono uppercase text-sm"
                                />
                                <button onClick={handlePasswordSubmit} className="bg-indigo-600 hover:bg-indigo-500 p-2 rounded-lg text-xs font-bold">
                                    Submit Password 🔓
                                </button>
                            </div>
                        </div>

                        <div className={`p-4 bg-slate-900 border rounded-2xl ${config.buttonDefused ? "border-emerald-500/50" : "border-slate-800"} flex flex-col justify-between`}>
                            <div className="flex justify-between mb-2">
                                <span className="text-xs font-bold text-slate-400">MODULE 4: POWER BUTTON</span>
                                {config.buttonDefused && <span className="text-xs text-emerald-400 font-bold">✓ SOLVED</span>}
                            </div>
                            <button
                                onClick={handleButtonClick}
                                disabled={config.buttonDefused}
                                className={`w-full py-8 rounded-2xl font-black text-xl shadow-lg border-2 ${config.buttonColor} transition hover:brightness-110`}
                            >
                                {config.buttonText}
                            </button>
                        </div>
                    </div>
                )}

                {gameStatus === "playing" && role === "expert" && (
                    <div className="flex-1 bg-slate-900 border border-slate-800 rounded-2xl p-6 font-mono text-xs overflow-y-auto space-y-6">
                        <h2 className="text-lg font-bold text-blue-400 border-b border-slate-800 pb-2">📋 DEFUSAL MANUAL SHEET</h2>

                        <div className="space-y-1">
                            <h3 className="font-bold text-amber-400">1. WIRES SECTION:</h3>
                            <p>• If there is a <span className="text-red-400">RED</span> wire and more than 3 total wires: Cut the 2nd wire.</p>
                            <p>• If there is a <span className="text-blue-400">BLUE</span> wire and no red wire: Cut the last wire.</p>
                            <p>• Otherwise: Cut the 1st wire.</p>
                        </div>

                        <div className="space-y-1">
                            <h3 className="font-bold text-amber-400">2. KEYPAD CODE:</h3>
                            <p>• The code sequence required is: <span className="text-emerald-400 font-bold">{manual.keypadCode}</span></p>
                        </div>

                        <div className="space-y-1">
                            <h3 className="font-bold text-amber-400">3. DECRYPTOR PASSWORD:</h3>
                            <p>• Tell the defuser to enter: <span className="text-emerald-400 font-bold">{manual.password}</span></p>
                        </div>

                        <div className="space-y-1">
                            <h3 className="font-bold text-amber-400">4. BIG BUTTON:</h3>
                            <p>• If button says <span className="text-red-400">DETONATE</span>: Click it immediately.</p>
                            <p>• If button says <span className="text-blue-400">HOLD</span>: Click it only when the timer seconds end in an even number.</p>
                            <p>• Otherwise: Click it directly.</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
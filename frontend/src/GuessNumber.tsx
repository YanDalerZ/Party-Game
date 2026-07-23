import { useState, useEffect } from "react";
import { socket } from "./socket";
import { type Room } from "./App";
import VideoCall from "./VideoCall";

interface Props {
    room: Room;
    myId: string;
}

export default function GuessNumber({ room, myId }: Props) {
    const [data, setData] = useState(room.gameData);
    const [secretInput, setSecretInput] = useState("");
    const [guessInput, setGuessInput] = useState("");

    useEffect(() => {
        socket.on("g1_updated", (newData: any) => setData(newData));
        return () => {
            socket.off("g1_updated");
        };
    }, []);

    const isP1 = room.players[0]?.id === myId;
    const mySecret = isP1 ? data?.p1Secret : data?.p2Secret;
    const myGuesses = (isP1 ? data?.p1Guesses : data?.p2Guesses) || [];
    const oppGuesses = (isP1 ? data?.p2Guesses : data?.p1Guesses) || [];

    const submitSecret = () => {
        const parsedSecret = parseInt(secretInput, 10);
        if (isNaN(parsedSecret)) return;

        socket.emit("g1_set_secret", {
            roomCode: room.code,
            secret: parsedSecret
        });
    };

    const submitGuess = () => {
        const parsedGuess = parseInt(guessInput, 10);
        if (isNaN(parsedGuess)) return;

        socket.emit("g1_guess", {
            roomCode: room.code,
            guess: parsedGuess
        });
        setGuessInput("");
    };
    const opponent = room.players.find((p) => p.id !== myId);
    const opponentName = opponent ? opponent.name : "Opponent";
    return (
        <div className="flex h-screen bg-slate-900 text-white overflow-hidden">
            {/* LEFT: Video Call Sidebar */}
            <VideoCall roomCode={room.code} opponentName={opponentName} />

            {/* RIGHT: Game Board */}
            <div className="flex-1 overflow-y-auto p-8">
                <div className="max-w-3xl mx-auto">
                    <div className="flex justify-between items-center bg-slate-800 p-6 rounded-2xl shadow-lg border border-slate-700 mb-8">
                        <div>
                            <h2 className="text-3xl font-bold text-blue-400">Guess The Number</h2>
                            <p className="text-slate-400 mt-1">Crack your opponent's secret code in 10 tries!</p>
                        </div>
                        <button
                            onClick={() => socket.emit("return_lobby", room.code)}
                            className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm font-medium transition"
                        >
                            Exit to Lobby
                        </button>
                    </div>

                    {data?.status === "setup" && (
                        <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 text-center shadow-xl">
                            <h3 className="text-2xl font-semibold mb-6">Set Your Secret Number</h3>

                            {mySecret === null || mySecret === undefined ? (
                                <div className="flex justify-center gap-4 max-w-md mx-auto">
                                    <input
                                        type="number"
                                        className="w-36 bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-center text-2xl font-bold focus:outline-none focus:border-blue-500"
                                        placeholder="???"
                                        value={secretInput}
                                        onChange={(e) => setSecretInput(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && submitSecret()}
                                    />
                                    <button
                                        onClick={submitSecret}
                                        className="bg-blue-600 hover:bg-blue-500 px-8 rounded-xl font-bold text-lg transition shadow-lg shadow-blue-500/20 active:scale-95"
                                    >
                                        Lock In
                                    </button>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center">
                                    <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 mb-4 border border-emerald-500/30">
                                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                    <p className="text-xl font-semibold text-white mb-1">
                                        Your secret number: <span className="text-blue-400 font-bold">{mySecret}</span>
                                    </p>
                                    <p className="text-slate-400 text-sm">Waiting for your opponent to lock in their secret...</p>
                                </div>
                            )}
                        </div>
                    )}

                    {data?.status === "playing" && (
                        <div className="space-y-6">
                            <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 text-center flex flex-col items-center shadow-xl">
                                <div className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-2">Make A Guess</div>
                                <div className="text-4xl font-black mb-6">{10 - myGuesses.length} <span className="text-xl text-slate-400 font-normal">tries remaining</span></div>

                                <div className="flex justify-center gap-4 w-full max-w-sm">
                                    <input
                                        type="number"
                                        className="flex-1 bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-center text-xl font-bold focus:outline-none focus:border-blue-500 disabled:opacity-50"
                                        placeholder="Type guess..."
                                        value={guessInput}
                                        onChange={(e) => setGuessInput(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && submitGuess()}
                                        disabled={myGuesses.length >= 10}
                                    />
                                    <button
                                        onClick={submitGuess}
                                        disabled={myGuesses.length >= 10}
                                        className="bg-blue-600 hover:bg-blue-500 px-6 rounded-xl font-bold transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20"
                                    >
                                        Submit
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-6">
                                <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-xl">
                                    <h4 className="font-semibold text-slate-300 mb-4">Your Guesses</h4>
                                    <div className="bg-slate-900 rounded-xl h-48 overflow-y-auto p-4 space-y-2 border border-slate-700/50">
                                        {myGuesses.length === 0 && <p className="text-slate-500 text-sm text-center mt-16">No guesses submitted yet</p>}
                                        {myGuesses.map((g: number, i: number) => (
                                            <div key={i} className="flex justify-between items-center bg-slate-800 px-4 py-2 rounded-lg border border-slate-700">
                                                <span className="text-slate-400 text-sm">Attempt {i + 1}</span>
                                                <span className="font-bold text-lg text-blue-400">{g}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-xl flex flex-col items-center justify-center">
                                    <h4 className="font-semibold text-slate-300 mb-4">Opponent Progress</h4>
                                    <div className="relative w-32 h-32 flex items-center justify-center">
                                        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                                            <circle cx="50" cy="50" r="45" fill="none" stroke="#1e293b" strokeWidth="10" />
                                            <circle
                                                cx="50"
                                                cy="50"
                                                r="45"
                                                fill="none"
                                                stroke="#ef4444"
                                                strokeWidth="10"
                                                strokeDasharray="283"
                                                strokeDashoffset={283 - (283 * oppGuesses.length) / 10}
                                                className="transition-all duration-500"
                                            />
                                        </svg>
                                        <div className="absolute text-3xl font-black text-red-400">{oppGuesses.length}/10</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {data?.status === "gameover" && (
                        <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-10 rounded-2xl border border-emerald-500/30 text-center shadow-2xl mt-8">
                            <div className="text-6xl mb-4">🏆</div>
                            <h2 className="text-3xl font-black text-emerald-400 mb-2">Game Over!</h2>
                            <h3 className="text-lg text-slate-300 mb-8">{data.reason}</h3>

                            <div className="flex justify-center gap-8 mb-8">
                                <div className="bg-slate-800/80 p-5 rounded-xl border border-slate-700 min-w-[140px]">
                                    <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Player 1 Secret</div>
                                    <div className="text-3xl font-bold text-blue-400">{data.p1Secret}</div>
                                </div>
                                <div className="bg-slate-800/80 p-5 rounded-xl border border-slate-700 min-w-[140px]">
                                    <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Player 2 Secret</div>
                                    <div className="text-3xl font-bold text-violet-400">{data.p2Secret}</div>
                                </div>
                            </div>

                            <button
                                onClick={() => socket.emit("return_lobby", room.code)}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-8 rounded-xl transition shadow-lg shadow-emerald-500/20"
                            >
                                Return to Lobby
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
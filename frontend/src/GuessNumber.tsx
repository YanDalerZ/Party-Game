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
            secret: parsedSecret,
        });
    };

    const submitGuess = () => {
        const parsedGuess = parseInt(guessInput, 10);
        if (isNaN(parsedGuess)) return;

        socket.emit("g1_guess", {
            roomCode: room.code,
            guess: parsedGuess,
        });
        setGuessInput("");
    };

    const opponent = room.players.find((p) => p.id !== myId);
    const opponentName = opponent ? opponent.name : "Opponent";

    return (
        <div className="flex flex-col landscape:flex-row portrait:flex-col lg:flex-row min-h-screen lg:h-screen bg-slate-900 text-white overflow-x-hidden">
            {/* Video Call: Top bar in Vertical/Portrait, Left sidebar in Landscape */}
            <div className="w-full portrait:w-full landscape:w-72 lg:w-80 shrink-0 border-b portrait:border-b landscape:border-b-0 landscape:border-r lg:border-b-0 lg:border-r border-slate-700 bg-slate-800/40">
                <VideoCall roomCode={room.code} opponentName={opponentName} />
            </div>

            {/* Main Game Area */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
                <div className="max-w-3xl mx-auto">
                    {/* Header Bar */}
                    <div className="flex flex-wrap sm:flex-nowrap justify-between items-center gap-3 bg-slate-800 p-4 sm:p-6 rounded-xl sm:rounded-2xl shadow-lg border border-slate-700 mb-6 sm:mb-8">
                        <div>
                            <h2 className="text-xl sm:text-3xl font-bold text-blue-400">
                                Guess The Number
                            </h2>
                            <p className="text-xs sm:text-sm text-slate-400 mt-0.5 sm:mt-1">
                                Crack your opponent's secret code in 10 tries!
                            </p>
                        </div>
                        <button
                            onClick={() => socket.emit("return_lobby", room.code)}
                            className="bg-slate-700 hover:bg-slate-600 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition ml-auto sm:ml-0"
                        >
                            Exit to Lobby
                        </button>
                    </div>

                    {/* Setup Stage */}
                    {data?.status === "setup" && (
                        <div className="bg-slate-800 p-6 sm:p-8 rounded-xl sm:rounded-2xl border border-slate-700 text-center shadow-xl">
                            <h3 className="text-xl sm:text-2xl font-semibold mb-4 sm:mb-6">
                                Set Your Secret Number
                            </h3>

                            {mySecret === null || mySecret === undefined ? (
                                <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4 max-w-md mx-auto">
                                    <input
                                        type="number"
                                        className="w-full sm:w-36 bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 sm:py-3 text-center text-xl sm:text-2xl font-bold focus:outline-none focus:border-blue-500"
                                        placeholder="???"
                                        value={secretInput}
                                        onChange={(e) => setSecretInput(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && submitSecret()}
                                    />
                                    <button
                                        onClick={submitSecret}
                                        className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 px-6 sm:px-8 py-2.5 sm:py-3 rounded-xl font-bold text-base sm:text-lg transition shadow-lg shadow-blue-500/20 active:scale-95"
                                    >
                                        Lock In
                                    </button>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center">
                                    <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 mb-3 sm:mb-4 border border-emerald-500/30">
                                        <svg
                                            className="w-6 h-6 sm:w-8 sm:h-8"
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth="2"
                                                d="M5 13l4 4L19 7"
                                            />
                                        </svg>
                                    </div>
                                    <p className="text-lg sm:text-xl font-semibold text-white mb-1">
                                        Your secret number:{" "}
                                        <span className="text-blue-400 font-bold">{mySecret}</span>
                                    </p>
                                    <p className="text-slate-400 text-xs sm:text-sm">
                                        Waiting for your opponent to lock in their secret...
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Playing Stage */}
                    {data?.status === "playing" && (
                        <div className="space-y-4 sm:space-y-6">
                            <div className="bg-slate-800 p-6 sm:p-8 rounded-xl sm:rounded-2xl border border-slate-700 text-center flex flex-col items-center shadow-xl">
                                <div className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-1 sm:mb-2">
                                    Make A Guess
                                </div>
                                <div className="text-3xl sm:text-4xl font-black mb-4 sm:mb-6">
                                    {10 - myGuesses.length}{" "}
                                    <span className="text-lg sm:text-xl text-slate-400 font-normal">
                                        tries remaining
                                    </span>
                                </div>

                                <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4 w-full max-w-sm">
                                    <input
                                        type="number"
                                        className="w-full sm:flex-1 bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 sm:py-3 text-center text-lg sm:text-xl font-bold focus:outline-none focus:border-blue-500 disabled:opacity-50"
                                        placeholder="Type guess..."
                                        value={guessInput}
                                        onChange={(e) => setGuessInput(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && submitGuess()}
                                        disabled={myGuesses.length >= 10}
                                    />
                                    <button
                                        onClick={submitGuess}
                                        disabled={myGuesses.length >= 10}
                                        className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 px-6 py-2.5 sm:py-3 rounded-xl font-bold transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20"
                                    >
                                        Submit
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                                {/* Guesses Log */}
                                <div className="bg-slate-800 p-4 sm:p-6 rounded-xl sm:rounded-2xl border border-slate-700 shadow-xl">
                                    <h4 className="font-semibold text-slate-300 mb-3 sm:mb-4 text-sm sm:text-base">
                                        Your Guesses
                                    </h4>
                                    <div className="bg-slate-900 rounded-xl h-40 sm:h-48 overflow-y-auto p-3 sm:p-4 space-y-2 border border-slate-700/50">
                                        {myGuesses.length === 0 && (
                                            <p className="text-slate-500 text-xs sm:text-sm text-center mt-12 sm:mt-16">
                                                No guesses submitted yet
                                            </p>
                                        )}
                                        {myGuesses.map((g: number, i: number) => (
                                            <div
                                                key={i}
                                                className="flex justify-between items-center bg-slate-800 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg border border-slate-700 text-xs sm:text-base"
                                            >
                                                <span className="text-slate-400">Attempt {i + 1}</span>
                                                <span className="font-bold text-base sm:text-lg text-blue-400">
                                                    {g}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Opponent Progress */}
                                <div className="bg-slate-800 p-4 sm:p-6 rounded-xl sm:rounded-2xl border border-slate-700 shadow-xl flex flex-col items-center justify-center">
                                    <h4 className="font-semibold text-slate-300 mb-3 sm:mb-4 text-sm sm:text-base">
                                        Opponent Progress
                                    </h4>
                                    <div className="relative w-28 h-28 sm:w-32 sm:h-32 flex items-center justify-center">
                                        <svg
                                            className="w-full h-full transform -rotate-90"
                                            viewBox="0 0 100 100"
                                        >
                                            <circle
                                                cx="50"
                                                cy="50"
                                                r="45"
                                                fill="none"
                                                stroke="#1e293b"
                                                strokeWidth="10"
                                            />
                                            <circle
                                                cx="50"
                                                cy="50"
                                                r="45"
                                                fill="none"
                                                stroke="#ef4444"
                                                strokeWidth="10"
                                                strokeDasharray="283"
                                                strokeDashoffset={
                                                    283 - (283 * oppGuesses.length) / 10
                                                }
                                                className="transition-all duration-500"
                                            />
                                        </svg>
                                        <div className="absolute text-2xl sm:text-3xl font-black text-red-400">
                                            {oppGuesses.length}/10
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Game Over Stage */}
                    {data?.status === "gameover" && (
                        <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-6 sm:p-10 rounded-xl sm:rounded-2xl border border-emerald-500/30 text-center shadow-2xl mt-4 sm:mt-8">
                            <div className="text-4xl sm:text-6xl mb-3 sm:mb-4">🏆</div>
                            <h2 className="text-2xl sm:text-3xl font-black text-emerald-400 mb-1 sm:mb-2">
                                Game Over!
                            </h2>
                            <h3 className="text-sm sm:text-lg text-slate-300 mb-6 sm:mb-8">
                                {data.reason}
                            </h3>

                            <div className="flex flex-row justify-center gap-4 sm:gap-8 mb-6 sm:mb-8">
                                <div className="bg-slate-800/80 p-3 sm:p-5 rounded-xl border border-slate-700 min-w-[110px] sm:min-w-[140px]">
                                    <div className="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider mb-1">
                                        Player 1 Secret
                                    </div>
                                    <div className="text-2xl sm:text-3xl font-bold text-blue-400">
                                        {data.p1Secret}
                                    </div>
                                </div>
                                <div className="bg-slate-800/80 p-3 sm:p-5 rounded-xl border border-slate-700 min-w-[110px] sm:min-w-[140px]">
                                    <div className="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider mb-1">
                                        Player 2 Secret
                                    </div>
                                    <div className="text-2xl sm:text-3xl font-bold text-violet-400">
                                        {data.p2Secret}
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={() => socket.emit("return_lobby", room.code)}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 sm:py-3 px-6 sm:px-8 rounded-xl transition shadow-lg shadow-emerald-500/20 text-sm sm:text-base"
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
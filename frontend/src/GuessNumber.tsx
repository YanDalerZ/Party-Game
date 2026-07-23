import { useState, useEffect } from "react";
import { socket } from "./socket";
import { type Room } from "./App";

interface Props {
    room: Room;
    myId: string;
}

interface GuessLog {
    guess: string;
    matches: boolean[];
}

export default function GuessNumber({ room, myId }: Props) {
    const [data, setData] = useState(room.gameData);
    const [secretInput, setSecretInput] = useState("");
    const [guessInput, setGuessInput] = useState("");

    useEffect(() => {
        const handleG1Updated = (newData: any) => setData(newData);
        socket.on("g1_updated", handleG1Updated);

        return () => {
            socket.off("g1_updated", handleG1Updated);
        };
    }, []);

    const isP1 = room.players[0]?.id === myId;
    const mySecret = isP1 ? data?.p1Secret : data?.p2Secret;
    const myGuesses: GuessLog[] = (isP1 ? data?.p1Guesses : data?.p2Guesses) || [];
    const oppGuesses: GuessLog[] = (isP1 ? data?.p2Guesses : data?.p1Guesses) || [];

    const submitSecret = () => {
        if (secretInput.length !== 4 || isNaN(Number(secretInput))) return;
        socket.emit("g1_set_secret", {
            roomCode: room.code,
            secret: secretInput,
        });
    };

    const submitGuess = () => {
        if (guessInput.length !== 4 || isNaN(Number(guessInput))) return;
        socket.emit("g1_guess", {
            roomCode: room.code,
            guess: guessInput,
        });
        setGuessInput("");
    };

    const renderGuessString = (guessObj: GuessLog) => {
        return guessObj.guess.split("").map((digit, index) => (
            <span
                key={index}
                className={guessObj.matches[index] ? "text-emerald-400 font-black" : "text-slate-300"}
            >
                {digit}
            </span>
        ));
    };

    return (
        <div className="flex-1 p-4 sm:p-6 lg:p-8">
            <div className="max-w-4xl mx-auto">
                <div className="flex flex-wrap sm:flex-nowrap justify-between items-center gap-3 bg-slate-800 p-4 sm:p-6 rounded-xl sm:rounded-2xl shadow-lg border border-slate-700 mb-6 sm:mb-8">
                    <div>
                        <h2 className="text-xl sm:text-3xl font-bold text-blue-400">
                            Guess The Code
                        </h2>
                        <p className="text-xs sm:text-sm text-slate-400 mt-0.5 sm:mt-1">
                            First to guess the 4-digit code wins! Green means correct spot.
                        </p>
                    </div>

                    <div className="flex items-center gap-4 ml-auto sm:ml-0">
                        <div className="bg-slate-900 px-4 py-2 rounded-lg border border-slate-700 font-bold">
                            <span className="text-blue-400 mr-2">{room.players[0].name}: {room.scores[room.players[0].id] || 0}</span>
                            <span className="text-slate-500 mx-2">|</span>
                            <span className="text-pink-400 ml-2">{room.players[1].name}: {room.scores[room.players[1].id] || 0}</span>
                        </div>
                        <button
                            onClick={() => socket.emit("return_lobby", room.code)}
                            className="bg-slate-700 hover:bg-slate-600 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition"
                        >
                            Exit to Lobby
                        </button>
                    </div>
                </div>

                {data?.status === "setup" && (
                    <div className="bg-slate-800 p-6 sm:p-8 rounded-xl sm:rounded-2xl border border-slate-700 text-center shadow-xl">
                        <h3 className="text-xl sm:text-2xl font-semibold mb-4 sm:mb-6">
                            Set Your 4-Digit Secret Code
                        </h3>

                        {mySecret === null || mySecret === undefined ? (
                            <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4 max-w-md mx-auto">
                                <input
                                    type="text"
                                    maxLength={4}
                                    className="w-full sm:w-36 bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 sm:py-3 text-center text-xl sm:text-2xl font-bold focus:outline-none focus:border-blue-500 tracking-widest"
                                    placeholder="0000"
                                    value={secretInput}
                                    onChange={(e) => setSecretInput(e.target.value.replace(/\D/g, ''))}
                                    onKeyDown={(e) => e.key === "Enter" && submitSecret()}
                                />
                                <button
                                    onClick={submitSecret}
                                    disabled={secretInput.length !== 4}
                                    className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 px-6 sm:px-8 py-2.5 sm:py-3 rounded-xl font-bold text-base sm:text-lg transition shadow-lg shadow-blue-500/20 active:scale-95 disabled:opacity-50"
                                >
                                    Lock In
                                </button>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center">
                                <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 mb-3 sm:mb-4 border border-emerald-500/30">
                                    <svg className="w-6 h-6 sm:w-8 sm:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                                <p className="text-lg sm:text-xl font-semibold text-white mb-1">
                                    Your secret code: <span className="text-blue-400 font-bold tracking-widest">{mySecret}</span>
                                </p>
                                <p className="text-slate-400 text-xs sm:text-sm">
                                    Waiting for your opponent to lock in their code...
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {data?.status === "playing" && (
                    <div className="space-y-4 sm:space-y-6">
                        <div className="bg-slate-800 p-6 sm:p-8 rounded-xl sm:rounded-2xl border border-slate-700 text-center flex flex-col items-center shadow-xl">
                            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">
                                Your Secret Code: <span className="text-emerald-400 tracking-widest text-lg ml-2 bg-slate-900 px-3 py-1 rounded">{mySecret}</span>
                            </div>

                            <div className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-2">
                                Guess Opponent's Code
                            </div>

                            <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4 w-full max-w-sm">
                                <input
                                    type="text"
                                    maxLength={4}
                                    className="w-full sm:flex-1 bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 sm:py-3 text-center text-lg sm:text-xl font-bold focus:outline-none focus:border-blue-500 tracking-widest"
                                    placeholder="0000"
                                    value={guessInput}
                                    onChange={(e) => setGuessInput(e.target.value.replace(/\D/g, ''))}
                                    onKeyDown={(e) => e.key === "Enter" && submitGuess()}
                                />
                                <button
                                    onClick={submitGuess}
                                    disabled={guessInput.length !== 4}
                                    className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 px-6 py-2.5 sm:py-3 rounded-xl font-bold transition disabled:opacity-50 shadow-lg shadow-blue-500/20"
                                >
                                    Submit
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                            <div className="bg-slate-800 p-4 sm:p-6 rounded-xl sm:rounded-2xl border border-slate-700 shadow-xl">
                                <h4 className="font-semibold text-blue-300 mb-3 sm:mb-4 text-sm sm:text-base">
                                    Your Guesses
                                </h4>
                                <div className="bg-slate-900 rounded-xl h-48 overflow-y-auto p-3 sm:p-4 space-y-2 border border-slate-700/50">
                                    {myGuesses.length === 0 && (
                                        <p className="text-slate-500 text-xs sm:text-sm text-center mt-16">
                                            No guesses submitted yet
                                        </p>
                                    )}
                                    {myGuesses.map((g, i) => (
                                        <div key={i} className="flex justify-between items-center bg-slate-800 px-3 py-2 rounded-lg border border-slate-700">
                                            <span className="text-slate-400 text-sm">Attempt {i + 1}</span>
                                            <span className="font-bold text-lg tracking-widest">
                                                {renderGuessString(g)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="bg-slate-800 p-4 sm:p-6 rounded-xl sm:rounded-2xl border border-slate-700 shadow-xl">
                                <h4 className="font-semibold text-pink-300 mb-3 sm:mb-4 text-sm sm:text-base">
                                    Opponent's Guesses
                                </h4>
                                <div className="bg-slate-900 rounded-xl h-48 overflow-y-auto p-3 sm:p-4 space-y-2 border border-slate-700/50">
                                    {oppGuesses.length === 0 && (
                                        <p className="text-slate-500 text-xs sm:text-sm text-center mt-16">
                                            Opponent hasn't guessed yet
                                        </p>
                                    )}
                                    {oppGuesses.map((g, i) => (
                                        <div key={i} className="flex justify-between items-center bg-slate-800 px-3 py-2 rounded-lg border border-slate-700">
                                            <span className="text-slate-400 text-sm">Attempt {i + 1}</span>
                                            <span className="font-bold text-lg tracking-widest">
                                                {renderGuessString(g)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

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
                                    {room.players[0].name}'s Secret
                                </div>
                                <div className="text-2xl sm:text-3xl font-bold text-blue-400 tracking-widest">
                                    {data.p1Secret}
                                </div>
                            </div>
                            <div className="bg-slate-800/80 p-3 sm:p-5 rounded-xl border border-slate-700 min-w-[110px] sm:min-w-[140px]">
                                <div className="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider mb-1">
                                    {room.players[1].name}'s Secret
                                </div>
                                <div className="text-2xl sm:text-3xl font-bold text-pink-400 tracking-widest">
                                    {data.p2Secret}
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-center gap-4">
                            <button
                                onClick={() => socket.emit("g1_play_again", room.code)}
                                className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 sm:py-3 px-6 sm:px-8 rounded-xl transition shadow-lg shadow-blue-500/20 text-sm sm:text-base"
                            >
                                Play Again
                            </button>
                            <button
                                onClick={() => socket.emit("return_lobby", room.code)}
                                className="bg-slate-700 hover:bg-slate-600 text-white font-bold py-2.5 sm:py-3 px-6 sm:px-8 rounded-xl transition shadow-lg shadow-slate-500/20 text-sm sm:text-base"
                            >
                                Return to Lobby
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
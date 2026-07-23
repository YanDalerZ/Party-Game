import { useState, useEffect } from "react";
import { socket } from "./socket";
import VideoCall from "./VideoCall";

interface Player {
    id: string;
    name: string;
}

interface Room {
    code: string;
    players: Player[];
    currentGame: string | null;
    gameData: any;
}

interface Props {
    room: Room;
    myId: string;
}

export default function WordChain({ room, myId }: Props) {
    const [myCreatedChain, setMyCreatedChain] = useState<string[]>(Array(7).fill(""));
    const [hasSubmittedChain, setHasSubmittedChain] = useState(false);
    const [targetChain, setTargetChain] = useState<string[]>(Array(7).fill(""));
    const [guesses, setGuesses] = useState<string[]>(Array(7).fill(""));
    const [hintsRevealed, setHintsRevealed] = useState<number[]>(Array(7).fill(1));
    const [currentTurn, setCurrentTurn] = useState<string>("");
    const [gameStatus, setGameStatus] = useState<"setup" | "playing" | "gameover">("setup");
    const [winner, setWinner] = useState<string | null>(null);
    const [scores, setScores] = useState<Record<string, number>>({});
    const [guessInput, setGuessInput] = useState("");
    const [targetIndex, setTargetIndex] = useState<number>(1);

    const opponent = room.players.find((p) => p.id !== myId);
    const opponentName = opponent ? opponent.name : "Waiting for opponent...";
    const isMyTurn = currentTurn === myId;

    useEffect(() => {
        const handleWordChainUpdated = (data: any) => {
            if (data.gameStatus) setGameStatus(data.gameStatus);
            if (data.currentTurn) setCurrentTurn(data.currentTurn);
            if (data.winner !== undefined) setWinner(data.winner);
            if (data.scores) setScores(data.scores);

            if (data.playerChains && data.playerChains[myId]) {
                setHasSubmittedChain(true);
            }

            // Load the chain that THIS player is supposed to guess (the OPPONENT'S chain)
            if (data.chainsToGuess && data.chainsToGuess[myId]) {
                setTargetChain(data.chainsToGuess[myId]);
            }

            // Load player-specific guessing progress
            if (data.playerProgress && data.playerProgress[myId]) {
                const progress = data.playerProgress[myId];
                setGuesses(progress.guesses);
                setHintsRevealed(progress.hintsRevealed);
                setTargetIndex(progress.targetIndex);
            }
        };

        socket.on("wordchain_updated", handleWordChainUpdated);

        return () => {
            socket.off("wordchain_updated", handleWordChainUpdated);
        };
    }, [myId]);

    // Submit player's own 7-word chain
    const handleSubmitChain = () => {
        if (myCreatedChain.some((w) => !w.trim())) {
            alert("Please fill out all 7 words before submitting!");
            return;
        }

        const formattedChain = myCreatedChain.map((w) => w.toUpperCase().trim());
        socket.emit("wordchain_submit_chain", {
            roomCode: room.code,
            playerId: myId,
            chain: formattedChain,
        });

        setHasSubmittedChain(true);
    };

    // Submit a guess for the current target word
    const handleGuessSubmit = () => {
        if (!isMyTurn || !guessInput.trim() || gameStatus !== "playing") return;

        const cleanGuess = guessInput.toUpperCase().trim();
        const expectedWord = targetChain[targetIndex];

        socket.emit("wordchain_make_guess", {
            roomCode: room.code,
            playerId: myId,
            guess: cleanGuess,
            targetIndex,
            expectedWord,
        });

        setGuessInput("");
    };

    // Request a hint (reveals 1 extra letter, skips turn)
    const handleRequestHint = () => {
        if (!isMyTurn || gameStatus !== "playing") return;

        const currentWord = targetChain[targetIndex];
        const currentHintCount = hintsRevealed[targetIndex];

        if (currentHintCount >= currentWord.length - 1) {
            alert("No more hints can be given for this word!");
            return;
        }

        socket.emit("wordchain_request_hint", {
            roomCode: room.code,
            playerId: myId,
            targetIndex,
        });
    };

    // Render revealed letters / underscores
    const renderWordSlot = (word: string, index: number) => {
        if (guesses[index]) {
            return <span className="text-emerald-400 font-black tracking-widest">{guesses[index]}</span>;
        }

        const revealedCount = hintsRevealed[index] || 1;
        const letterArray = word.split("").map((char, charIdx) => {
            if (charIdx < revealedCount) {
                return char;
            }
            return "_";
        });

        return (
            <span className="font-mono text-amber-400 font-bold tracking-widest">
                {letterArray.join(" ")}
            </span>
        );
    };

    return (
        <div className="flex flex-col md:flex-row h-screen bg-slate-900 text-white overflow-hidden">
            {/* Video Call Sidebar */}
            <div className="w-full md:w-80 h-64 md:h-full border-b md:border-b-0 md:border-r border-slate-800 shrink-0">
                <VideoCall roomCode={room.code} opponentName={opponentName} />
            </div>

            {/* Main Game Stage */}
            <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-950 p-4">
                {/* Header */}
                <div className="p-4 bg-slate-800 border border-slate-700 rounded-2xl flex items-center justify-between shadow-md mb-4 shrink-0">
                    <div className="flex items-center gap-2">
                        <span className="text-2xl">🔗</span>
                        <div>
                            <h1 className="text-lg font-bold text-slate-100">7-Word Chain</h1>
                            <p className="text-xs text-slate-400">Guess each other's 7-word chain!</p>
                        </div>
                    </div>

                    <button
                        onClick={() => socket.emit("return_lobby", room.code)}
                        className="bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-200 transition"
                    >
                        Exit to Lobby
                    </button>
                </div>

                {/* SETUP SCREEN (Both players type their own word chain) */}
                {gameStatus === "setup" && (
                    <div className="flex-1 flex flex-col items-center justify-center p-4 overflow-y-auto">
                        <div className="max-w-xl w-full bg-slate-800 border border-slate-700 rounded-2xl p-6 shadow-xl flex flex-col gap-6">
                            <h2 className="text-xl font-bold text-center text-indigo-400">Create Your 7-Word Chain</h2>
                            <p className="text-xs text-slate-400 text-center -mt-4">
                                Enter 7 words that link together (e.g., ICE ➔ BLOCK ➔ BUSTER). {opponentName} will try to guess this!
                            </p>

                            {!hasSubmittedChain ? (
                                <>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {myCreatedChain.map((word, idx) => (
                                            <div key={idx} className="flex items-center gap-2">
                                                <span className="text-xs text-slate-500 font-bold w-4">{idx + 1}.</span>
                                                <input
                                                    type="text"
                                                    placeholder={`Word ${idx + 1}`}
                                                    value={word}
                                                    onChange={(e) => {
                                                        const updated = [...myCreatedChain];
                                                        updated[idx] = e.target.value;
                                                        setMyCreatedChain(updated);
                                                    }}
                                                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white uppercase focus:outline-none focus:border-indigo-500"
                                                />
                                            </div>
                                        ))}
                                    </div>

                                    <button
                                        onClick={handleSubmitChain}
                                        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition shadow-lg shadow-emerald-600/20"
                                    >
                                        Lock In My Chain 🔒
                                    </button>
                                </>
                            ) : (
                                <div className="text-center py-8 text-slate-400 flex flex-col items-center gap-3">
                                    <div className="animate-spin text-3xl">⏳</div>
                                    <p className="text-sm font-semibold text-emerald-400">Your chain is locked in!</p>
                                    <p className="text-xs">Waiting for {opponentName} to finish creating their chain...</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* PLAYING SCREEN */}
                {gameStatus === "playing" && (
                    <div className="flex-1 flex flex-col items-center justify-between gap-4 overflow-hidden max-w-2xl mx-auto w-full">
                        {/* Turn & Score Header */}
                        <div className="w-full flex justify-between items-center bg-slate-800 p-3 rounded-xl border border-slate-700 shadow-md">
                            <div className="flex items-center gap-2">
                                <span className={`w-3 h-3 rounded-full ${isMyTurn ? "bg-emerald-400 animate-ping" : "bg-slate-600"}`} />
                                <span className="text-xs font-bold text-slate-200">
                                    {isMyTurn ? "YOUR TURN TO GUESS" : `${opponentName}'s Turn`}
                                </span>
                            </div>

                            <div className="flex gap-4 text-xs font-semibold">
                                <span className="text-blue-400">You: {scores[myId] || 0} pts</span>
                                <span className="text-pink-400">{opponentName}: {scores[opponent?.id || ""] || 0} pts</span>
                            </div>
                        </div>

                        {/* Target Chain Board (Opponent's Chain) */}
                        <div className="flex-1 w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-center gap-2 overflow-y-auto">
                            <div className="text-xs font-semibold text-slate-400 mb-1 text-center">
                                Guessing {opponentName}'s Word Chain:
                            </div>
                            {targetChain.map((word, idx) => {
                                const isCurrentTarget = idx === targetIndex;
                                const isGuessed = Boolean(guesses[idx]);

                                return (
                                    <div
                                        key={idx}
                                        className={`flex items-center justify-between p-3 rounded-xl border transition-all ${isGuessed
                                                ? "bg-emerald-950/40 border-emerald-500/40"
                                                : isCurrentTarget
                                                    ? "bg-indigo-900/40 border-indigo-500 ring-2 ring-indigo-500/30"
                                                    : "bg-slate-950/60 border-slate-800 opacity-60"
                                            }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <span className="w-6 h-6 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center text-xs font-bold">
                                                {idx + 1}
                                            </span>
                                            <div className="text-base tracking-wider">
                                                {renderWordSlot(word, idx)}
                                            </div>
                                        </div>

                                        {isGuessed && <span className="text-xs text-emerald-400 font-bold">✓ SOLVED</span>}
                                        {isCurrentTarget && <span className="text-[10px] bg-indigo-500 text-white px-2 py-0.5 rounded-full font-bold">CURRENT TARGET</span>}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Input Controls */}
                        <div className="w-full bg-slate-800 p-3 rounded-2xl border border-slate-700 flex flex-col gap-2">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    disabled={!isMyTurn}
                                    value={guessInput}
                                    onChange={(e) => setGuessInput(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && handleGuessSubmit()}
                                    placeholder={isMyTurn ? "Type your word guess..." : "Waiting for turn..."}
                                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50 uppercase"
                                />
                                <button
                                    disabled={!isMyTurn || !guessInput.trim()}
                                    onClick={handleGuessSubmit}
                                    className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white font-bold px-5 py-2 rounded-xl text-xs transition"
                                >
                                    Guess 🎯
                                </button>
                            </div>

                            <button
                                disabled={!isMyTurn}
                                onClick={handleRequestHint}
                                className="w-full bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/30 disabled:opacity-30 text-amber-300 py-1.5 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1"
                            >
                                💡 Ask for Hint (Reveals next letter & Skips Turn)
                            </button>
                        </div>
                    </div>
                )}

                {/* GAME OVER SCREEN */}
                {gameStatus === "gameover" && (
                    <div className="flex-1 flex flex-col items-center justify-center p-4">
                        <div className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-2xl p-6 text-center flex flex-col items-center gap-4 shadow-2xl">
                            <div className="text-5xl">🏆</div>
                            <h2 className="text-2xl font-black text-indigo-400">Game Over!</h2>
                            <p className="text-sm text-slate-300">
                                {winner === "draw"
                                    ? "It's a Tie!"
                                    : winner === myId
                                        ? "🎉 You Solved the Chain First & Won!"
                                        : `🎉 ${opponentName} Won!`}
                            </p>

                            <div className="w-full bg-slate-900 p-3 rounded-xl border border-slate-800 text-xs flex justify-around">
                                <div>
                                    <span className="text-slate-400">Your Score:</span>
                                    <div className="text-lg font-bold text-emerald-400">{scores[myId] || 0} pts</div>
                                </div>
                                <div>
                                    <span className="text-slate-400">{opponentName}:</span>
                                    <div className="text-lg font-bold text-pink-400">{scores[opponent?.id || ""] || 0} pts</div>
                                </div>
                            </div>

                            <button
                                onClick={() => socket.emit("start_game", { roomCode: room.code, game: "wordchain" })}
                                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl transition text-xs"
                            >
                                Play Again 🔄
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
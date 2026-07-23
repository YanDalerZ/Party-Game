import React, { useState, useEffect } from "react";
import { socket } from "./socket";
import { type Room } from "./App";

interface Props { room: Room; myId: string; }

export default function GuessNumber({ room, myId }: Props) {
    const [data, setData] = useState(room.gameData);
    const [secretInput, setSecretInput] = useState("");
    const [guessInput, setGuessInput] = useState("");

    useEffect(() => {
        socket.on("g1_updated", (newData: any) => setData(newData));
        return () => { socket.off("g1_updated"); };
    }, []);

    const isP1 = room.players[0].id === myId;
    const mySecret = isP1 ? data.p1Secret : data.p2Secret;
    const myGuesses = isP1 ? data.p1Guesses : data.p2Guesses;
    const oppGuesses = isP1 ? data.p2Guesses : data.p1Guesses;

    const submitSecret = () => {
        if (!secretInput || isNaN(Number(secretInput))) return;
        socket.emit("g1_set_secret", { roomCode: room.code, secret: Number(secretInput) });
    };

    const submitGuess = () => {
        if (!guessInput || isNaN(Number(guessInput))) return;
        socket.emit("g1_guess", { roomCode: room.code, guess: Number(guessInput) });
        setGuessInput("");
    };

    const returnToLobby = () => socket.emit("return_lobby", room.code);

    const containerStyle: React.CSSProperties = { maxWidth: "700px", margin: "40px auto", padding: "20px", background: "white", borderRadius: "8px", boxShadow: "0 2px 10px rgba(0,0,0,0.1)" };
    const inputStyle: React.CSSProperties = { padding: "8px", marginRight: "10px", width: "150px" };
    const btnStyle: React.CSSProperties = { background: "#0066cc", color: "white", padding: "8px 15px", border: "none", borderRadius: "4px", cursor: "pointer" };
    const textareaStyle: React.CSSProperties = { width: "100%", height: "150px", marginTop: "10px", padding: "10px", fontSize: "16px", background: "#f9f9f9" };

    return (
        <div style={containerStyle}>
            <h2>Game 1: Guess the Number</h2>
            <p style={{ color: "#666" }}>You have 10 tries to guess the other person's number. Closest wins if no one gets it!</p>
            <hr />

            {data.status === "setup" && (
                <div>
                    <h3>Phase 1: Choose your secret number</h3>
                    {mySecret === null ? (
                        <div>
                            <input style={inputStyle} type="number" placeholder="Enter number..." value={secretInput} onChange={(e) => setSecretInput(e.target.value)} />
                            <button style={btnStyle} onClick={submitSecret}>Lock It In</button>
                        </div>
                    ) : (
                        <p>Waiting for opponent to choose their number...</p>
                    )}
                </div>
            )}

            {data.status === "playing" && (
                <div>
                    <h3>Phase 2: Guessing ({10 - myGuesses.length} tries left)</h3>
                    <div>
                        <input style={inputStyle} type="number" placeholder="Your guess..." value={guessInput} onChange={(e) => setGuessInput(e.target.value)} disabled={myGuesses.length >= 10} />
                        <button style={btnStyle} onClick={submitGuess} disabled={myGuesses.length >= 10}>Submit Guess</button>
                    </div>

                    <div style={{ display: "flex", gap: "20px", marginTop: "20px" }}>
                        <div style={{ flex: 1 }}>
                            <h4>Your Guess Tracker:</h4>
                            <textarea
                                style={textareaStyle}
                                readOnly
                                value={myGuesses.map((g: number, i: number) => `Try ${i + 1}: ${g}`).join("\n")}
                                placeholder="Your guesses will appear here..."
                            />
                        </div>
                        <div style={{ flex: 1 }}>
                            <h4>Opponent's Tries Used:</h4>
                            <h1 style={{ fontSize: "48px", textAlign: "center", color: "#888" }}>{oppGuesses.length} / 10</h1>
                        </div>
                    </div>
                </div>
            )}

            {data.status === "gameover" && (
                <div style={{ textAlign: "center", padding: "20px", background: "#e6ffe6", borderRadius: "8px", marginTop: "20px" }}>
                    <h2>Game Over!</h2>
                    <h3 style={{ color: "#28a745" }}>{data.reason}</h3>
                    <p>
                        Player 1's Secret: <b>{data.p1Secret}</b><br />
                        Player 2's Secret: <b>{data.p2Secret}</b>
                    </p>
                    <button style={{ ...btnStyle, marginTop: "20px" }} onClick={returnToLobby}>Back to Lobby</button>
                </div>
            )}
        </div>
    );
}
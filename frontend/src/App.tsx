import React, { useState, useEffect } from "react";
import { socket } from "./socket";
import GuessNumber from "./GuessNumber";
import DrawGuess from "./DrawGuess";

export interface Player { id: string; name: string; }
export interface Room { code: string; players: Player[]; currentGame: string | null; gameData: any; }

export default function App() {
  const [name, setName] = useState("");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    socket.on("room_created", (r: Room) => { setRoom(r); setError(""); });
    socket.on("room_updated", (r: Room) => { setRoom(r); setError(""); });
    socket.on("game_started", (r: Room) => { setRoom(r); });
    socket.on("error_message", (msg: string) => setError(msg));

    return () => {
      socket.off("room_created");
      socket.off("room_updated");
      socket.off("game_started");
      socket.off("error_message");
    };
  }, []);

  const createRoom = () => {
    if (!name) return setError("Enter your name first!");
    socket.emit("create_room", name);
  };

  const joinRoom = () => {
    if (!name || !roomCodeInput) return setError("Enter name and code!");
    socket.emit("join_room", { roomCode: roomCodeInput, playerName: name });
  };

  const startGame = (gameId: string) => {
    if (room && room.players.length === 2) {
      socket.emit("start_game", { roomCode: room.code, game: gameId });
    }
  };

  const containerStyle: React.CSSProperties = { maxWidth: "600px", margin: "40px auto", padding: "20px", background: "white", borderRadius: "8px", boxShadow: "0 2px 10px rgba(0,0,0,0.1)" };
  const inputStyle: React.CSSProperties = { width: "100%", padding: "10px", margin: "10px 0", borderRadius: "4px", border: "1px solid #ccc" };
  const btnStyle: React.CSSProperties = { background: "#0066cc", color: "white", padding: "10px 15px", border: "none", borderRadius: "4px", cursor: "pointer", marginRight: "10px", fontWeight: "bold" };

  if (room && room.currentGame === "guess_number") return <GuessNumber room={room} myId={socket.id || ''} />;
  if (room && room.currentGame === "draw_guess") return <DrawGuess room={room} myId={socket.id || ''} />;

  return (
    <div style={containerStyle}>
      <h1 style={{ textAlign: "center" }}>Party Games App 🎉</h1>
      {error && <div style={{ background: "#ffcccc", color: "red", padding: "10px", borderRadius: "4px" }}>{error}</div>}

      {!room ? (
        <div>
          <h3>Welcome!</h3>
          <input style={inputStyle} placeholder="Your Name" value={name} onChange={(e) => setName(e.target.value)} />
          <button style={btnStyle} onClick={createRoom}>Create Room</button>
          <hr style={{ margin: "20px 0" }} />
          <input style={inputStyle} placeholder="Room Code" value={roomCodeInput} onChange={(e) => setRoomCodeInput(e.target.value)} />
          <button style={btnStyle} onClick={joinRoom}>Join Room</button>
        </div>
      ) : (
        <div>
          <h2>Room Code: <span style={{ color: "#0066cc" }}>{room.code}</span></h2>
          <h3>Players ({room.players.length}/2)</h3>
          <ul>
            {room.players.map((p) => (
              <li key={p.id}><b>{p.name}</b> {p.id === socket.id && "(You)"}</li>
            ))}
          </ul>

          {room.players.length < 2 ? (
            <p style={{ color: "#888", fontStyle: "italic" }}>Waiting for player 2 to join...</p>
          ) : (
            <div style={{ marginTop: "20px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <button style={btnStyle} onClick={() => startGame("guess_number")}>Play Game 1: Guess the Number</button>
              <button style={{ ...btnStyle, background: "#28a745" }} onClick={() => startGame("draw_guess")}>Play Game 2: Draw & Guess</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
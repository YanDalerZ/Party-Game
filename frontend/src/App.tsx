import { useState, useEffect } from "react";
import { socket } from "./socket";
import GuessNumber from "./GuessNumber";
import DrawGuess from "./DrawGuess";
import Cinema from "./Cinema";

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
    if (!name.trim()) return setError("Enter your name first!");
    socket.emit("create_room", name);
  };

  const joinRoom = () => {
    if (!name.trim() || !roomCodeInput.trim()) return setError("Enter name and code!");
    socket.emit("join_room", { roomCode: roomCodeInput, playerName: name });
  };

  const startGame = (gameId: string) => {
    if (room && room.players.length === 2) {
      socket.emit("start_game", { roomCode: room.code, game: gameId });
    }
  };

  if (room && room.currentGame === "guess_number") return <GuessNumber room={room} myId={socket.id || ''} />;
  if (room && room.currentGame === "draw_guess") return <DrawGuess room={room} myId={socket.id || ''} />;
  if (room && room.currentGame === "cinema") return <Cinema room={room} myId={socket.id || ''} />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white p-4">
      <div className="max-w-md w-full bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-500">
            Party Games 🎮
          </h1>
          <p className="text-slate-400 mt-2">Real-time games with video call</p>
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500 text-red-300 p-3 rounded-lg mb-6 text-sm text-center">
            {error}
          </div>
        )}

        {!room ? (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Your Name</label>
              <input
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500 transition-colors text-white placeholder-slate-500"
                placeholder="e.g. Alex"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <button
              onClick={createRoom}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg transition-colors shadow-lg shadow-blue-500/30"
            >
              Create New Room
            </button>

            <div className="flex items-center gap-4 my-4">
              <div className="flex-1 h-px bg-slate-700"></div>
              <span className="text-slate-500 text-sm">OR</span>
              <div className="flex-1 h-px bg-slate-700"></div>
            </div>

            <div className="flex gap-2">
              <input
                className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:border-indigo-500 transition-colors text-white placeholder-slate-500 uppercase"
                placeholder="ROOM CODE"
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value)}
              />
              <button
                onClick={joinRoom}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-6 rounded-lg transition-colors shadow-lg shadow-indigo-500/30"
              >
                Join
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center">
            <h2 className="text-xl text-slate-300 mb-2">Room Code</h2>
            <div className="text-5xl font-black text-white tracking-wider bg-slate-900 py-4 rounded-xl border border-slate-700 shadow-inner mb-6">
              {room.code}
            </div>

            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Players ({room.players.length}/2)
            </h3>

            <ul className="space-y-2 mb-8">
              {room.players.map((p) => (
                <li key={p.id} className="bg-slate-700/50 p-3 rounded-lg flex justify-between items-center border border-slate-600/50">
                  <span className="font-medium">{p.name}</span>
                  {p.id === socket.id && <span className="text-xs bg-blue-500/20 text-blue-300 px-2 py-1 rounded-md">YOU</span>}
                </li>
              ))}
            </ul>

            {room.players.length < 2 ? (
              <div className="flex items-center justify-center gap-2 text-amber-400 bg-amber-400/10 p-3 rounded-lg border border-amber-400/20">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Waiting for Player 2...
              </div>
            ) : (
              <div className="space-y-3">
                <button
                  onClick={() => startGame("guess_number")}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-emerald-500/30 flex justify-between px-6 items-center"
                >
                  <span>1️⃣ Guess The Number</span>
                  <span>→</span>
                </button>
                <button
                  onClick={() => startGame("draw_guess")}
                  className="w-full bg-violet-600 hover:bg-violet-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-violet-500/30 flex justify-between px-6 items-center"
                >
                  <span>2️⃣ Draw & Guess</span>
                  <span>→</span>
                </button>
                <button
                  onClick={() => startGame("cinema")}
                  className="w-full bg-pink-600 hover:bg-pink-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-pink-500/30 flex justify-between px-6 items-center"
                >
                  <span>3️⃣ Cinema 🍿</span>
                  <span>→</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
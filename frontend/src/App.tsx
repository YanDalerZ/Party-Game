import { useState, useEffect } from "react";
import { socket } from "./socket";
import GuessNumber from "./GuessNumber";
import DrawGuess from "./DrawGuess";
import Cinema from "./Cinema";
import WordChain from "./WordChain";
import DetectiveCaricature from "./DetectiveCaricature";
import VideoCall from "./VideoCall";
import PhotoBooth from "./PhotoBooth";
import BoxDodge from "./BoxDodge";
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
  isPrivate?: boolean;
}

interface PublicRoom {
  code: string;
  hostName: string;
  playerCount: number;
}

interface GameOption {
  id: string;
  title: string;
  badge: string;
  description: string;
  image: string;
  accent: string;
  buttonColor: string;
}

const GAMES: GameOption[] = [
  {
    id: "guess_number",
    title: "Guess The Code",
    badge: "01",
    description: "Crack the secret combination before your opponent does.",
    image: "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=600&q=80",
    accent: "border-pink-200 hover:border-pink-400 hover:shadow-pink-100",
    buttonColor: "bg-pink-600 hover:bg-pink-700 text-white shadow-pink-100",
  },
  {
    id: "draw_guess",
    title: "Draw & Guess",
    badge: "02",
    description: "Unleash your inner artist and guess real-time sketches.",
    image: "https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&w=600&q=80",
    accent: "border-purple-200 hover:border-purple-400 hover:shadow-purple-100",
    buttonColor: "bg-purple-600 hover:bg-purple-700 text-white shadow-purple-100",
  },
  {
    id: "cinema",
    title: "Cinema 🍿",
    badge: "03",
    description: "Synchronized movie dates and real-time watch parties.",
    image: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=600&q=80",
    accent: "border-pink-200 hover:border-pink-400 hover:shadow-pink-100",
    buttonColor: "bg-pink-600 hover:bg-pink-700 text-white shadow-pink-100",
  },
  {
    id: "wordchain",
    title: "7-Word Chain",
    badge: "04",
    description: "Fast-paced word linkage test under pressure.",
    image: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80",
    accent: "border-purple-200 hover:border-purple-400 hover:shadow-purple-100",
    buttonColor: "bg-purple-600 hover:bg-purple-700 text-white shadow-purple-100",
  },
  {
    id: "detective",
    title: "Detective Caricature 🔍",
    badge: "06",
    description: "Identify target suspects using cryptic facial descriptions.",
    image: "https://s.studiobinder.com/wp-content/uploads/2025/01/What-is-Caricature-StudioBinder.jpg",
    accent: "border-purple-200 hover:border-purple-400 hover:shadow-purple-100",
    buttonColor: "bg-purple-600 hover:bg-purple-700 text-white shadow-purple-100",
  },
  {
    id: "photobooth",
    title: "PhotoBooth 📸",
    badge: "07",
    description: "Snap and customize interactive digital memory strips.",
    image: "https://images.unsplash.com/photo-1744189578759-5103cc188897?fm=jpg&q=60&w=3000&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8N3x8cGhvdG8lMjBib290aHxlbnwwfHwwfHx8MA%3D%3D",
    accent: "border-pink-200 hover:border-pink-400 hover:shadow-pink-100",
    buttonColor: "bg-pink-600 hover:bg-pink-700 text-white shadow-pink-100",
  },
  {
    id: "box_dodge",
    title: "Box Dodge 🎯",
    badge: "08",
    description: "Test your agility and coordination in this thrilling challenge.",
    image: "https://img.itch.zone/aW1nLzI4OTQyNDY3LnBuZw==/315x250%23c/ZV6gmN.png",
    accent: "border-orange-200 hover:border-orange-400 hover:shadow-orange-100",
    buttonColor: "bg-orange-600 hover:bg-orange-700 text-white shadow-orange-100",
  }
];

export default function App() {
  const [name, setName] = useState(() => {
    return localStorage.getItem("saved_player_name") || "";
  });
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);

  const handleNameChange = (val: string) => {
    setName(val);
    localStorage.setItem("saved_player_name", val);
  };

  useEffect(() => {
    const tryRejoinSession = () => {
      const savedSession = localStorage.getItem("game_session");
      if (savedSession) {
        try {
          const { roomCode, playerId, playerName } = JSON.parse(savedSession);
          socket.emit("rejoin_room", {
            roomCode,
            previousSocketId: playerId,
            playerName,
          });
        } catch (e) {
          localStorage.removeItem("game_session");
        }
      }
    };

    if (socket.connected) {
      tryRejoinSession();
      socket.emit("get_public_rooms");
    }

    socket.on("connect", () => {
      tryRejoinSession();
      socket.emit("get_public_rooms");
    });

    const handleRoomCreated = (r: Room) => {
      setRoom(r);
      setError("");
      const myPlayer = r.players[r.players.length - 1];
      if (myPlayer) {
        localStorage.setItem(
          "game_session",
          JSON.stringify({
            roomCode: r.code,
            playerId: myPlayer.id,
            playerName: myPlayer.name,
          })
        );
      }
    };

    const handleRoomUpdated = (r: Room) => {
      setRoom(r);
      setError("");
      const myPlayer = r.players.find((p) => p.id === socket.id);
      if (myPlayer) {
        localStorage.setItem(
          "game_session",
          JSON.stringify({
            roomCode: r.code,
            playerId: myPlayer.id,
            playerName: myPlayer.name,
          })
        );
      }
    };

    const handleGameStarted = (r: Room) => {
      setRoom(r);
    };

    const handlePublicRoomsList = (roomsList: PublicRoom[]) => {
      setPublicRooms(roomsList);
    };

    const handleErrorMessage = (msg: string) => {
      setError(msg);
      if (msg.includes("not found") || msg.includes("no longer exists")) {
        localStorage.removeItem("game_session");
      }
    };

    socket.on("room_created", handleRoomCreated);
    socket.on("room_updated", handleRoomUpdated);
    socket.on("game_started", handleGameStarted);
    socket.on("public_rooms_list", handlePublicRoomsList);
    socket.on("error_message", handleErrorMessage);

    return () => {
      socket.off("connect");
      socket.off("room_created", handleRoomCreated);
      socket.off("room_updated", handleRoomUpdated);
      socket.off("game_started", handleGameStarted);
      socket.off("public_rooms_list", handlePublicRoomsList);
      socket.off("error_message", handleErrorMessage);
    };
  }, []);

  const createRoom = () => {
    if (!name.trim()) return setError("Enter your name first!");
    socket.emit("create_room", { playerName: name, isPrivate });
  };

  const joinRoom = (codeToJoin?: string) => {
    const targetCode = codeToJoin || roomCodeInput;
    if (!name.trim()) return setError("Enter your name first!");
    if (!targetCode.trim()) return setError("Enter a room code!");

    socket.emit("join_room", { roomCode: targetCode, playerName: name });
    localStorage.setItem(
      "game_session",
      JSON.stringify({
        roomCode: targetCode.toUpperCase(),
        playerId: socket.id,
        playerName: name,
      })
    );
  };

  const leaveRoom = () => {
    if (room) {
      socket.emit("leave_room", { roomCode: room.code });
    }
    localStorage.removeItem("game_session");
    setRoom(null);
    setError("");
    socket.emit("get_public_rooms");
  };

  const startGame = (gameId: string) => {
    if (room && room.players.length === 2) {
      if (gameId === "bomb") {
        socket.emit("bomb_start", room.code);
      } else if (gameId === "detective") {
        socket.emit("detective_start", room.code);
      } else {
        socket.emit("start_game", { roomCode: room.code, game: gameId });
      }
    }
  };

  const opponent = room?.players.find((p) => p.id !== socket.id);

  const renderGameArea = () => {
    if (room?.currentGame === "guess_number") return <GuessNumber room={room} myId={socket.id || ""} />;
    if (room?.currentGame === "draw_guess") return <DrawGuess room={room} myId={socket.id || ""} />;
    if (room?.currentGame === "cinema") return <Cinema room={room} myId={socket.id || ""} />;
    if (room?.currentGame === "wordchain") return <WordChain room={room} myId={socket.id || ""} />;
    if (room?.currentGame === "detective") return <DetectiveCaricature room={room} myId={socket.id || ""} />;
    if (room?.currentGame === "photobooth") return <PhotoBooth room={room} myId={socket.id || ""} />;
    if (room?.currentGame === "box_dodge") return <BoxDodge room={room} myId={socket.id || ""} />;

    return (
      <div className="flex-1 flex flex-col items-center justify-start p-3 sm:p-6 md:p-8 max-w-6xl mx-auto w-full">
        {/* Header Console Banner */}
        <header className="w-full bg-white border border-pink-200 rounded-3xl p-4 sm:p-6 mb-6 shadow-sm flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="text-center sm:text-left">
            <div className="flex items-center justify-center sm:justify-start gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-pink-500 animate-pulse"></span>
              <span className="text-xs font-mono uppercase tracking-widest text-purple-700 font-semibold">Console Dashboard</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-purple-950">
              It's a Date! 🎮
            </h1>
            <p className="text-xs sm:text-sm text-purple-800/70 font-medium">LDR Game Night Dashboard</p>
          </div>

          {room && (
            <div className="flex items-center gap-3 bg-purple-50 px-4 py-2.5 rounded-2xl border border-purple-200 w-full sm:w-auto justify-between sm:justify-end">
              <div>
                <p className="text-[10px] uppercase font-mono text-purple-600 font-bold">
                  Active Room {room.isPrivate ? "🔒 (Private)" : "🌐 (Public)"}
                </p>
                <p className="text-lg font-black tracking-wider text-pink-600 font-mono">{room.code}</p>
              </div>
              <button
                onClick={leaveRoom}
                className="text-xs bg-white hover:bg-pink-50 text-pink-600 hover:text-pink-700 border border-pink-300 px-3 py-1.5 rounded-xl font-semibold transition-all shadow-sm"
              >
                ← Leave
              </button>
            </div>
          )}
        </header>

        {error && (
          <div className="w-full bg-pink-50 border border-pink-200 text-pink-700 p-3.5 rounded-2xl mb-6 text-sm text-center font-medium shadow-sm">
            {error}
          </div>
        )}

        {!room ? (
          /* Lobby Join/Create Card & Public Rooms List */
          <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-6 my-auto">
            {/* Create / Join Panel */}
            <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-pink-200 flex flex-col justify-between">
              <div className="space-y-5">
                <div>
                  <label className="block text-xs font-mono uppercase tracking-wider text-purple-800 font-bold mb-2">
                    Player Identification
                  </label>
                  <input
                    className="w-full bg-purple-50 border border-purple-200 rounded-2xl px-4 py-3.5 focus:outline-none focus:border-purple-600 focus:bg-white transition-all text-purple-950 placeholder-purple-400 text-sm font-medium"
                    placeholder="Enter your name..."
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between bg-purple-50 border border-purple-200 p-3 rounded-2xl">
                    <span className="text-xs font-semibold text-purple-900">Room Visibility</span>
                    <button
                      onClick={() => setIsPrivate(!isPrivate)}
                      className={`text-xs px-3 py-1.5 rounded-xl font-bold transition-all ${isPrivate
                        ? "bg-purple-700 text-white shadow-sm"
                        : "bg-pink-600 text-white shadow-sm"
                        }`}
                    >
                      {isPrivate ? "🔒 Private" : "🌐 Public"}
                    </button>
                  </div>

                  <button
                    onClick={createRoom}
                    className="w-full bg-purple-700 hover:bg-purple-800 text-white font-bold py-3.5 rounded-2xl transition-all shadow-sm hover:scale-[1.01] active:scale-[0.99] text-sm uppercase tracking-wider"
                  >
                    Create {isPrivate ? "Private" : "Public"} Lobby
                  </button>
                </div>

                <div className="flex items-center gap-4 my-2">
                  <div className="flex-1 h-px bg-purple-200"></div>
                  <span className="text-purple-400 text-xs font-mono font-bold">OR JOIN BY CODE</span>
                  <div className="flex-1 h-px bg-purple-200"></div>
                </div>

                <div className="flex gap-2">
                  <input
                    className="flex-1 bg-purple-50 border border-purple-200 rounded-2xl px-4 py-3.5 focus:outline-none focus:border-purple-600 focus:bg-white transition-all text-purple-950 placeholder-purple-400 uppercase tracking-widest text-sm font-mono"
                    placeholder="ROOM CODE"
                    value={roomCodeInput}
                    onChange={(e) => setRoomCodeInput(e.target.value)}
                  />
                  <button
                    onClick={() => joinRoom()}
                    className="bg-pink-600 hover:bg-pink-700 text-white font-bold px-6 rounded-2xl transition-all shadow-sm hover:scale-[1.01] active:scale-[0.99] text-sm uppercase tracking-wider"
                  >
                    Join
                  </button>
                </div>
              </div>
            </div>

            {/* Public Rooms Browser */}
            <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-pink-200 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-mono uppercase tracking-wider text-purple-800 font-bold">
                  🌐 Open Public Lobbies
                </h2>
                <button
                  onClick={() => socket.emit("get_public_rooms")}
                  className="text-[10px] text-purple-700 font-bold uppercase hover:underline"
                >
                  ↻ Refresh
                </button>
              </div>

              <div className="flex-1 overflow-y-auto max-h-64 space-y-2 pr-1">
                {publicRooms.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-purple-200 rounded-2xl">
                    <p className="text-xs text-purple-500 font-medium">No open public lobbies right now.</p>
                    <p className="text-[10px] text-purple-400 mt-1">Create one to let others join you!</p>
                  </div>
                ) : (
                  publicRooms.map((pubRoom) => (
                    <div
                      key={pubRoom.code}
                      className="flex items-center justify-between bg-purple-50 border border-purple-200 p-3 rounded-2xl hover:border-pink-300 transition-all"
                    >
                      <div>
                        <p className="text-xs font-bold text-purple-950">{pubRoom.hostName}'s Room</p>
                        <p className="text-[10px] font-mono text-purple-500">
                          Code: <span className="font-bold text-pink-600">{pubRoom.code}</span>
                        </p>
                      </div>
                      <button
                        onClick={() => joinRoom(pubRoom.code)}
                        className="bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-sm hover:scale-105 active:scale-95 transition-all"
                      >
                        Join Room
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Main Game Console Grid */
          <div className="w-full space-y-6">
            {/* Player Status Bar */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white border border-pink-200 p-4 rounded-2xl shadow-sm flex justify-between items-center">
                <div>
                  <span className="text-[10px] uppercase font-mono text-purple-500 font-bold">Players Connected</span>
                  <p className="text-base font-bold text-purple-950">{room.players.length} / 2 Players</p>
                </div>
                <div className="flex gap-2">
                  {room.players.map((p) => (
                    <span
                      key={p.id}
                      className={`text-xs px-3 py-1 rounded-xl border font-semibold ${p.id === socket.id
                        ? "bg-pink-50 text-pink-600 border-pink-200"
                        : "bg-purple-50 text-purple-700 border-purple-200"
                        }`}
                    >
                      {p.name} {p.id === socket.id ? "(You)" : ""}
                    </span>
                  ))}
                </div>
              </div>

              {room.players.length === 2 && (
                <div className="bg-white border border-pink-200 p-4 rounded-2xl shadow-sm flex justify-between items-center">
                  <div>
                    <span className="text-[10px] uppercase font-mono text-purple-500 font-bold">Overall Scoreboard</span>
                    <p className="text-xs text-purple-800/60 font-medium">Head-to-head match count</p>
                  </div>
                  <div className="flex items-center gap-3 font-bold font-mono text-sm">
                    <span className="text-pink-600">
                      {room.players[0].name}: {(room.globalScores && room.globalScores[room.players[0].id]) || 0}
                    </span>
                    <span className="text-purple-400">VS</span>
                    <span className="text-purple-700">
                      {room.players[1].name}: {(room.globalScores && room.globalScores[room.players[1].id]) || 0}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {room.players.length < 2 ? (
              <div className="flex items-center justify-center gap-3 text-pink-600 bg-white p-6 rounded-3xl border border-pink-200 shadow-sm text-sm font-medium">
                <svg className="animate-spin h-5 w-5 text-pink-500" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>
                  Waiting for Player 2 to enter room code <strong className="font-mono text-purple-800 font-bold">{room.code}</strong>...
                </span>
              </div>
            ) : (
              /* Console Game Library Grid */
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {GAMES.map((game) => (
                  <div
                    key={game.id}
                    className={`group relative bg-white border rounded-3xl overflow-hidden shadow-sm transition-all duration-300 hover:scale-[1.02] hover:shadow-md flex flex-col justify-between ${game.accent}`}
                  >
                    <div>
                      {/* Cover Image Header */}
                      <div className="relative h-36 w-full overflow-hidden bg-purple-950">
                        <img
                          src={game.image}
                          alt={game.title}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 opacity-85 group-hover:opacity-100"
                        />
                        <div className="absolute inset-0 bg-white/10" />
                        <span className="absolute top-3 right-3 font-mono text-[10px] font-bold bg-white px-2.5 py-1 rounded-xl border border-purple-200 text-purple-800 shadow-sm">
                          {game.badge}
                        </span>
                      </div>

                      {/* Content */}
                      <div className="p-4 space-y-1.5">
                        <h3 className="text-lg font-bold text-purple-950 group-hover:text-pink-600 transition-colors">
                          {game.title}
                        </h3>
                        <p className="text-xs text-purple-800/70 leading-relaxed line-clamp-2 font-medium">
                          {game.description}
                        </p>
                      </div>
                    </div>

                    {/* Launch Action */}
                    <div className="p-4 pt-0">
                      <button
                        onClick={() => startGame(game.id)}
                        className={`w-full font-bold py-2.5 rounded-2xl text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-sm ${game.buttonColor}`}
                      >
                        <span>Play</span>
                        <span>→</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <footer className="mt-auto pt-8 pb-4 text-center text-xs text-purple-800/60 space-y-1 font-medium">
          <p>Inspired by classic party & console library experiences.</p>
          <p>
            Developed by{" "}
            <a
              href="https://idtejaresportfolio.netlify.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-pink-600 hover:text-pink-700 font-semibold underline underline-offset-2 transition-colors"
            >
              Dale Tejares
            </a>{" "}
            © {new Date().getFullYear()}
          </p>
        </footer>
      </div>
    );
  };

  return (
    <div className="relative min-h-screen bg-purple-50 text-purple-950 overflow-x-hidden flex flex-col font-sans selection:bg-pink-500 selection:text-white">
      {/* VideoCall is turned off when room.currentGame is "photobooth" */}
      {room && room.players.length === 2 && room.currentGame !== "photobooth" && (
        <VideoCall roomCode={room.code} opponentName={opponent?.name || "Opponent"} />
      )}

      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {renderGameArea()}
      </div>
    </div>
  );
}
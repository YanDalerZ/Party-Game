import { useEffect, useState, useRef } from "react";
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

declare global {
    interface Window {
        YT: any;
        onYouTubeIframeAPIReady: () => void;
    }
}

export default function Cinema({ room, myId }: Props) {
    const [mode, setMode] = useState<"screenshare" | "embed">("embed");
    const [inputUrl, setInputUrl] = useState("");
    const [videoId, setVideoId] = useState<string | null>(null);

    const playerRef = useRef<any>(null);
    const isRemoteAction = useRef<boolean>(false);

    const opponent = room.players.find((p) => p.id !== myId);
    const opponentName = opponent ? opponent.name : "Waiting for opponent...";

    // Helper to extract YouTube Video ID
    const extractYouTubeId = (url: string): string | null => {
        const trimmed = url.trim();
        if (!trimmed) return null;

        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = trimmed.match(regExp);

        return match && match[2].length === 11 ? match[2] : null;
    };

    // Load YouTube Iframe API Script dynamically
    useEffect(() => {
        if (!window.YT) {
            const tag = document.createElement("script");
            tag.src = "https://www.youtube.com/iframe_api";
            const firstScriptTag = document.getElementsByTagName("script")[0];
            firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
        }
    }, []);

    // Instantiate or reload YouTube Player when videoId changes
    useEffect(() => {
        if (!videoId) return;

        const createPlayer = () => {
            if (playerRef.current) {
                playerRef.current.loadVideoById(videoId);
                return;
            }

            playerRef.current = new window.YT.Player("youtube-player", {
                height: "100%",
                width: "100%",
                videoId: videoId,
                playerVars: {
                    autoplay: 1,
                    controls: 1,
                    modestbranding: 1,
                    rel: 0,
                },
                events: {
                    onStateChange: handlePlayerStateChange,
                },
            });
        };

        if (window.YT && window.YT.Player) {
            createPlayer();
        } else {
            window.onYouTubeIframeAPIReady = () => createPlayer();
        }
    }, [videoId]);

    // Handle Local Video State Changes (Play, Pause, Seek)
    const handlePlayerStateChange = (event: any) => {
        if (!playerRef.current) return;

        if (isRemoteAction.current) {
            isRemoteAction.current = false;
            return;
        }

        const currentTime = playerRef.current.getCurrentTime();
        const playerState = event.data;

        if (playerState === 1) {
            socket.emit("cinema_sync_action", {
                roomCode: room.code,
                action: "play",
                currentTime,
            });
        } else if (playerState === 2) {
            socket.emit("cinema_sync_action", {
                roomCode: room.code,
                action: "pause",
                currentTime,
            });
        }
    };

    // Socket Event Listeners (Receiving Sync Signals)
    useEffect(() => {
        const handleCinemaUrlUpdate = (rawUrl: string) => {
            console.log("🎬 [Cinema] Received synchronized URL:", rawUrl);
            const extractedId = extractYouTubeId(rawUrl);
            if (extractedId) {
                setVideoId(extractedId);
                setMode("embed");
            }
        };

        const handleSyncAction = ({ action, currentTime }: { action: "play" | "pause" | "seek"; currentTime: number }) => {
            if (!playerRef.current) return;

            console.log(`🎬 [Cinema Sync Action] ${action} at ${currentTime}s`);
            isRemoteAction.current = true;

            const timeDiff = Math.abs(playerRef.current.getCurrentTime() - currentTime);

            if (timeDiff > 1.5) {
                playerRef.current.seekTo(currentTime, true);
            }

            if (action === "play") {
                playerRef.current.playVideo();
            } else if (action === "pause") {
                playerRef.current.pauseVideo();
            }
        };

        socket.on("cinema_url_updated", handleCinemaUrlUpdate);
        socket.on("cinema_sync_action", handleSyncAction);

        return () => {
            socket.off("cinema_url_updated", handleCinemaUrlUpdate);
            socket.off("cinema_sync_action", handleSyncAction);
        };
    }, [room.code]);

    const handleLoadStream = () => {
        if (!inputUrl.trim()) return;

        const extractedId = extractYouTubeId(inputUrl);
        if (extractedId) {
            setVideoId(extractedId);
            socket.emit("cinema_change_url", { roomCode: room.code, url: inputUrl });
        } else {
            alert("Please provide a valid YouTube video or stream link!");
        }
    };

    return (
        <div className="flex flex-col md:flex-row h-screen w-screen bg-slate-900 text-white overflow-hidden">
            {/* Dedicated Visible Sidebar Container */}
            <aside className="w-full md:w-80 lg:w-96 bg-slate-800 border-b md:border-b-0 md:border-r border-slate-700 flex flex-col shrink-0 z-10 shadow-lg">
                <div className="p-3 bg-slate-800/80 border-b border-slate-700 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Voice & Screen Call
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        Live
                    </span>
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                    <VideoCall roomCode={room.code} opponentName={opponentName} />
                </div>
            </aside>

            {/* Main Stage Area */}
            <main className="flex-1 flex flex-col h-full overflow-hidden bg-slate-950">
                {/* Control Header Bar */}
                <div className="p-4 bg-slate-800 border-b border-slate-700 flex flex-wrap items-center justify-between gap-4 shrink-0 shadow-md">
                    <div className="flex items-center gap-2">
                        <span className="text-xl">🍿</span>
                        <h1 className="text-lg font-bold text-slate-100">Co-Op Cinema</h1>
                    </div>

                    {/* Mode Selection Tabs */}
                    <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-xl border border-slate-700">
                        <button
                            onClick={() => setMode("screenshare")}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${mode === "screenshare"
                                    ? "bg-indigo-600 text-white shadow-sm"
                                    : "text-slate-400 hover:text-slate-200"
                                }`}
                        >
                            🖥️ Screen Share Mode
                        </button>
                        <button
                            onClick={() => setMode("embed")}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${mode === "embed"
                                    ? "bg-indigo-600 text-white shadow-sm"
                                    : "text-slate-400 hover:text-slate-200"
                                }`}
                        >
                            🌐 Embedded Stream / iFrame Mode
                        </button>
                    </div>

                    {/* Return to Lobby */}
                    <button
                        onClick={() => socket.emit("return_lobby", room.code)}
                        className="bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-200 transition"
                    >
                        Exit to Lobby
                    </button>
                </div>

                {/* Content Display Area */}
                <div className="flex-1 p-4 flex flex-col justify-center items-center overflow-hidden">
                    {mode === "screenshare" ? (
                        /* Screen Share Guide Banner */
                        <div className="w-full max-w-2xl bg-slate-800 border border-slate-700 rounded-2xl p-6 shadow-xl text-center flex flex-col items-center gap-4">
                            <div className="w-16 h-16 rounded-full bg-indigo-600/20 text-indigo-400 flex items-center justify-center text-3xl">
                                🖥️
                            </div>
                            <h2 className="text-xl font-bold text-slate-100">Screen Share Active</h2>
                            <p className="text-sm text-slate-400 max-w-md">
                                Use the screen sharing controls on your WebRTC call panel in the sidebar to stream your screen or tab with audio directly to your partner.
                            </p>
                            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-300 max-w-md text-left">
                                💡 <strong>Pro Tip:</strong> When sharing anime or streaming sites, select <strong>"Tab Share"</strong> in your browser prompt and check <strong>"Share Tab Audio"</strong> for optimal audio sync!
                            </div>
                        </div>
                    ) : (
                        /* Embedded Video / iFrame Stage */
                        <div className="w-full h-full flex flex-col gap-3">
                            {/* Input Form for Stream Links */}
                            <div className="flex gap-2 bg-slate-800 p-2 rounded-xl border border-slate-700 shadow-md">
                                <input
                                    type="text"
                                    value={inputUrl}
                                    onChange={(e) => setInputUrl(e.target.value)}
                                    placeholder="Paste YouTube link (e.g., https://www.youtube.com/watch?v=...)..."
                                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                                    onKeyDown={(e) => e.key === "Enter" && handleLoadStream()}
                                />
                                <button
                                    onClick={handleLoadStream}
                                    className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg text-xs font-bold transition text-white"
                                >
                                    Load Stream
                                </button>
                            </div>

                            {/* Stream Viewer Container */}
                            <div className="flex-1 bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden relative shadow-2xl flex items-center justify-center">
                                <div id="youtube-player" className="w-full h-full" />
                                {!videoId && (
                                    <div className="absolute text-center p-6 text-slate-500 flex flex-col items-center gap-2 pointer-events-none">
                                        <div className="text-4xl">🍿</div>
                                        <p className="text-sm">No video loaded yet. Paste a link above to start watching together!</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
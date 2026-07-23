import { useEffect, useState } from "react";
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

export default function Cinema({ room, myId }: Props) {
    const [mode, setMode] = useState<"screenshare" | "embed">("embed");
    const [inputUrl, setInputUrl] = useState("");
    const [embedUrl, setEmbedUrl] = useState("");

    const opponent = room.players.find((p) => p.id !== myId);
    const opponentName = opponent ? opponent.name : "Waiting for opponent...";

    // Helper to format YouTube and standard URLs into embeddable URLs
    const formatEmbedUrl = (rawUrl: string): string => {
        let url = rawUrl.trim();
        if (!url) return "";

        // Format YouTube Watch or Short links to Embed format
        if (url.includes("youtube.com/watch?v=")) {
            const videoId = url.split("v=")[1]?.split("&")[0];
            return `https://www.youtube.com/embed/${videoId}?autoplay=1`;
        }
        if (url.includes("youtu.be/")) {
            const videoId = url.split("youtu.be/")[1]?.split("?")[0];
            return `https://www.youtube.com/embed/${videoId}?autoplay=1`;
        }

        // Add https protocol if omitted
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "https://" + url;
        }

        return url;
    };

    useEffect(() => {
        // Socket listener for synchronized video updates across players
        const handleCinemaUrlUpdate = (formattedUrl: string) => {
            console.log("🎬 [Cinema] Received synchronized URL:", formattedUrl);
            setEmbedUrl(formattedUrl);
            setMode("embed");
        };

        socket.on("cinema_url_updated", handleCinemaUrlUpdate);

        return () => {
            socket.off("cinema_url_updated", handleCinemaUrlUpdate);
        };
    }, []);

    const handleLoadStream = () => {
        if (!inputUrl.trim()) return;
        const formatted = formatEmbedUrl(inputUrl);
        setEmbedUrl(formatted);
        socket.emit("cinema_change_url", { roomCode: room.code, url: formatted });
    };

    return (
        <div className="flex flex-col md:flex-row h-screen bg-slate-900 text-white overflow-hidden">
            {/* Sidebar: Reusing VideoCall Component */}
            <VideoCall roomCode={room.code} opponentName={opponentName} />

            {/* Main Stage Area */}
            <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-950">
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
                                Use the screen sharing controls on your WebRTC call panel on the sidebar to stream your screen or tab with audio directly to your partner.
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
                                    placeholder="Paste YouTube or embeddable video URL (e.g., https://www.youtube.com/watch?v=...)..."
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
                                {embedUrl ? (
                                    <iframe
                                        src={embedUrl}
                                        title="Embedded Stream"
                                        className="w-full h-full border-0"
                                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                        allowFullScreen
                                    />
                                ) : (
                                    <div className="text-center p-6 text-slate-500 flex flex-col items-center gap-2">
                                        <div className="text-4xl">🍿</div>
                                        <p className="text-sm">No video loaded yet. Paste a link above to start watching together!</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
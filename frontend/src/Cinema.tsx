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

    // Screen Share state
    const [isSharingScreen, setIsSharingScreen] = useState(false);
    const [hasRemoteScreen, setHasRemoteScreen] = useState(false);

    // Refs for Video & WebRTC
    const localScreenRef = useRef<HTMLVideoElement | null>(null);
    const remoteScreenRef = useRef<HTMLVideoElement | null>(null);
    const screenStreamRef = useRef<MediaStream | null>(null);
    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

    // YouTube Sync Refs
    const playerRef = useRef<any>(null);
    const isRemoteAction = useRef<boolean>(false);

    const opponent = room.players.find((p) => p.id !== myId);
    const opponentName = opponent ? opponent.name : "Waiting for opponent...";

    /* ===================================================================
       1. YOUTUBE PLAYER & SYNC LOGIC
       =================================================================== */

    const extractYouTubeId = (url: string): string | null => {
        const trimmed = url.trim();
        if (!trimmed) return null;

        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = trimmed.match(regExp);

        return match && match[2].length === 11 ? match[2] : null;
    };

    useEffect(() => {
        if (!window.YT) {
            const tag = document.createElement("script");
            tag.src = "https://www.youtube.com/iframe_api";
            const firstScriptTag = document.getElementsByTagName("script")[0];
            firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
        }
    }, []);

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

    const handlePlayerStateChange = (event: any) => {
        if (!playerRef.current) return;

        if (isRemoteAction.current) {
            isRemoteAction.current = false;
            return;
        }

        const currentTime = playerRef.current.getCurrentTime();
        const playerState = event.data;

        // YT.PlayerState.PLAYING = 1, PAUSED = 2
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

    /* ===================================================================
       2. WEBRTC DIRECT SCREEN SHARING LOGIC
       =================================================================== */

    const createPeerConnection = () => {
        if (peerConnectionRef.current) return peerConnectionRef.current;

        const pc = new RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit("cinema_screen_ice", {
                    roomCode: room.code,
                    candidate: event.candidate,
                });
            }
        };

        pc.ontrack = (event) => {
            if (remoteScreenRef.current && event.streams[0]) {
                remoteScreenRef.current.srcObject = event.streams[0];
                setHasRemoteScreen(true);
            }
        };

        peerConnectionRef.current = pc;
        return pc;
    };

    const startScreenShare = async () => {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true,
            });

            screenStreamRef.current = stream;
            if (localScreenRef.current) {
                localScreenRef.current.srcObject = stream;
            }

            const pc = createPeerConnection();
            stream.getTracks().forEach((track) => pc.addTrack(track, stream));

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            socket.emit("cinema_screen_offer", {
                roomCode: room.code,
                offer,
            });

            setIsSharingScreen(true);

            // Handle user stopping stream via browser UI stop button
            stream.getVideoTracks()[0].onended = () => {
                stopScreenShare();
            };
        } catch (err) {
            console.error("Error starting screen share:", err);
        }
    };

    const stopScreenShare = () => {
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach((track) => track.stop());
            screenStreamRef.current = null;
        }

        if (peerConnectionRef.current) {
            peerConnectionRef.current.close();
            peerConnectionRef.current = null;
        }

        if (localScreenRef.current) {
            localScreenRef.current.srcObject = null;
        }

        setIsSharingScreen(false);
        socket.emit("cinema_screen_stop", { roomCode: room.code });
    };

    /* ===================================================================
       3. SOCKET EVENT LISTENERS
       =================================================================== */

    useEffect(() => {
        const handleCinemaUrlUpdate = (rawUrl: string) => {
            const extractedId = extractYouTubeId(rawUrl);
            if (extractedId) {
                setVideoId(extractedId);
                setMode("embed");
            }
        };

        const handleSyncAction = ({ action, currentTime }: { action: "play" | "pause" | "seek"; currentTime: number }) => {
            if (!playerRef.current) return;

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

        // WebRTC Screen Share Signaling
        const handleScreenOffer = async ({ offer }: { offer: RTCSessionDescriptionInit }) => {
            setMode("screenshare");
            const pc = createPeerConnection();
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            socket.emit("cinema_screen_answer", {
                roomCode: room.code,
                answer,
            });
        };

        const handleScreenAnswer = async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
            if (peerConnectionRef.current) {
                await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
            }
        };

        const handleScreenIce = async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
            if (peerConnectionRef.current) {
                await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
            }
        };

        const handleScreenStop = () => {
            setHasRemoteScreen(false);
            if (remoteScreenRef.current) {
                remoteScreenRef.current.srcObject = null;
            }
        };

        socket.on("cinema_url_updated", handleCinemaUrlUpdate);
        socket.on("cinema_sync_action", handleSyncAction);
        socket.on("cinema_screen_offer", handleScreenOffer);
        socket.on("cinema_screen_answer", handleScreenAnswer);
        socket.on("cinema_screen_ice", handleScreenIce);
        socket.on("cinema_screen_stop", handleScreenStop);

        return () => {
            socket.off("cinema_url_updated", handleCinemaUrlUpdate);
            socket.off("cinema_sync_action", handleSyncAction);
            socket.off("cinema_screen_offer", handleScreenOffer);
            socket.off("cinema_screen_answer", handleScreenAnswer);
            socket.off("cinema_screen_ice", handleScreenIce);
            socket.off("cinema_screen_stop", handleScreenStop);
        };
    }, [room.code]);

    const handleLoadStream = () => {
        if (!inputUrl.trim()) return;

        const extractedId = extractYouTubeId(inputUrl);
        if (extractedId) {
            setVideoId(extractedId);
            socket.emit("cinema_change_url", { roomCode: room.code, url: inputUrl });
        } else {
            alert("Please provide a valid YouTube video link!");
        }
    };

    return (
        <div className="flex flex-col md:flex-row h-screen w-screen bg-slate-900 text-white overflow-hidden">
            {/* Sidebar: Purely for Audio/Video Call status */}
            <aside className="w-full md:w-80 lg:w-96 bg-slate-800 border-b md:border-b-0 md:border-r border-slate-700 flex flex-col shrink-0 z-10 shadow-lg">
                <div className="p-3 bg-slate-800/80 border-b border-slate-700 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Voice Chat Panel
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        Connected
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
                            🌐 Embedded Stream Mode
                        </button>
                    </div>

                    {/* Exit Room */}
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
                        <div className="w-full h-full flex flex-col gap-3">
                            {/* Screen Share Action Bar */}
                            <div className="flex items-center justify-between bg-slate-800 p-3 rounded-xl border border-slate-700">
                                <div className="text-xs text-slate-300">
                                    {isSharingScreen
                                        ? "🔴 You are sharing your screen"
                                        : hasRemoteScreen
                                            ? "📺 Viewing partner's stream"
                                            : "Ready to start screen share"}
                                </div>
                                <div>
                                    {!isSharingScreen ? (
                                        <button
                                            onClick={startScreenShare}
                                            className="bg-indigo-600 hover:bg-indigo-500 px-4 py-1.5 rounded-lg text-xs font-bold transition text-white"
                                        >
                                            Start Sharing Screen
                                        </button>
                                    ) : (
                                        <button
                                            onClick={stopScreenShare}
                                            className="bg-rose-600 hover:bg-rose-500 px-4 py-1.5 rounded-lg text-xs font-bold transition text-white"
                                        >
                                            Stop Sharing
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Video Player Display for Screen Share */}
                            <div className="flex-1 bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden relative shadow-2xl flex items-center justify-center">
                                {/* Local Screen Preview */}
                                <video
                                    ref={localScreenRef}
                                    autoPlay
                                    playsInline
                                    muted
                                    className={`w-full h-full object-contain ${isSharingScreen ? "block" : "hidden"
                                        }`}
                                />

                                {/* Remote Partner Screen Stream */}
                                <video
                                    ref={remoteScreenRef}
                                    autoPlay
                                    playsInline
                                    className={`w-full h-full object-contain ${!isSharingScreen && hasRemoteScreen ? "block" : "hidden"
                                        }`}
                                />

                                {/* Placeholder when idle */}
                                {!isSharingScreen && !hasRemoteScreen && (
                                    <div className="text-center p-6 text-slate-500 flex flex-col items-center gap-2">
                                        <div className="text-4xl">🖥️</div>
                                        <p className="text-sm">
                                            Click <strong>"Start Sharing Screen"</strong> above to stream your browser tab or app window to your partner.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        /* Embedded Stream Mode */
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

                            {/* YouTube Player Stage */}
                            <div className="flex-1 bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden relative shadow-2xl flex items-center justify-center">
                                <div id="youtube-player" className="w-full h-full" />
                                {!videoId && (
                                    <div className="absolute text-center p-6 text-slate-500 flex flex-col items-center gap-2 pointer-events-none">
                                        <div className="text-4xl">🍿</div>
                                        <p className="text-sm">No video loaded yet. Paste a YouTube link above to sync playback!</p>
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
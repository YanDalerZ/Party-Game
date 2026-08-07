import { useEffect, useRef, useState } from "react";
import { socket } from "./socket";

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

const PRESET_BACKGROUNDS = [
    { label: "Beach Sunset", url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&q=80" },
    { label: "Cozy Coffee Shop", url: "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=1200&q=80" },
    { label: "Cyberpunk City", url: "https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=1200&q=80" },
    { label: "Outer Space", url: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&q=80" },
];

export default function PhotoBooth({ room }: Props) {
    const localVideoRef = useRef<HTMLVideoElement | null>(null);
    const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    const pcRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);

    const [selectedBg, setSelectedBg] = useState<string>(PRESET_BACKGROUNDS[0].url);
    const [bgImageObj, setBgImageObj] = useState<HTMLImageElement | null>(null);
    const [countdown, setCountdown] = useState<number | null>(null);
    const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
    const [isConnected, setIsConnected] = useState<boolean>(false);

    // Preload selected background image
    useEffect(() => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = selectedBg;
        img.onload = () => setBgImageObj(img);
    }, [selectedBg]);

    // 1. Initialize WebRTC Video Call
    useEffect(() => {
        let isMounted = true;

        async function initCall() {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                localStreamRef.current = stream;

                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                }

                const pc = new RTCPeerConnection({
                    iceServers: [
                        { urls: "stun:stun.l.google.com:19302" },
                        { urls: "stun:stun1.l.google.com:19302" },
                    ],
                });
                pcRef.current = pc;

                stream.getTracks().forEach((track) => pc.addTrack(track, stream));

                pc.ontrack = (event) => {
                    if (remoteVideoRef.current && event.streams[0]) {
                        remoteVideoRef.current.srcObject = event.streams[0];
                        if (isMounted) setIsConnected(true);
                    }
                };

                pc.onicecandidate = (e) => {
                    if (e.candidate) {
                        socket.emit("webrtc_ice_candidate", { roomCode: room.code, candidate: e.candidate });
                    }
                };

                const handleOffer = async ({ offer }: { offer: RTCSessionDescriptionInit }) => {
                    if (!pcRef.current) return;
                    await pcRef.current.setRemoteDescription(new RTCSessionDescription(offer));
                    const answer = await pcRef.current.createAnswer();
                    await pcRef.current.setLocalDescription(answer);
                    socket.emit("webrtc_answer", { roomCode: room.code, answer });
                };

                const handleAnswer = async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
                    if (pcRef.current) {
                        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
                    }
                };

                const handleCandidate = async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
                    if (pcRef.current) {
                        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
                    }
                };

                socket.on("webrtc_offer", handleOffer);
                socket.on("webrtc_answer", handleAnswer);
                socket.on("webrtc_ice_candidate", handleCandidate);

                socket.emit("webrtc_ready", room.code);

                socket.on("start_webrtc_offer", async () => {
                    if (!pcRef.current) return;
                    const offer = await pcRef.current.createOffer();
                    await pcRef.current.setLocalDescription(offer);
                    socket.emit("webrtc_offer", { roomCode: room.code, offer });
                });
            } catch (err) {
                console.error("Camera access error:", err);
            }
        }

        initCall();

        return () => {
            isMounted = false;
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach((track) => track.stop());
            }
            if (pcRef.current) {
                pcRef.current.close();
            }
            socket.off("webrtc_offer");
            socket.off("webrtc_answer");
            socket.off("webrtc_ice_candidate");
            socket.off("start_webrtc_offer");
        };
    }, [room.code]);

    // 2. Synchronized Socket Listeners for Photo Booth
    useEffect(() => {
        const handleBgUpdate = (newUrl: string) => setSelectedBg(newUrl);

        const handlePhotoTaken = () => {
            let count = 3;
            setCountdown(count);
            const timer = setInterval(() => {
                count -= 1;
                if (count > 0) {
                    setCountdown(count);
                } else {
                    clearInterval(timer);
                    setCountdown(null);
                    // Snapshot composite canvas
                    if (canvasRef.current) {
                        const dataUrl = canvasRef.current.toDataURL("image/png");
                        setCapturedPhoto(dataUrl);
                    }
                }
            }, 1000);
        };

        socket.on("photobooth_bg_updated", handleBgUpdate);
        socket.on("photobooth_photo_taken", handlePhotoTaken);

        return () => {
            socket.off("photobooth_bg_updated", handleBgUpdate);
            socket.off("photobooth_photo_taken", handlePhotoTaken);
        };
    }, []);

    // 3. Real-Time Canvas Compositing Loop
    useEffect(() => {
        let animationFrameId: number;

        const renderCanvas = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw Background Image or Fallback
            if (bgImageObj) {
                ctx.drawImage(bgImageObj, 0, 0, canvas.width, canvas.height);
            } else {
                ctx.fillStyle = "#0f172a";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            const frameWidth = canvas.width / 2;
            const frameHeight = canvas.height;

            // Render Player 1 (Left Side)
            if (localVideoRef.current && localVideoRef.current.readyState === 4) {
                ctx.save();
                ctx.translate(frameWidth, 0);
                ctx.scale(-1, 1); // Mirror Local View
                ctx.drawImage(localVideoRef.current, 0, 0, frameWidth, frameHeight);
                ctx.restore();
            }

            // Render Player 2 (Right Side)
            if (remoteVideoRef.current && remoteVideoRef.current.readyState === 4) {
                ctx.save();
                ctx.drawImage(remoteVideoRef.current, frameWidth, 0, frameWidth, frameHeight);
                ctx.restore();
            }

            animationFrameId = requestAnimationFrame(renderCanvas);
        };

        renderCanvas();

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [bgImageObj]);

    const changeBackground = (url: string) => {
        socket.emit("photobooth_change_bg", { roomCode: room.code, bgUrl: url });
    };

    const triggerPhotoSnap = () => {
        socket.emit("photobooth_take_photo", { roomCode: room.code });
    };

    return (
        <div className="flex flex-col h-screen w-screen bg-slate-900 text-white overflow-hidden">
            {/* Hidden Feed Sources */}
            <video ref={localVideoRef} autoPlay playsInline muted className="hidden" />
            <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />

            {/* Header Control Panel */}
            <header className="p-4 bg-slate-800 border-b border-slate-700 flex justify-between items-center z-10 shadow-md">
                <div className="flex items-center gap-3">
                    <span className="text-2xl">📸</span>
                    <div>
                        <h1 className="text-lg font-bold text-slate-100">Co-Presence Photo Booth</h1>
                        <p className="text-xs text-slate-400">
                            {isConnected ? "Connected with Partner" : "Connecting WebRTC Stream..."}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={triggerPhotoSnap}
                        disabled={countdown !== null}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-xl transition shadow-lg shadow-emerald-600/30 text-sm"
                    >
                        📸 Take Joint Photo
                    </button>
                    <button
                        onClick={() => socket.emit("return_lobby", room.code)}
                        className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-xl text-xs font-semibold text-slate-200 transition"
                    >
                        Exit to Lobby
                    </button>
                </div>
            </header>

            {/* Main Stage */}
            <main className="flex-1 flex flex-col items-center justify-center p-4 relative overflow-hidden">
                <div className="relative w-full max-w-5xl aspect-video bg-black rounded-2xl border-2 border-slate-700 overflow-hidden shadow-2xl flex items-center justify-center">
                    <canvas ref={canvasRef} width={1280} height={720} className="w-full h-full object-cover" />

                    {/* Countdown Overlay */}
                    {countdown !== null && (
                        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-20">
                            <span className="text-9xl font-black text-amber-400 animate-ping">{countdown}</span>
                        </div>
                    )}
                </div>

                {/* Background Selector Carousel */}
                <div className="mt-4 flex items-center gap-3 bg-slate-800/80 p-2 rounded-2xl border border-slate-700 backdrop-blur-md">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider px-2">Backgrounds:</span>
                    {PRESET_BACKGROUNDS.map((bg) => (
                        <button
                            key={bg.label}
                            onClick={() => changeBackground(bg.url)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                                selectedBg === bg.url
                                    ? "bg-indigo-600 text-white ring-2 ring-indigo-400"
                                    : "bg-slate-700 hover:bg-slate-600 text-slate-300"
                            }`}
                        >
                            {bg.label}
                        </button>
                    ))}
                </div>
            </main>

            {/* Photo Capture Modal */}
            {capturedPhoto && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
                    <div className="bg-slate-800 border border-slate-700 p-6 rounded-2xl max-w-2xl w-full flex flex-col items-center gap-4 shadow-2xl">
                        <h2 className="text-xl font-bold text-slate-100">✨ Joint Memory Captured!</h2>
                        <img src={capturedPhoto} alt="Snapshot" className="w-full rounded-xl border border-slate-600 shadow-md" />
                        <div className="flex gap-3 w-full">
                            <a
                                href={capturedPhoto}
                                download={`photobooth-${room.code}.png`}
                                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-center py-2.5 rounded-xl font-bold text-sm transition"
                            >
                                ⬇️ Download Photo
                            </a>
                            <button
                                onClick={() => setCapturedPhoto(null)}
                                className="bg-slate-700 hover:bg-slate-600 text-slate-200 px-6 py-2.5 rounded-xl text-sm font-semibold transition"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
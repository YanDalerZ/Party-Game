import { useEffect, useRef, useState } from "react";
import { socket } from "./socket";
import { ImageSegmenter, FilesetResolver } from "@mediapipe/tasks-vision";

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

export default function PhotoBooth({ room, myId: _myId }: Props) {
    const localVideoRef = useRef<HTMLVideoElement | null>(null);
    const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
    const mainCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const stripCanvasRef = useRef<HTMLCanvasElement | null>(null);

    // Offscreen Canvases for Background Segmentation
    const localSegmentCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const remoteSegmentCanvasRef = useRef<HTMLCanvasElement | null>(null);

    const pcRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const segmenterRef = useRef<ImageSegmenter | null>(null);

    const [selectedBg, setSelectedBg] = useState<string>(PRESET_BACKGROUNDS[0].url);
    const [bgImageObj, setBgImageObj] = useState<HTMLImageElement | null>(null);
    const [countdown, setCountdown] = useState<number | null>(null);
    const [capturedPhotos, setCapturedPhotos] = useState<string[]>([]);
    const [isConnected, setIsConnected] = useState<boolean>(false);
    const [isSegmenterReady, setIsSegmenterReady] = useState<boolean>(false);

    // 1. Initialize MediaPipe Segmenter for Real-time Background Cutting
    useEffect(() => {
        async function loadSegmenter() {
            try {
                const filesetResolver = await FilesetResolver.forVisionTasks(
                    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
                );
                const segmenter = await ImageSegmenter.createFromOptions(filesetResolver, {
                    baseOptions: {
                        modelAssetPath:
                            "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
                        delegate: "GPU",
                    },
                    runningMode: "VIDEO",
                    outputCategoryMask: true,
                });
                segmenterRef.current = segmenter;
                setIsSegmenterReady(true);
            } catch (err) {
                console.error("Failed to load MediaPipe Segmenter:", err);
            }
        }
        loadSegmenter();
    }, []);

    // 2. Preload Selected Background Image
    useEffect(() => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = selectedBg;
        img.onload = () => setBgImageObj(img);
    }, [selectedBg]);

    // 3. WebRTC Peer Connection Setup
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

    // Helper: Segment Video Element and return cutout canvas
    const getCutoutCanvas = (
        video: HTMLVideoElement,
        targetCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>
    ): HTMLCanvasElement | null => {
        if (!targetCanvasRef.current) {
            targetCanvasRef.current = document.createElement("canvas");
        }
        const canvas = targetCanvasRef.current;
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (segmenterRef.current && isSegmenterReady) {
            try {
                const now = performance.now();
                const result = segmenterRef.current.segmentForVideo(video, now);
                if (result && result.categoryMask) {
                    const mask = result.categoryMask.getAsUint8Array();
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const pixels = imgData.data;

                    // Apply Alpha Mask: Make Background Pixels Transparent
                    for (let i = 0; i < mask.length; i++) {
                        if (mask[i] === 0) {
                            pixels[i * 4 + 3] = 0; // Alpha = 0
                        }
                    }
                    ctx.putImageData(imgData, 0, 0);
                    return canvas;
                }
            } catch (e) {
                // Fallback to raw video if segmentation frame drops
            }
        }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas;
    };

    // 4. Single Frame Overlay Rendering Loop (Overlapping Co-Presence)
    useEffect(() => {
        let animationFrameId: number;

        const renderCompositeCanvas = () => {
            const canvas = mainCanvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Layer 1: Render Shared Custom Background
            if (bgImageObj) {
                ctx.drawImage(bgImageObj, 0, 0, canvas.width, canvas.height);
            } else {
                ctx.fillStyle = "#0f172a";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            // Layer 2: Render Player 1 (Local Stream Occupies Full Frame)
            if (localVideoRef.current && localVideoRef.current.readyState === 4) {
                const localCutout = getCutoutCanvas(localVideoRef.current, localSegmentCanvasRef);
                if (localCutout) {
                    ctx.save();
                    ctx.translate(canvas.width, 0);
                    ctx.scale(-1, 1); // Mirror local stream for natural feel
                    ctx.drawImage(localCutout, 0, 0, canvas.width, canvas.height);
                    ctx.restore();
                }
            }

            // Layer 3: Render Player 2 (Remote Stream Occupies Full Frame Overlapping Player 1)
            if (remoteVideoRef.current && remoteVideoRef.current.readyState === 4) {
                const remoteCutout = getCutoutCanvas(remoteVideoRef.current, remoteSegmentCanvasRef);
                if (remoteCutout) {
                    ctx.save();
                    ctx.drawImage(remoteCutout, 0, 0, canvas.width, canvas.height);
                    ctx.restore();
                }
            }

            animationFrameId = requestAnimationFrame(renderCompositeCanvas);
        };

        renderCompositeCanvas();

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [bgImageObj, isSegmenterReady]);

    // 5. Synchronized Realtime Photostrip Handler
    useEffect(() => {
        const handleBgUpdate = (newUrl: string) => setSelectedBg(newUrl);

        const handleStripCleared = () => setCapturedPhotos([]);

        const handleStripFrameAdded = (frameUrl: string) => {
            setCapturedPhotos((prev) => [...prev, frameUrl]);
        };

        const handleSequenceStarted = () => {
            setCapturedPhotos([]);
            let photoCount = 0;

            const runCaptureCycle = () => {
                if (photoCount >= 3) return;

                let count = 3;
                setCountdown(count);

                const timer = setInterval(() => {
                    count -= 1;
                    if (count > 0) {
                        setCountdown(count);
                    } else {
                        clearInterval(timer);
                        setCountdown(null);

                        // Capture Current Overlay Canvas Snapshot
                        if (mainCanvasRef.current) {
                            const snapUrl = mainCanvasRef.current.toDataURL("image/png");
                            socket.emit("photobooth_add_strip_frame", { roomCode: room.code, frameUrl: snapUrl });
                        }

                        photoCount += 1;
                        if (photoCount < 3) {
                            setTimeout(runCaptureCycle, 1000);
                        }
                    }
                }, 1000);
            };

            runCaptureCycle();
        };

        socket.on("photobooth_bg_updated", handleBgUpdate);
        socket.on("photobooth_strip_cleared", handleStripCleared);
        socket.on("photobooth_sequence_started", handleSequenceStarted);
        socket.on("photobooth_strip_frame_added", handleStripFrameAdded);

        return () => {
            socket.off("photobooth_bg_updated", handleBgUpdate);
            socket.off("photobooth_strip_cleared", handleStripCleared);
            socket.off("photobooth_sequence_started", handleSequenceStarted);
            socket.off("photobooth_strip_frame_added", handleStripFrameAdded);
        };
    }, [room.code]);

    // Render Compiled Photo Strip to Download Canvas
    useEffect(() => {
        if (capturedPhotos.length === 0 || !stripCanvasRef.current) return;

        const canvas = stripCanvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const padding = 20;
        const photoWidth = 360;
        const photoHeight = 202; // 16:9 ratio
        const headerHeight = 60;
        const footerHeight = 40;

        canvas.width = photoWidth + padding * 2;
        canvas.height = headerHeight + footerHeight + capturedPhotos.length * photoHeight + (capturedPhotos.length + 1) * padding;

        // Draw Photostrip Background
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Header Title
        ctx.fillStyle = "#0f172a";
        ctx.font = "bold 20px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("LDR PHOTO BOOTH 📸", canvas.width / 2, 40);

        // Draw Photos
        capturedPhotos.forEach((url, idx) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = url;
            img.onload = () => {
                const yPos = headerHeight + padding + idx * (photoHeight + padding);
                ctx.drawImage(img, padding, yPos, photoWidth, photoHeight);

                // Footer Timestamp
                if (idx === capturedPhotos.length - 1) {
                    ctx.fillStyle = "#64748b";
                    ctx.font = "12px sans-serif";
                    ctx.fillText(new Date().toLocaleDateString() + " • Room: " + room.code, canvas.width / 2, canvas.height - 15);
                }
            };
        });
    }, [capturedPhotos, room.code]);

    const changeBackground = (url: string) => {
        socket.emit("photobooth_change_bg", { roomCode: room.code, bgUrl: url });
    };

    const startPhotoSequence = () => {
        socket.emit("photobooth_start_sequence", { roomCode: room.code });
    };

    const downloadStrip = () => {
        if (!stripCanvasRef.current) return;
        const link = document.createElement("a");
        link.download = `photostrip-${room.code}.png`;
        link.href = stripCanvasRef.current.toDataURL("image/png");
        link.click();
    };

    return (
        <div className="flex flex-col h-screen w-screen bg-slate-900 text-white overflow-hidden">
            {/* Hidden Video Elements */}
            <video ref={localVideoRef} autoPlay playsInline muted className="hidden" />
            <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />

            {/* Top Control Bar */}
            <header className="p-4 bg-slate-800 border-b border-slate-700 flex justify-between items-center shrink-0 z-10 shadow-md">
                <div className="flex items-center gap-3">
                    <span className="text-2xl">📸</span>
                    <div>
                        <h1 className="text-lg font-bold text-slate-100">Co-Presence Photo Booth</h1>
                        <p className="text-xs text-slate-400">
                            {!isSegmenterReady
                                ? "Loading Background Cutout Model..."
                                : isConnected
                                ? "Connected & Cutouts Active"
                                : "Connecting Stream..."}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={startPhotoSequence}
                        disabled={countdown !== null || !isSegmenterReady}
                        className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-xl transition shadow-lg shadow-emerald-600/30 text-sm"
                    >
                        📸 Take Photo Strip (3 Snaps)
                    </button>
                    <button
                        onClick={() => socket.emit("return_lobby", room.code)}
                        className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-xl text-xs font-semibold text-slate-200 transition"
                    >
                        Exit to Lobby
                    </button>
                </div>
            </header>

            {/* Main Stage & Photo Strip Side View */}
            <main className="flex-1 flex p-4 gap-4 overflow-hidden items-center justify-center">
                {/* Single Overlapping Video Box */}
                <div className="flex-1 flex flex-col items-center justify-center h-full max-w-5xl relative">
                    <div className="relative w-full aspect-video bg-black rounded-2xl border-2 border-slate-700 overflow-hidden shadow-2xl flex items-center justify-center">
                        <canvas ref={mainCanvasRef} width={1280} height={720} className="w-full h-full object-cover" />

                        {/* Synced Countdown Animation */}
                        {countdown !== null && (
                            <div className="absolute inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-20">
                                <span className="text-9xl font-black text-amber-400 animate-ping">{countdown}</span>
                            </div>
                        )}
                    </div>

                    {/* Shared Background Selector Bar */}
                    <div className="mt-4 flex items-center gap-3 bg-slate-800/90 p-2 rounded-2xl border border-slate-700 backdrop-blur-md">
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
                </div>

                {/* Real-Time Live Photo Strip Sidebar */}
                <aside className="w-80 bg-slate-800 border border-slate-700 rounded-2xl p-4 flex flex-col h-full max-h-[720px] shadow-2xl shrink-0">
                    <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-3 flex items-center justify-between">
                        <span>🎞️ Live Photo Strip</span>
                        <span className="text-xs text-indigo-400">{capturedPhotos.length}/3</span>
                    </h2>

                    <div className="flex-1 bg-slate-900 rounded-xl p-3 border border-slate-700 overflow-y-auto flex flex-col items-center gap-3 shadow-inner">
                        {capturedPhotos.length === 0 ? (
                            <div className="text-center text-slate-500 my-auto text-xs space-y-2">
                                <p className="text-2xl">🎞️</p>
                                <p>No photos snapped yet.</p>
                                <p>Click 'Take Photo Strip' above to start real-time sequence!</p>
                            </div>
                        ) : (
                            capturedPhotos.map((photo, i) => (
                                <div key={i} className="relative w-full aspect-video rounded-lg overflow-hidden border border-slate-700 shadow-md">
                                    <img src={photo} alt={`Snap ${i + 1}`} className="w-full h-full object-cover" />
                                    <span className="absolute bottom-1 right-1 bg-black/60 text-[10px] px-1.5 py-0.5 rounded text-white font-mono">
                                        #{i + 1}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Hidden Canvas used to generate final high-res downloadable strip */}
                    <canvas ref={stripCanvasRef} className="hidden" />

                    <button
                        onClick={downloadStrip}
                        disabled={capturedPhotos.length === 0}
                        className="mt-3 w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold py-2.5 rounded-xl transition text-xs shadow-lg shadow-indigo-600/30"
                    >
                        ⬇️ Download Photostrip
                    </button>
                </aside>
            </main>
        </div>
    );
}
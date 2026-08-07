import React, { useEffect, useRef, useState } from "react";
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
    { label: "Cozy Coffee", url: "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=1200&q=80" },
    { label: "Cyberpunk", url: "https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=1200&q=80" },
    { label: "Outer Space", url: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&q=80" },
];

export default function PhotoBooth({ room, myId: _myId }: Props) {
    const localVideoRef = useRef<HTMLVideoElement | null>(null);
    const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
    const mainCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const stripCanvasRef = useRef<HTMLCanvasElement | null>(null);

    // Offscreen Canvas Cache for Smooth Segmentation Filtering
    const localCutoutCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const remoteCutoutCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const localMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const remoteMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);

    const pcRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const segmenterRef = useRef<ImageSegmenter | null>(null);

    const [selectedBg, setSelectedBg] = useState<string>(PRESET_BACKGROUNDS[0].url);
    const [bgImageObj, setBgImageObj] = useState<HTMLImageElement | null>(null);
    const [countdown, setCountdown] = useState<number | null>(null);
    const [capturedPhotos, setCapturedPhotos] = useState<string[]>([]);
    const [isConnected, setIsConnected] = useState<boolean>(false);
    const [isSegmenterReady, setIsSegmenterReady] = useState<boolean>(false);
    const [showMobileStrip, setShowMobileStrip] = useState<boolean>(false);

    // 1. Initialize High-Quality MediaPipe Segmenter
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
                console.error("Failed to initialize background segmenter:", err);
            }
        }
        loadSegmenter();
    }, []);

    // 2. Preload Shared Background Image
    useEffect(() => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = selectedBg;
        img.onload = () => setBgImageObj(img);
    }, [selectedBg]);

    // 3. WebRTC Call & Stream Setup
    useEffect(() => {
        let isMounted = true;

        async function initCall() {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
                    audio: true,
                });
                localStreamRef.current = stream;

                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                    localVideoRef.current.play().catch((e) => console.log("Local video play exception:", e));
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
                        remoteVideoRef.current
                            .play()
                            .catch((e) => console.log("Remote video play trigger:", e));
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

    // High Quality Soft-Edge Cutout Processor (Optimized via 32-bit Buffer)
    const processHighQualityCutout = (
        video: HTMLVideoElement,
        cutoutCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>,
        maskCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>
    ): HTMLCanvasElement | null => {
        if (!segmenterRef.current || !isSegmenterReady || video.readyState < 2) return null;

        try {
            const result = segmenterRef.current.segmentForVideo(video, performance.now());
            if (!result || !result.categoryMask) return null;

            // Dynamically match the actual camera resolution to prevent distortion
            const maskWidth = result.categoryMask.width;
            const maskHeight = result.categoryMask.height;

            if (!cutoutCanvasRef.current) cutoutCanvasRef.current = document.createElement("canvas");
            if (!maskCanvasRef.current) maskCanvasRef.current = document.createElement("canvas");

            const cutoutCanvas = cutoutCanvasRef.current;
            const maskCanvas = maskCanvasRef.current;

            if (cutoutCanvas.width !== maskWidth) {
                cutoutCanvas.width = maskWidth;
                cutoutCanvas.height = maskHeight;
                maskCanvas.width = maskWidth;
                maskCanvas.height = maskHeight;
            }

            const cutoutCtx = cutoutCanvas.getContext("2d", { willReadFrequently: true });
            const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });

            if (!cutoutCtx || !maskCtx) return null;

            const categoryMask = result.categoryMask.getAsUint8Array();
            const maskImageData = maskCtx.createImageData(maskWidth, maskHeight);
            
            // Ultra-fast 32-bit pixel array manipulation
            const data32 = new Uint32Array(maskImageData.data.buffer);
            for (let i = 0; i < categoryMask.length; i++) {
                // INVERTED MASK LOGIC HERE
                // 0x00000000 = Fully transparent (Removes the background)
                // 0xFFFFFFFF = Fully opaque white (Keeps the person)
                data32[i] = categoryMask[i] > 0 ? 0x00000000 : 0xFFFFFFFF;
            }
            maskCtx.putImageData(maskImageData, 0, 0);

            cutoutCtx.clearRect(0, 0, maskWidth, maskHeight);
            
            // Draw raw video frame
            cutoutCtx.drawImage(video, 0, 0, maskWidth, maskHeight);
            
            // Apply destination-in to cut out the person cleanly.
            // A slight 2px blur creates a natural anti-aliased edge similar to Google Meet
            cutoutCtx.globalCompositeOperation = "destination-in";
            cutoutCtx.filter = "blur(2px)";
            cutoutCtx.drawImage(maskCanvas, 0, 0, maskWidth, maskHeight);
            
            // Reset for next frame
            cutoutCtx.filter = "none";
            cutoutCtx.globalCompositeOperation = "source-over";

            return cutoutCanvas;
        } catch (e) {
            // Failsafe rendering if segmenter momentarily faults
            return null;
        }
    };

    // 4. Main Compositing Canvas Render Loop
    useEffect(() => {
        let animationFrameId: number;

        const renderFrame = () => {
            const canvas = mainCanvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // 1. Draw Background
            if (bgImageObj) {
                ctx.drawImage(bgImageObj, 0, 0, canvas.width, canvas.height);
            } else {
                ctx.fillStyle = "#0f172a";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            // 2. Render Player 1 (Local Stream - Mirrored)
            if (localVideoRef.current) {
                const localCutout = processHighQualityCutout(localVideoRef.current, localCutoutCanvasRef, localMaskCanvasRef);
                if (localCutout) {
                    ctx.save();
                    ctx.translate(canvas.width, 0);
                    ctx.scale(-1, 1);
                    ctx.drawImage(localCutout, 0, 0, canvas.width, canvas.height);
                    ctx.restore();
                } else if (localVideoRef.current.readyState >= 2 && !isSegmenterReady) {
                    // Fallback before AI loads
                    ctx.save();
                    ctx.translate(canvas.width, 0);
                    ctx.scale(-1, 1);
                    ctx.drawImage(localVideoRef.current, 0, 0, canvas.width, canvas.height);
                    ctx.restore();
                }
            }

            // 3. Render Player 2 (Remote Stream - Overlapping Together)
            if (remoteVideoRef.current) {
                const remoteCutout = processHighQualityCutout(remoteVideoRef.current, remoteCutoutCanvasRef, remoteMaskCanvasRef);
                if (remoteCutout) {
                    ctx.save();
                    ctx.drawImage(remoteCutout, 0, 0, canvas.width, canvas.height);
                    ctx.restore();
                } else if (remoteVideoRef.current.readyState >= 2 && !isSegmenterReady) {
                     // Fallback
                     ctx.save();
                     ctx.drawImage(remoteVideoRef.current, 0, 0, canvas.width, canvas.height);
                     ctx.restore();
                }
            }

            animationFrameId = requestAnimationFrame(renderFrame);
        };

        renderFrame();

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [bgImageObj, isSegmenterReady]);

    // 5. Synchronized Realtime Photostrip Sequence (5 Seconds interval)
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

                let count = 5; // Updated to exactly 5 seconds interval
                setCountdown(count);

                const timer = setInterval(() => {
                    count -= 1;
                    if (count > 0) {
                        setCountdown(count);
                    } else {
                        clearInterval(timer);
                        setCountdown(null);

                        if (mainCanvasRef.current) {
                            const snapUrl = mainCanvasRef.current.toDataURL("image/png");
                            socket.emit("photobooth_add_strip_frame", { roomCode: room.code, frameUrl: snapUrl });
                        }

                        photoCount += 1;
                        if (photoCount < 3) {
                            // Give users a 500ms breather before showing the next countdown
                            setTimeout(runCaptureCycle, 500);
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

    // Generate Downloadable High-Res Photo Strip
    useEffect(() => {
        if (capturedPhotos.length === 0 || !stripCanvasRef.current) return;

        const canvas = stripCanvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const padding = 20;
        const photoWidth = 360;
        const photoHeight = 202;
        const headerHeight = 60;
        const footerHeight = 40;

        canvas.width = photoWidth + padding * 2;
        canvas.height =
            headerHeight +
            footerHeight +
            capturedPhotos.length * photoHeight +
            (capturedPhotos.length + 1) * padding;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = "#0f172a";
        ctx.font = "bold 20px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("CO-PRESENCE PHOTO BOOTH 📸", canvas.width / 2, 40);

        capturedPhotos.forEach((url, idx) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = url;
            img.onload = () => {
                const yPos = headerHeight + padding + idx * (photoHeight + padding);
                ctx.drawImage(img, padding, yPos, photoWidth, photoHeight);

                if (idx === capturedPhotos.length - 1) {
                    ctx.fillStyle = "#64748b";
                    ctx.font = "12px sans-serif";
                    ctx.fillText(
                        new Date().toLocaleDateString() + " • Room: " + room.code,
                        canvas.width / 2,
                        canvas.height - 15
                    );
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
        <div className="flex flex-col min-h-screen w-screen bg-slate-900 text-white overflow-x-hidden">
            {/* Hidden Feed Elements */}
            <video ref={localVideoRef} autoPlay playsInline muted className="hidden" />
            <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />

            {/* Header Control Panel */}
            <header className="p-3 sm:p-4 bg-slate-800 border-b border-slate-700 flex flex-wrap justify-between items-center gap-2 shrink-0 z-20 shadow-md">
                <div className="flex items-center gap-2 sm:gap-3">
                    <span className="text-xl sm:text-2xl">📸</span>
                    <div>
                        <h1 className="text-sm sm:text-lg font-bold text-slate-100">Co-Presence Photo Booth</h1>
                        <p className="text-[10px] sm:text-xs text-slate-400">
                            {!isSegmenterReady
                                ? "Loading AI Segmentation..."
                                : isConnected
                                ? "Connected & Cutouts Active"
                                : "Connecting Stream..."}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowMobileStrip(!showMobileStrip)}
                        className="lg:hidden bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-3 py-1.5 rounded-lg text-xs"
                    >
                        🎞️ Strip ({capturedPhotos.length})
                    </button>
                    <button
                        onClick={startPhotoSequence}
                        disabled={countdown !== null}
                        className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl transition shadow-lg shadow-emerald-600/30 text-xs sm:text-sm"
                    >
                        📸 Take 3 Snaps
                    </button>
                    <button
                        onClick={() => socket.emit("return_lobby", room.code)}
                        className="bg-slate-700 hover:bg-slate-600 px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-xl text-xs font-semibold text-slate-200 transition"
                    >
                        Exit
                    </button>
                </div>
            </header>

            {/* Responsive Main Layout Stage */}
            <main className="flex-1 flex flex-col lg:flex-row p-2 sm:p-4 gap-3 sm:gap-4 overflow-y-auto items-center justify-center">
                {/* Single Overlapping Canvas Display */}
                <div className="flex-1 flex flex-col items-center justify-center w-full max-w-5xl">
                    <div className="relative w-full aspect-video bg-black rounded-xl sm:rounded-2xl border border-slate-700 overflow-hidden shadow-2xl flex items-center justify-center">
                        <canvas ref={mainCanvasRef} width={1280} height={720} className="w-full h-full object-cover" />

                        {/* Synced Countdown Overlay */}
                        {countdown !== null && (
                            <div className="absolute inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-20">
                                <span className="text-7xl sm:text-9xl font-black text-amber-400 animate-ping">
                                    {countdown}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Shared Background Selection Strip */}
                    <div className="mt-3 w-full overflow-x-auto flex items-center gap-2 bg-slate-800/90 p-2 rounded-xl border border-slate-700 backdrop-blur-md">
                        <span className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider px-2 shrink-0">
                            Backgrounds:
                        </span>
                        {PRESET_BACKGROUNDS.map((bg) => (
                            <button
                                key={bg.label}
                                onClick={() => changeBackground(bg.url)}
                                className={`px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold shrink-0 transition ${
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

                {/* Real-Time Photostrip Sidebar (Desktop Dock / Mobile Drawer) */}
                <aside
                    className={`w-full lg:w-80 bg-slate-800 border border-slate-700 rounded-2xl p-3 sm:p-4 flex flex-col max-h-[500px] lg:max-h-[720px] shadow-2xl shrink-0 transition-all ${
                        showMobileStrip ? "block" : "hidden lg:flex"
                    }`}
                >
                    <h2 className="text-xs sm:text-sm font-bold text-slate-200 uppercase tracking-wider mb-2 flex items-center justify-between">
                        <span>🎞️ Live Photo Strip</span>
                        <span className="text-xs text-indigo-400">{capturedPhotos.length}/3</span>
                    </h2>

                    <div className="flex-1 bg-slate-900 rounded-xl p-2.5 border border-slate-700 overflow-y-auto flex flex-col items-center gap-2.5 shadow-inner min-h-[180px]">
                        {capturedPhotos.length === 0 ? (
                            <div className="text-center text-slate-500 my-auto text-xs space-y-1 p-4">
                                <p className="text-xl sm:text-2xl">🎞️</p>
                                <p>No photos snapped yet.</p>
                                <p className="text-[10px] text-slate-600">Click 'Take 3 Snaps' above to start sequence!</p>
                            </div>
                        ) : (
                            capturedPhotos.map((photo, i) => (
                                <div
                                    key={i}
                                    className="relative w-full aspect-video rounded-lg overflow-hidden border border-slate-700 shadow-md shrink-0"
                                >
                                    <img src={photo} alt={`Snap ${i + 1}`} className="w-full h-full object-cover" />
                                    <span className="absolute bottom-1 right-1 bg-black/60 text-[9px] px-1.5 py-0.5 rounded text-white font-mono">
                                        #{i + 1}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>

                    <canvas ref={stripCanvasRef} className="hidden" />

                    <button
                        onClick={downloadStrip}
                        disabled={capturedPhotos.length === 0}
                        className="mt-2.5 w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold py-2 rounded-xl transition text-xs shadow-lg shadow-indigo-600/30"
                    >
                        ⬇️ Download Photostrip
                    </button>
                </aside>
            </main>
        </div>
    );
}
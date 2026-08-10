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

    // 1. Initialize High-Quality MediaPipe Segmenter
    useEffect(() => {
        let isMounted = true;
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
                if (isMounted) {
                    segmenterRef.current = segmenter;
                    setIsSegmenterReady(true);
                }
            } catch (err) {
                console.error("Failed to initialize background segmenter:", err);
            }
        }
        loadSegmenter();
        return () => {
            isMounted = false;
            if (segmenterRef.current) {
                segmenterRef.current.close();
            }
        };
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
                    try {
                        if (pcRef.current.signalingState !== "stable") {
                            await Promise.all([
                                pcRef.current.setLocalDescription({ type: "rollback" }),
                                pcRef.current.setRemoteDescription(new RTCSessionDescription(offer)),
                            ]);
                        } else {
                            await pcRef.current.setRemoteDescription(new RTCSessionDescription(offer));
                        }
                        const answer = await pcRef.current.createAnswer();
                        await pcRef.current.setLocalDescription(answer);
                        socket.emit("webrtc_answer", { roomCode: room.code, answer });
                    } catch (err) {
                        console.error("Error handling offer:", err);
                    }
                };

                const handleAnswer = async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
                    if (!pcRef.current) return;
                    try {
                        if (pcRef.current.signalingState === "have-local-offer") {
                            await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
                        }
                    } catch (err) {
                        console.error("Error handling answer:", err);
                    }
                };

                const handleCandidate = async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
                    if (!pcRef.current) return;
                    try {
                        if (pcRef.current.remoteDescription) {
                            await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
                        }
                    } catch (err) {
                        console.error("Error handling ICE candidate:", err);
                    }
                };

                socket.on("webrtc_offer", handleOffer);
                socket.on("webrtc_answer", handleAnswer);
                socket.on("webrtc_ice_candidate", handleCandidate);

                socket.emit("webrtc_ready", room.code);

                socket.on("start_webrtc_offer", async () => {
                    if (!pcRef.current) return;
                    try {
                        const offer = await pcRef.current.createOffer();
                        await pcRef.current.setLocalDescription(offer);
                        socket.emit("webrtc_offer", { roomCode: room.code, offer });
                    } catch (err) {
                        console.error("Error starting offer:", err);
                    }
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

    const processHighQualityCutout = (
        video: HTMLVideoElement,
        cutoutCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>,
        maskCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>
    ): HTMLCanvasElement | null => {
        if (!segmenterRef.current || !isSegmenterReady || video.readyState < 2) return null;

        try {
            const result = segmenterRef.current.segmentForVideo(video, performance.now());
            if (!result || !result.categoryMask) return null;

            const categoryMaskObj = result.categoryMask;
            const maskWidth = categoryMaskObj.width;
            const maskHeight = categoryMaskObj.height;

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

            if (!cutoutCtx || !maskCtx) {
                categoryMaskObj.close();
                return null;
            }

            const categoryMask = categoryMaskObj.getAsUint8Array();
            const maskImageData = maskCtx.createImageData(maskWidth, maskHeight);

            const data32 = new Uint32Array(maskImageData.data.buffer);
            for (let i = 0; i < categoryMask.length; i++) {
                data32[i] = categoryMask[i] > 0 ? 0x00000000 : 0xffffffff;
            }
            maskCtx.putImageData(maskImageData, 0, 0);

            categoryMaskObj.close();

            cutoutCtx.clearRect(0, 0, maskWidth, maskHeight);
            cutoutCtx.drawImage(video, 0, 0, maskWidth, maskHeight);

            cutoutCtx.globalCompositeOperation = "destination-in";
            cutoutCtx.filter = "blur(2px)";
            cutoutCtx.drawImage(maskCanvas, 0, 0, maskWidth, maskHeight);

            cutoutCtx.filter = "none";
            cutoutCtx.globalCompositeOperation = "source-over";

            return cutoutCanvas;
        } catch (e) {
            return null;
        }
    };

    const drawAspectCover = (
        ctx: CanvasRenderingContext2D,
        source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
        targetWidth: number,
        targetHeight: number
    ) => {
        let srcWidth = 0;
        let srcHeight = 0;

        if (source instanceof HTMLVideoElement) {
            srcWidth = source.videoWidth;
            srcHeight = source.videoHeight;
        } else if (source instanceof HTMLCanvasElement) {
            srcWidth = source.width;
            srcHeight = source.height;
        } else if (source instanceof HTMLImageElement) {
            srcWidth = source.naturalWidth || source.width;
            srcHeight = source.naturalHeight || source.height;
        }

        if (!srcWidth || !srcHeight) return;

        const srcAspect = srcWidth / srcHeight;
        const targetAspect = targetWidth / targetHeight;

        let drawWidth = targetWidth;
        let drawHeight = targetHeight;
        let offsetX = 0;
        let offsetY = 0;

        if (srcAspect > targetAspect) {
            drawWidth = targetHeight * srcAspect;
            offsetX = (targetWidth - drawWidth) / 2;
        } else {
            drawHeight = targetWidth / srcAspect;
            offsetY = (targetHeight - drawHeight) / 2;
        }

        ctx.drawImage(source, offsetX, offsetY, drawWidth, drawHeight);
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

            if (bgImageObj) {
                drawAspectCover(ctx, bgImageObj, canvas.width, canvas.height);
            } else {
                ctx.fillStyle = "#f3e8ff";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            if (localVideoRef.current) {
                const localCutout = processHighQualityCutout(
                    localVideoRef.current,
                    localCutoutCanvasRef,
                    localMaskCanvasRef
                );
                ctx.save();
                ctx.translate(canvas.width, 0);
                ctx.scale(-1, 1);

                if (localCutout) {
                    drawAspectCover(ctx, localCutout, canvas.width, canvas.height);
                } else if (localVideoRef.current.readyState >= 2) {
                    drawAspectCover(ctx, localVideoRef.current, canvas.width, canvas.height);
                }
                ctx.restore();
            }

            if (remoteVideoRef.current) {
                const remoteCutout = processHighQualityCutout(
                    remoteVideoRef.current,
                    remoteCutoutCanvasRef,
                    remoteMaskCanvasRef
                );
                ctx.save();
                if (remoteCutout) {
                    drawAspectCover(ctx, remoteCutout, canvas.width, canvas.height);
                } else if (remoteVideoRef.current.readyState >= 2) {
                    drawAspectCover(ctx, remoteVideoRef.current, canvas.width, canvas.height);
                }
                ctx.restore();
            }

            animationFrameId = requestAnimationFrame(renderFrame);
        };

        renderFrame();

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [bgImageObj, isSegmenterReady]);

    // Function to capture current canvas frame and add to photostrip
    const captureCurrentCanvasToStrip = () => {
        const canvas = mainCanvasRef.current;
        if (!canvas) return;

        const snapshotDataUrl = canvas.toDataURL("image/png");

        setCapturedPhotos((prev) => {
            if (prev.length >= 3) {
                return [...prev.slice(1), snapshotDataUrl];
            }
            return [...prev, snapshotDataUrl];
        });

        socket.emit("photobooth_add_strip_frame", { roomCode: room.code, frameUrl: snapshotDataUrl });
    };

    // 5. Synchronized Realtime Photostrip Sequence & Socket Events
    useEffect(() => {
        const handleBgUpdate = (newUrl: string) => setSelectedBg(newUrl);
        const handleStripCleared = () => setCapturedPhotos([]);
        const handleStripFrameAdded = (frameUrl: string) => {
            setCapturedPhotos((prev) => {
                if (prev.includes(frameUrl)) return prev;
                if (prev.length >= 3) {
                    return [...prev.slice(1), frameUrl];
                }
                return [...prev, frameUrl];
            });
        };

        const handleSequenceStarted = () => {
            setCapturedPhotos([]);
            socket.emit("photobooth_clear_strip", { roomCode: room.code });

            let photoCount = 0;

            const runCaptureCycle = () => {
                if (photoCount >= 3) {
                    setCountdown(null);
                    return;
                }

                let count = 5;
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

    // Render Photostrip to Export Canvas Whenever Captured Photos Update
    useEffect(() => {
        if (!stripCanvasRef.current) return;

        const canvas = stripCanvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const maxSlots = 3;
        const padding = 28;
        const photoWidth = 360;
        const photoHeight = 202;
        const headerHeight = 30;
        const footerHeight = 110;

        canvas.width = photoWidth + padding * 2;
        canvas.height = headerHeight + footerHeight + maxSlots * photoHeight + (maxSlots + 1) * padding;

        const renderStrip = (loadedImages: (HTMLImageElement | null)[]) => {
            ctx.fillStyle = "#fdf4ff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            for (let i = 0; i < maxSlots; i++) {
                const yPos = headerHeight + padding + i * (photoHeight + padding);

                ctx.strokeStyle = "#f472b6";
                ctx.lineWidth = 4;
                ctx.strokeRect(padding - 3, yPos - 3, photoWidth + 6, photoHeight + 6);

                const img = loadedImages[i];
                if (img) {
                    ctx.drawImage(img, padding, yPos, photoWidth, photoHeight);
                } else {
                    ctx.fillStyle = "#fae8ff";
                    ctx.fillRect(padding, yPos, photoWidth, photoHeight);

                    ctx.fillStyle = "#c084fc";
                    ctx.font = "bold 14px sans-serif";
                    ctx.textAlign = "center";
                    ctx.fillText(`✨ SNAP #${i + 1} ✨`, canvas.width / 2, yPos + photoHeight / 2);
                }
            }

            const footerY = canvas.height - footerHeight + 15;
            ctx.fillStyle = "#a855f7";
            ctx.font = "bold 22px cursive, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("✨ Co-Presence Photo Booth ✨", canvas.width / 2, footerY + 25);

            ctx.fillStyle = "#ec4899";
            ctx.font = "12px sans-serif";
            ctx.fillText(
                `${new Date().toLocaleDateString()} • ROOM: ${room.code}`,
                canvas.width / 2,
                footerY + 52
            );
        };

        if (capturedPhotos.length === 0) {
            renderStrip([]);
            return;
        }

        const loadedImages: (HTMLImageElement | null)[] = new Array(capturedPhotos.length).fill(null);
        let loadedCount = 0;

        capturedPhotos.forEach((url, idx) => {
            const img = new Image();
            img.src = url;
            img.onload = () => {
                loadedImages[idx] = img;
                loadedCount++;
                if (loadedCount === capturedPhotos.length) {
                    renderStrip(loadedImages);
                }
            };
            img.onerror = () => {
                loadedCount++;
                if (loadedCount === capturedPhotos.length) {
                    renderStrip(loadedImages);
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
        <div className="flex flex-col h-screen w-screen bg-gradient-to-br from-pink-100 via-purple-100 to-pink-200 text-slate-800 overflow-hidden font-sans">
            <video ref={localVideoRef} autoPlay playsInline muted className="hidden" />
            <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />

            {/* Header */}
            <header className="p-2 sm:p-4 bg-white/80 backdrop-blur-md border-b border-pink-200 flex justify-between items-center shrink-0 z-20 shadow-sm">
                <div className="flex items-center gap-2 sm:gap-3">
                    <span className="text-xl sm:text-2xl animate-bounce">📸</span>
                    <div>
                        <h1 className="text-sm sm:text-lg font-extrabold bg-gradient-to-r from-pink-500 to-purple-600 bg-clip-text text-transparent">
                            Cute Photo Booth
                        </h1>
                        <p className="text-[10px] sm:text-xs text-purple-500 font-medium">
                            {!isSegmenterReady
                                ? "Loading AI Segmentation..."
                                : isConnected
                                    ? "Connected & Cutouts Active"
                                    : "Connecting Stream..."}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2">
                    <button
                        onClick={captureCurrentCanvasToStrip}
                        className="bg-pink-500 hover:bg-pink-600 text-white font-bold px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-2xl transition shadow-md shadow-pink-300 text-xs sm:text-sm active:scale-95"
                    >
                        📷 Snap
                    </button>
                    <button
                        onClick={startPhotoSequence}
                        disabled={countdown !== null}
                        className="bg-purple-500 hover:bg-purple-600 disabled:opacity-50 text-white font-bold px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-2xl transition shadow-md shadow-purple-300 text-xs sm:text-sm active:scale-95"
                    >
                        📸 Auto 3
                    </button>
                    <button
                        onClick={() => socket.emit("return_lobby", room.code)}
                        className="bg-pink-100 hover:bg-pink-200 px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-2xl text-xs font-bold text-pink-600 transition"
                    >
                        Exit
                    </button>
                </div>
            </header>

            {/* Main Area */}
            <main className="flex-1 flex flex-col md:flex-row p-2 sm:p-4 gap-3 sm:gap-4 overflow-hidden min-h-0">
                {/* Canvas View Area */}
                <div className="flex-1 flex flex-col items-center justify-center min-h-0">
                    <div className="relative w-full h-full max-h-[50vh] md:max-h-[75vh] aspect-video bg-white rounded-3xl border-4 border-pink-300 overflow-hidden shadow-xl flex items-center justify-center">
                        <canvas ref={mainCanvasRef} width={1280} height={720} className="w-full h-full object-cover" />

                        {countdown !== null && (
                            <div className="absolute inset-0 bg-purple-900/30 backdrop-blur-xs flex items-center justify-center z-20">
                                <span className="text-7xl sm:text-9xl font-black text-pink-400 drop-shadow-lg animate-ping">
                                    {countdown}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Background Selector */}
                    <div className="mt-2 sm:mt-3 w-full overflow-x-auto flex items-center gap-2 bg-white/80 p-2 rounded-2xl border border-pink-200 backdrop-blur-md shrink-0 shadow-sm">
                        <span className="text-[10px] sm:text-xs font-bold text-purple-600 uppercase tracking-wider px-2 shrink-0">
                            Theme:
                        </span>
                        {PRESET_BACKGROUNDS.map((bg) => (
                            <button
                                key={bg.label}
                                onClick={() => changeBackground(bg.url)}
                                className={`px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-xl text-[11px] sm:text-xs font-bold shrink-0 transition ${selectedBg === bg.url
                                    ? "bg-gradient-to-r from-pink-500 to-purple-500 text-white shadow-sm"
                                    : "bg-purple-50 hover:bg-purple-100 text-purple-600"
                                    }`}
                            >
                                {bg.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Sidebar Photostrip (Vertical on desktop, Horizontal tray on mobile) */}
                <aside className="w-full md:w-80 bg-white/90 border-2 border-pink-200 rounded-3xl p-3 sm:p-4 flex flex-col shrink-0 shadow-xl h-auto md:h-full min-h-0">
                    <h2 className="text-xs sm:text-sm font-extrabold text-purple-600 uppercase tracking-wider mb-2 flex items-center justify-between shrink-0">
                        <span>🎀 Photo Strip</span>
                        <span className="text-xs text-pink-500 font-mono font-bold">{capturedPhotos.length}/3</span>
                    </h2>

                    <div className="flex-1 bg-pink-50/50 rounded-2xl p-2 sm:p-3 border-2 border-pink-200 overflow-x-auto md:overflow-y-auto flex flex-row md:flex-col items-center gap-2 sm:gap-3 shadow-inner min-h-0">
                        {[0, 1, 2, 3].map((idx) => {
                            const photo = capturedPhotos[idx];
                            return (
                                <div
                                    key={idx}
                                    className="relative w-28 sm:w-36 md:w-full aspect-video rounded-xl overflow-hidden border-2 border-pink-300 bg-white shadow-sm shrink-0 flex items-center justify-center"
                                >
                                    {photo ? (
                                        <>
                                            <img src={photo} alt={`Snap ${idx + 1}`} className="w-full h-full object-cover" />
                                            <span className="absolute bottom-1 right-1 bg-pink-500/80 text-white text-[8px] sm:text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                                                #{idx + 1}
                                            </span>
                                        </>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center text-pink-300 space-y-1">
                                            <span className="text-[10px] sm:text-xs font-bold tracking-wider">
                                                ✨ SNAP #{idx + 1} ✨
                                            </span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        <div className="hidden md:block mt-auto pt-3 text-center w-full border-t border-pink-200 shrink-0">
                            <p className="font-bold text-xs text-purple-600 tracking-wide">
                                ✨ PHOTO BOOTH ✨
                            </p>
                            <p className="text-[10px] text-pink-400 mt-0.5">
                                {new Date().toLocaleDateString()} • Room: {room.code}
                            </p>
                        </div>
                    </div>

                    <canvas ref={stripCanvasRef} className="hidden" />

                    <button
                        onClick={downloadStrip}
                        disabled={capturedPhotos.length === 0}
                        className="mt-2 sm:mt-3 w-full bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 disabled:opacity-40 text-white font-extrabold py-2 rounded-2xl transition text-xs shadow-md shadow-pink-200 shrink-0 active:scale-95"
                    >
                        💖 Download Strip
                    </button>
                </aside>
            </main>
        </div>
    );
}
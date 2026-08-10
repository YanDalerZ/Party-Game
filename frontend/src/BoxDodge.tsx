import { useEffect, useRef, useState } from "react";
import { socket } from "./socket";
import {
    PoseLandmarker,
    FilesetResolver,
    type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

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

export type ShapeType = "CUBE" | "BARRIER_WIDE" | "PILLAR_TALL" | "DIAMOND" | "WALL_FULL" | "HORIZONTAL_STRIP";

export interface BoxObstacle {
    id: string;
    shape: ShapeType;
    x: number;
    y: number;
    width: number;
    height: number;
    z: number;
    speed: number;
    color: string;
}

interface GameState {
    status: "WAITING" | "COUNTDOWN" | "PLAYING" | "GAME_OVER";
    scores: Record<string, number>;
    lives: Record<string, number>;
    boxes: BoxObstacle[];
    round: number;
    speedMultiplier: number;
}

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const HALF_WIDTH = CANVAS_WIDTH / 2;

const POSE_CONNECTIONS = [
    [11, 12], // Shoulders
    [11, 13], [13, 15], // Left Arm
    [12, 14], [14, 16], // Right Arm
    [11, 23], [12, 24], [23, 24], // Torso
    [23, 25], [25, 27], // Left Leg
    [24, 26], [26, 28]  // Right Leg
];

class SoundFX {
    private ctx: AudioContext | null = null;

    private init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
    }

    playHit() {
        this.init();
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(160, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.35, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.3);
    }
}

const sfx = new SoundFX();

export default function BoxDodgeGame({ room, myId }: Props) {
    const localVideoRef = useRef<HTMLVideoElement | null>(null);
    const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
    const mainCanvasRef = useRef<HTMLCanvasElement | null>(null);

    const pcRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);

    const localPoseLandmarkerRef = useRef<PoseLandmarker | null>(null);
    const remotePoseLandmarkerRef = useRef<PoseLandmarker | null>(null);

    const [isModelsReady, setIsModelsReady] = useState<boolean>(false);
    const [screenShake, setScreenShake] = useState<boolean>(false);

    const [gameState, setGameState] = useState<GameState>({
        status: "WAITING",
        scores: {},
        lives: {},
        boxes: [],
        round: 1,
        speedMultiplier: 1.0,
    });
    const [gameCountdown, setGameCountdown] = useState<number | null>(null);

    const localLandmarksRef = useRef<NormalizedLandmark[] | null>(null);
    const remoteLandmarksRef = useRef<NormalizedLandmark[] | null>(null);

    const isHost = room.players.length > 0 && room.players[0].id === myId;
    const isSinglePlayer = room.players.length === 1;

    // 1. Initialize MediaPipe Models
    useEffect(() => {
        let isMounted = true;

        async function loadMediaPipeTasks() {
            try {
                const vision = await FilesetResolver.forVisionTasks(
                    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
                );

                const localPose = await PoseLandmarker.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath:
                            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
                        delegate: "GPU",
                    },
                    runningMode: "VIDEO",
                    numPoses: 1,
                });

                const remotePose = await PoseLandmarker.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath:
                            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
                        delegate: "GPU",
                    },
                    runningMode: "VIDEO",
                    numPoses: 1,
                });

                if (isMounted) {
                    localPoseLandmarkerRef.current = localPose;
                    remotePoseLandmarkerRef.current = remotePose;
                    setIsModelsReady(true);
                }
            } catch (err) {
                console.error("Failed to initialize Vision models:", err);
            }
        }

        loadMediaPipeTasks();

        return () => {
            isMounted = false;
            if (localPoseLandmarkerRef.current) localPoseLandmarkerRef.current.close();
            if (remotePoseLandmarkerRef.current) remotePoseLandmarkerRef.current.close();
        };
    }, []);

    // 2. WebRTC Peer Connections
    useEffect(() => {
        let isMounted = true;

        async function initCall() {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
                    audio: true,
                });
                localStreamRef.current = stream;

                if (localVideoRef.current && isMounted) {
                    localVideoRef.current.srcObject = stream;
                    localVideoRef.current.play().catch((e) => console.log("Local video error:", e));
                }

                if (isSinglePlayer) return;

                const pc = new RTCPeerConnection({
                    iceServers: [
                        { urls: "stun:stun.l.google.com:19302" },
                        { urls: "stun:stun1.l.google.com:19302" },
                    ],
                });
                pcRef.current = pc;

                stream.getTracks().forEach((track) => pc.addTrack(track, stream));

                pc.ontrack = (event) => {
                    if (remoteVideoRef.current && event.streams[0] && isMounted) {
                        remoteVideoRef.current.srcObject = event.streams[0];
                        remoteVideoRef.current.play().catch((e) => console.log("Remote video error:", e));
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
                        console.error("Error adding ICE candidate:", err);
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
    }, [room.code, isSinglePlayer]);

    // 3. Socket Listeners
    useEffect(() => {
        const handleStateSync = (state: GameState) => {
            setGameState(state);
        };

        const handleCountdown = (count: number | null) => {
            setGameCountdown(count);
        };

        const handleRemotePose = ({ senderId, landmarks }: { senderId: string; landmarks: NormalizedLandmark[] | null }) => {
            if (senderId !== myId) {
                remoteLandmarksRef.current = landmarks;
            }
        };

        socket.on("dodge_state_sync", handleStateSync);
        socket.on("dodge_countdown", handleCountdown);
        socket.on("pose_landmarks_sync", handleRemotePose);

        return () => {
            socket.off("dodge_state_sync", handleStateSync);
            socket.off("dodge_countdown", handleCountdown);
            socket.off("pose_landmarks_sync", handleRemotePose);
        };
    }, [myId]);

    // Helper: Draw Video
    const drawAspectCover = (
        ctx: CanvasRenderingContext2D,
        video: HTMLVideoElement,
        targetWidth: number,
        targetHeight: number,
        offsetX = 0,
        offsetY = 0
    ) => {
        const srcWidth = video.videoWidth;
        const srcHeight = video.videoHeight;
        if (!srcWidth || !srcHeight) return;

        const srcAspect = srcWidth / srcHeight;
        const targetAspect = targetWidth / targetHeight;

        let drawWidth = targetWidth;
        let drawHeight = targetHeight;
        let dx = offsetX;
        let dy = offsetY;

        if (srcAspect > targetAspect) {
            drawWidth = targetHeight * srcAspect;
            dx += (targetWidth - drawWidth) / 2;
        } else {
            drawHeight = targetWidth / srcAspect;
            dy += (targetHeight - drawHeight) / 2;
        }

        ctx.drawImage(video, dx, dy, drawWidth, drawHeight);
    };

    // Helper: Draw Background Grid
    const drawCustomBackground = (
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        w: number,
        h: number,
        primaryColor: string
    ) => {
        ctx.save();

        const grad = ctx.createLinearGradient(x, y, x, y + h);
        grad.addColorStop(0, "#030712");
        grad.addColorStop(0.5, "#0f172a");
        grad.addColorStop(1, "#181825");
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, w, h);

        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.25;

        const horizonY = y + h * 0.5; // Full screen mid horizon
        const numLines = 14;

        for (let i = 0; i <= numLines; i++) {
            const gx = x + (w / numLines) * i;
            ctx.beginPath();
            ctx.moveTo(x + w / 2, horizonY);
            ctx.lineTo(gx, y + h);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(x + w / 2, horizonY);
            ctx.lineTo(gx, y);
            ctx.stroke();
        }

        ctx.restore();
    };

    // Helper: Draw Skeleton
    const drawSkeleton = (
        ctx: CanvasRenderingContext2D,
        landmarks: NormalizedLandmark[],
        laneWidth: number,
        laneHeight: number,
        offsetX: number,
        isMirrored: boolean,
        accentColor: string
    ) => {
        ctx.save();

        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 6;
        ctx.lineCap = "round";
        ctx.shadowColor = accentColor;
        ctx.shadowBlur = 10;

        POSE_CONNECTIONS.forEach(([i, j]) => {
            const p1 = landmarks[i];
            const p2 = landmarks[j];

            if (p1 && p2 && (p1.visibility ?? 1) > 0.4 && (p2.visibility ?? 1) > 0.4) {
                const x1 = offsetX + (isMirrored ? (1 - p1.x) * laneWidth : p1.x * laneWidth);
                const y1 = p1.y * laneHeight;
                const x2 = offsetX + (isMirrored ? (1 - p2.x) * laneWidth : p2.x * laneWidth);
                const y2 = p2.y * laneHeight;

                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            }
        });

        landmarks.forEach((p) => {
            if (p && (p.visibility ?? 1) > 0.4) {
                const x = offsetX + (isMirrored ? (1 - p.x) * laneWidth : p.x * laneWidth);
                const y = p.y * laneHeight;

                ctx.fillStyle = "#ffffff";
                ctx.beginPath();
                ctx.arc(x, y, 7, 0, Math.PI * 2);
                ctx.fill();

                ctx.strokeStyle = accentColor;
                ctx.lineWidth = 3;
                ctx.stroke();
            }
        });

        ctx.restore();
    };

    // Helper: Render Dynamic Shapes in 3D Perspective
    const draw3DShape = (
        ctx: CanvasRenderingContext2D,
        box: BoxObstacle,
        laneOffsetX: number,
        laneWidth: number,
        laneHeight: number
    ) => {
        const scaleNear = 0.2 + (1.0 - box.z) * 0.85;

        const currentW = box.width * laneWidth * scaleNear;
        const currentH = box.height * laneHeight * scaleNear;

        // Position covers entire viewport span (Top-Left to Bottom-Right)
        const centerX = laneOffsetX + laneWidth * 0.5 + box.x * (laneWidth * 0.42);
        const centerY = laneHeight * 0.5 + box.y * (laneHeight * 0.42);

        const fL = centerX - currentW / 2;
        const fR = centerX + currentW / 2;
        const fT = centerY - currentH / 2;
        const fB = centerY + currentH / 2;

        const vanishingX = laneOffsetX + laneWidth * 0.5;
        const vanishingY = laneHeight * 0.5;

        const bL = fL + (vanishingX - fL) * 0.25;
        const bR = fR + (vanishingX - fR) * 0.25;
        const bT = fT + (vanishingY - fT) * 0.25;
        const bB = fB + (vanishingY - fB) * 0.25;

        ctx.save();

        const isDodgeZone = box.z <= 0.25;
        const strokeColor = isDodgeZone ? "#ff0055" : box.color;
        const fillColor = isDodgeZone ? "rgba(255, 0, 85, 0.5)" : `${box.color}44`;

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = Math.max(2, 4 * scaleNear);
        ctx.shadowColor = strokeColor;
        ctx.shadowBlur = isDodgeZone ? 22 : 12;

        if (box.shape === "DIAMOND") {
            // Render 3D Diamond / Octahedron
            const drawDiamondFace = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number) => {
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.lineTo(x3, y3);
                ctx.lineTo(x4, y4);
                ctx.closePath();
                ctx.fillStyle = fillColor;
                ctx.fill();
                ctx.stroke();
            };

            const midX = (fL + fR) / 2;
            const midY = (fT + fB) / 2;

            drawDiamondFace(midX, fT, fR, midY, midX, fB, fL, midY);
        } else {
            // Render 3D Extruded Box / Barrier / Pillar / Wall
            const drawEdge = (x1: number, y1: number, x2: number, y2: number) => {
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            };

            drawEdge(fL, fT, bL, bT);
            drawEdge(fR, fT, bR, bT);
            drawEdge(fL, fB, bL, bB);
            drawEdge(fR, fB, bR, bB);

            ctx.strokeRect(bL, bT, bR - bL, bB - bT);

            ctx.fillStyle = fillColor;
            ctx.fillRect(fL, fT, currentW, currentH);
            ctx.strokeRect(fL, fT, currentW, currentH);
        }

        if (isDodgeZone) {
            ctx.fillStyle = "#ffffff";
            ctx.font = "900 16px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("⚠️ DODGE NOW!", centerX, fT - 12);
        }

        ctx.restore();
    };

    // Helper: Collision Checker across full body keypoints
    const checkSkeletonBoxCollision = (
        landmarks: NormalizedLandmark[],
        box: BoxObstacle,
        isMirrored: boolean
    ): boolean => {
        if (box.z > 0.25) return false;

        const scale = 0.2 + (1.0 - box.z) * 0.85;
        const currentW = box.width * HALF_WIDTH * scale;
        const currentH = box.height * CANVAS_HEIGHT * scale;

        const centerX = HALF_WIDTH * 0.5 + box.x * (HALF_WIDTH * 0.42);
        const centerY = CANVAS_HEIGHT * 0.5 + box.y * (CANVAS_HEIGHT * 0.42);

        const boxLeft = (centerX - currentW / 2) / HALF_WIDTH;
        const boxRight = (centerX + currentW / 2) / HALF_WIDTH;
        const boxTop = (centerY - currentH / 2) / CANVAS_HEIGHT;
        const boxBottom = (centerY + currentH / 2) / CANVAS_HEIGHT;

        const keyIndices = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

        return keyIndices.some((idx) => {
            const p = landmarks[idx];
            if (!p || (p.visibility ?? 1) <= 0.35) return false;
            const px = isMirrored ? 1 - p.x : p.x;
            const py = p.y;
            return px >= boxLeft && px <= boxRight && py >= boxTop && py <= boxBottom;
        });
    };

    // 4. Main Render Loop
    useEffect(() => {
        let animationFrameId: number;
        let lastEmitTime = 0;

        const render = () => {
            const canvas = mainCanvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

            const player1 = room.players[0];
            const player2 = room.players[1];

            // Detect Local Pose
            if (localPoseLandmarkerRef.current && isModelsReady && localVideoRef.current && localVideoRef.current.readyState >= 2) {
                try {
                    const poseResult = localPoseLandmarkerRef.current.detectForVideo(
                        localVideoRef.current,
                        performance.now()
                    );
                    localLandmarksRef.current = poseResult.landmarks?.[0] ?? null;

                    const now = performance.now();
                    if (now - lastEmitTime > 33) {
                        lastEmitTime = now;
                        socket.emit("pose_landmarks_sync", {
                            roomCode: room.code,
                            senderId: myId,
                            landmarks: localLandmarksRef.current,
                        });
                    }
                } catch (e) {
                    // Skip frame
                }
            }

            // Remote Pose Fallback
            if (remotePoseLandmarkerRef.current && isModelsReady && remoteVideoRef.current && remoteVideoRef.current.readyState >= 2) {
                try {
                    const remoteResult = remotePoseLandmarkerRef.current.detectForVideo(
                        remoteVideoRef.current,
                        performance.now()
                    );
                    if (remoteResult.landmarks && remoteResult.landmarks.length > 0) {
                        remoteLandmarksRef.current = remoteResult.landmarks[0];
                    }
                } catch (e) {
                    // Skip frame
                }
            }

            // --- Render Lane 1 ---
            drawCustomBackground(ctx, 0, 0, HALF_WIDTH, CANVAS_HEIGHT, "#00f3ff");

            const isP1Local = player1?.id === myId;
            const p1Video = isP1Local ? localVideoRef.current : remoteVideoRef.current;

            if (p1Video && p1Video.readyState >= 2) {
                ctx.save();
                ctx.globalAlpha = 0.65;
                ctx.translate(HALF_WIDTH, 0);
                ctx.scale(-1, 1);
                drawAspectCover(ctx, p1Video, HALF_WIDTH, CANVAS_HEIGHT);
                ctx.restore();
            }

            const p1Landmarks = isP1Local ? localLandmarksRef.current : remoteLandmarksRef.current;
            if (p1Landmarks) {
                drawSkeleton(ctx, p1Landmarks, HALF_WIDTH, CANVAS_HEIGHT, 0, true, "#00f3ff");
            }

            // --- Render Lane 2 ---
            drawCustomBackground(ctx, HALF_WIDTH, 0, HALF_WIDTH, CANVAS_HEIGHT, "#a855f7");

            if (player2) {
                const isP2Local = player2.id === myId;
                const p2Video = isP2Local ? localVideoRef.current : remoteVideoRef.current;

                if (p2Video && p2Video.readyState >= 2) {
                    ctx.save();
                    ctx.globalAlpha = 0.65;
                    ctx.translate(CANVAS_WIDTH, 0);
                    ctx.scale(-1, 1);
                    drawAspectCover(ctx, p2Video, HALF_WIDTH, CANVAS_HEIGHT);
                    ctx.restore();
                }

                const p2Landmarks = isP2Local ? localLandmarksRef.current : remoteLandmarksRef.current;
                if (p2Landmarks) {
                    drawSkeleton(ctx, p2Landmarks, HALF_WIDTH, CANVAS_HEIGHT, HALF_WIDTH, true, "#a855f7");
                }
            }

            // Lane Divider
            ctx.strokeStyle = "#38bdf8";
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(HALF_WIDTH, 0);
            ctx.lineTo(HALF_WIDTH, CANVAS_HEIGHT);
            ctx.stroke();

            // --- Render Single Obstacle & Handle Collision ---
            if (gameState.status === "PLAYING" && gameState.boxes && gameState.boxes.length > 0) {
                const box = gameState.boxes[0];

                if (isHost) {
                    box.z -= box.speed;
                }

                draw3DShape(ctx, box, 0, HALF_WIDTH, CANVAS_HEIGHT);
                if (player2) {
                    draw3DShape(ctx, box, HALF_WIDTH, HALF_WIDTH, CANVAS_HEIGHT);
                }

                if (isHost && box.z <= 0.25) {
                    if (p1Landmarks && player1) {
                        if (checkSkeletonBoxCollision(p1Landmarks, box, true)) {
                            sfx.playHit();
                            triggerShake();
                            socket.emit("dodge_box_hit", {
                                roomCode: room.code,
                                playerId: player1.id,
                                boxId: box.id,
                            });
                        }
                    }
                    const p2Landmarks = player2?.id === myId ? localLandmarksRef.current : remoteLandmarksRef.current;
                    if (p2Landmarks && player2) {
                        if (checkSkeletonBoxCollision(p2Landmarks, box, true)) {
                            sfx.playHit();
                            triggerShake();
                            socket.emit("dodge_box_hit", {
                                roomCode: room.code,
                                playerId: player2.id,
                                boxId: box.id,
                            });
                        }
                    }
                }

                if (isHost) {
                    socket.emit("dodge_update_boxes", {
                        roomCode: room.code,
                        boxes: [box],
                    });
                }
            }

            animationFrameId = requestAnimationFrame(render);
        };

        render();

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [gameState, isHost, isModelsReady, myId, room.code, room.players]);

    const triggerShake = () => {
        setScreenShake(true);
        setTimeout(() => setScreenShake(false), 400);
    };

    const startGame = () => {
        socket.emit("dodge_start_game", room.code);
    };

    const player1 = room.players[0];
    const player2 = room.players[1];

    return (
        <div className={`flex flex-col h-screen w-screen bg-slate-950 text-white overflow-hidden font-sans select-none ${screenShake ? "animate-bounce" : ""}`}>
            <video ref={localVideoRef} autoPlay playsInline muted className="hidden" />
            <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />

            <header className="p-3 bg-slate-900/90 border-b border-cyan-500/30 flex justify-between items-center z-20 shadow-xl">
                <div className="flex items-center gap-3">
                    <span className="text-3xl animate-pulse">🔷</span>
                    <div>
                        <h1 className="text-xl font-black bg-gradient-to-r from-cyan-400 via-yellow-300 to-rose-500 bg-clip-text text-transparent">
                            HOLE IN THE WALL 3D
                        </h1>
                        <p className="text-xs text-cyan-400 font-bold tracking-wider">
                            {!isModelsReady ? "INITIALIZING VISION AI..." : `SPEED: ${gameState.speedMultiplier.toFixed(2)}x`}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-8 bg-slate-800/90 px-6 py-2 rounded-2xl border border-slate-700 shadow-inner">
                    {player1 && (
                        <div className="flex items-center gap-3">
                            <span className="font-black text-xs text-cyan-400 uppercase">{player1.name}:</span>
                            <span className="text-base font-black text-white">{gameState.scores[player1.id] || 0} PTS</span>
                            <span className="text-sm tracking-widest text-rose-500">{"❤️".repeat(gameState.lives[player1.id] ?? 3)}</span>
                        </div>
                    )}
                    {player2 && (
                        <>
                            <div className="h-6 w-px bg-slate-700" />
                            <div className="flex items-center gap-3">
                                <span className="font-black text-xs text-purple-400 uppercase">{player2.name}:</span>
                                <span className="text-base font-black text-white">{gameState.scores[player2.id] || 0} PTS</span>
                                <span className="text-sm tracking-widest text-rose-500">{"❤️".repeat(gameState.lives[player2.id] ?? 3)}</span>
                            </div>
                        </>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    {isHost && (gameState.status === "WAITING" || gameState.status === "GAME_OVER") && (
                        <button
                            onClick={startGame}
                            disabled={!isModelsReady}
                            className="bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 text-slate-950 font-black px-5 py-2.5 rounded-xl transition shadow-lg shadow-emerald-900/40 text-xs tracking-wider uppercase active:scale-95"
                        >
                            🚀 START GAME
                        </button>
                    )}
                    <button
                        onClick={() => socket.emit("return_lobby", room.code)}
                        className="bg-slate-800 hover:bg-slate-700 px-4 py-2.5 rounded-xl text-xs font-extrabold text-slate-300 transition border border-slate-700 uppercase"
                    >
                        Exit
                    </button>
                </div>
            </header>

            <main className="flex-1 relative flex items-center justify-center p-3 bg-slate-950 min-h-0">
                <div className="relative w-full h-full max-w-[1280px] max-h-[720px] aspect-video bg-black rounded-3xl border-4 border-cyan-500/40 overflow-hidden shadow-[0_0_50px_rgba(0,243,255,0.15)] flex items-center justify-center">

                    <canvas ref={mainCanvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="w-full h-full object-contain z-0" />

                    {gameState.status === "WAITING" && (
                        <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center z-30 p-6 text-center">
                            <h2 className="text-4xl font-black text-cyan-400 tracking-wider mb-2">FULL BODY VISIBILITY MODE</h2>
                            <p className="text-slate-400 text-sm max-w-md mb-6">
                                Stand back so your entire body is visible. Shapes will appear randomly across top, bottom, and side corners!
                            </p>
                        </div>
                    )}

                    {gameCountdown !== null && (
                        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center z-40">
                            <span className="text-3xl font-black text-cyan-400 tracking-widest uppercase mb-2">GET READY</span>
                            <span className="text-9xl font-black text-amber-400 drop-shadow-[0_0_35px_rgba(251,191,36,0.6)] animate-ping">
                                {gameCountdown}
                            </span>
                        </div>
                    )}

                    {gameState.status === "GAME_OVER" && (
                        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-lg flex flex-col items-center justify-center z-50 p-6 text-center">
                            <h2 className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-red-500 via-amber-400 to-rose-500 mb-4 tracking-wider">
                                GAME OVER
                            </h2>
                            <div className="bg-slate-900/90 border border-slate-700 rounded-2xl p-6 max-w-md w-full mb-6 shadow-2xl">
                                <h3 className="text-xs font-extrabold text-cyan-400 uppercase tracking-widest mb-4">Final Scoreboard</h3>
                                {room.players.map((p) => (
                                    <div key={p.id} className="flex justify-between items-center py-2.5 border-b border-slate-800 last:border-0">
                                        <span className="font-bold text-slate-200">{p.name}</span>
                                        <span className="font-black text-amber-400 text-xl">{gameState.scores[p.id] || 0} PTS</span>
                                    </div>
                                ))}
                            </div>
                            {isHost && (
                                <button
                                    onClick={startGame}
                                    className="bg-gradient-to-r from-emerald-400 to-teal-500 hover:from-emerald-500 hover:to-teal-600 text-slate-950 font-black px-10 py-4 rounded-2xl text-sm shadow-xl transition active:scale-95 tracking-wider uppercase"
                                >
                                    PLAY AGAIN 🔄
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
import { useEffect, useRef, useState } from "react";
import { socket } from "./socket";
import {
    PoseLandmarker,
    FilesetResolver,
    ImageSegmenter,
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

interface WallObstacle {
    id: string;
    z: number;           // 1.0 (far away) to 0.0 (foreground/player)
    speed: number;       // speed at which z decreases
    shape: "rectangle" | "circle" | "diamond";
    holeWidth: number;   // relative width fraction of lane
    holeHeight: number;  // relative height fraction of lane
}

interface GameState {
    status: "WAITING" | "COUNTDOWN" | "PLAYING" | "GAME_OVER";
    scores: Record<string, number>;
    lives: Record<string, number>;
    walls: WallObstacle[];
    round: number;
}

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const HALF_WIDTH = CANVAS_WIDTH / 2;

// Keypose skeleton connections (MediaPipe Pose 33 keypoints)
const POSE_CONNECTIONS = [
    [11, 12], // Shoulders
    [11, 13], [13, 15], // Left Arm
    [12, 14], [14, 16], // Right Arm
    [11, 23], [12, 24], [23, 24], // Torso
    [23, 25], [25, 27], // Left Leg
    [24, 26], [26, 28]  // Right Leg
];

export default function BoxDodgeGame({ room, myId }: Props) {
    const localVideoRef = useRef<HTMLVideoElement | null>(null);
    const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
    const mainCanvasRef = useRef<HTMLCanvasElement | null>(null);

    // Hidden offscreen processing canvases for segmentation blending
    const localMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const remoteMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);

    const pcRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);

    // Independent MediaPipe instances for each video stream
    const localPoseLandmarkerRef = useRef<PoseLandmarker | null>(null);
    const remotePoseLandmarkerRef = useRef<PoseLandmarker | null>(null);
    const localImageSegmenterRef = useRef<ImageSegmenter | null>(null);
    const remoteImageSegmenterRef = useRef<ImageSegmenter | null>(null);

    const [isModelsReady, setIsModelsReady] = useState<boolean>(false);

    const [gameState, setGameState] = useState<GameState>({
        status: "WAITING",
        scores: {},
        lives: {},
        walls: [],
        round: 1,
    });
    const [gameCountdown, setGameCountdown] = useState<number | null>(null);

    const localLandmarksRef = useRef<NormalizedLandmark[] | null>(null);
    const remoteLandmarksRef = useRef<NormalizedLandmark[] | null>(null);

    const isHost = room.players.length > 0 && room.players[0].id === myId;
    const isSinglePlayer = room.players.length === 1;

    // 1. Initialize Dual MediaPipe Tasks (Pose + Segmenter for both Streams)
    useEffect(() => {
        let isMounted = true;

        async function loadMediaPipeTasks() {
            try {
                const vision = await FilesetResolver.forVisionTasks(
                    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
                );

                // Local Video Pipeline
                const localPose = await PoseLandmarker.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath:
                            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
                        delegate: "GPU",
                    },
                    runningMode: "VIDEO",
                    numPoses: 1,
                });

                const localSeg = await ImageSegmenter.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath:
                            "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
                        delegate: "GPU",
                    },
                    runningMode: "VIDEO",
                    outputCategoryMask: true,
                    outputConfidenceMasks: false,
                });

                // Remote Video Pipeline
                const remotePose = await PoseLandmarker.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath:
                            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
                        delegate: "GPU",
                    },
                    runningMode: "VIDEO",
                    numPoses: 1,
                });

                const remoteSeg = await ImageSegmenter.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath:
                            "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
                        delegate: "GPU",
                    },
                    runningMode: "VIDEO",
                    outputCategoryMask: true,
                    outputConfidenceMasks: false,
                });

                if (isMounted) {
                    localPoseLandmarkerRef.current = localPose;
                    localImageSegmenterRef.current = localSeg;
                    remotePoseLandmarkerRef.current = remotePose;
                    remoteImageSegmenterRef.current = remoteSeg;
                    setIsModelsReady(true);
                }
            } catch (err) {
                console.error("Failed to initialize dual MediaPipe instances:", err);
            }
        }

        loadMediaPipeTasks();

        return () => {
            isMounted = false;
            if (localPoseLandmarkerRef.current) localPoseLandmarkerRef.current.close();
            if (localImageSegmenterRef.current) localImageSegmenterRef.current.close();
            if (remotePoseLandmarkerRef.current) remotePoseLandmarkerRef.current.close();
            if (remoteImageSegmenterRef.current) remoteImageSegmenterRef.current.close();
        };
    }, []);

    // 2. WebRTC Peer Connection Setup
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
                        console.error("Error handling WebRTC offer:", err);
                    }
                };

                const handleAnswer = async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
                    if (!pcRef.current) return;
                    try {
                        if (pcRef.current.signalingState === "have-local-offer") {
                            await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
                        }
                    } catch (err) {
                        console.error("Error handling WebRTC answer:", err);
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

    // 3. Socket Listeners for Game Sync
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

    // Helper: Draw Aspect Cover for Source Canvas/Video
    const drawAspectCover = (
        ctx: CanvasRenderingContext2D,
        source: HTMLVideoElement | HTMLCanvasElement,
        targetWidth: number,
        targetHeight: number,
        offsetX = 0,
        offsetY = 0
    ) => {
        const srcWidth = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
        const srcHeight = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
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

        ctx.drawImage(source, dx, dy, drawWidth, drawHeight);
    };

    // Helper: Extract Player Cutout (Inverted mask: person visible, background removed)
    const renderCutoutToCanvas = (
        video: HTMLVideoElement,
        segmenter: ImageSegmenter | null,
        offscreenCanvas: HTMLCanvasElement
    ): HTMLCanvasElement | null => {
        if (!segmenter || !isModelsReady || video.readyState < 2) {
            return null;
        }

        const width = video.videoWidth;
        const height = video.videoHeight;
        if (!width || !height) return null;

        offscreenCanvas.width = width;
        offscreenCanvas.height = height;
        const offCtx = offscreenCanvas.getContext("2d");
        if (!offCtx) return null;

        try {
            const result = segmenter.segmentForVideo(video, performance.now());
            if (!result || !result.categoryMask) return null;

            const maskBuffer = result.categoryMask.getAsUint8Array();

            offCtx.drawImage(video, 0, 0, width, height);
            const frameData = offCtx.getImageData(0, 0, width, height);
            const imgData = offCtx.createImageData(width, height);

            for (let i = 0; i < maskBuffer.length; i++) {
                const isPerson = maskBuffer[i] === 0;
                const pixelIdx = i * 4;

                imgData.data[pixelIdx] = frameData.data[pixelIdx];
                imgData.data[pixelIdx + 1] = frameData.data[pixelIdx + 1];
                imgData.data[pixelIdx + 2] = frameData.data[pixelIdx + 2];
                imgData.data[pixelIdx + 3] = isPerson ? frameData.data[pixelIdx + 3] : 0;
            }

            offCtx.putImageData(imgData, 0, 0);
            return offscreenCanvas;
        } catch (e) {
            return null;
        }
    };

    // Helper: Draw Sci-Fi Neon Floor Grid
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
        grad.addColorStop(0, "#0b0f19");
        grad.addColorStop(1, "#1e1b4b");
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, w, h);

        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.25;

        const horizonY = y + h * 0.4;
        const numLines = 12;

        for (let i = 0; i <= numLines; i++) {
            const gx = x + (w / numLines) * i;
            ctx.beginPath();
            ctx.moveTo(x + w / 2, horizonY);
            ctx.lineTo(gx, y + h);
            ctx.stroke();
        }

        for (let i = 1; i <= 8; i++) {
            const gy = horizonY + Math.pow(i / 8, 2) * (h * 0.6);
            ctx.beginPath();
            ctx.moveTo(x, gy);
            ctx.lineTo(x + w, gy);
            ctx.stroke();
        }

        ctx.restore();
    };

    // Helper: Draw Skeleton Overlay
    const drawSkeleton = (
        ctx: CanvasRenderingContext2D,
        landmarks: NormalizedLandmark[],
        laneWidth: number,
        laneHeight: number,
        offsetX: number,
        isMirrored: boolean
    ) => {
        ctx.save();

        ctx.strokeStyle = "#00ffcc";
        ctx.lineWidth = 5;
        ctx.lineCap = "round";

        POSE_CONNECTIONS.forEach(([i, j]) => {
            const p1 = landmarks[i];
            const p2 = landmarks[j];

            if (p1 && p2 && (p1.visibility ?? 1) > 0.5 && (p2.visibility ?? 1) > 0.5) {
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
            if (p && (p.visibility ?? 1) > 0.5) {
                const x = offsetX + (isMirrored ? (1 - p.x) * laneWidth : p.x * laneWidth);
                const y = p.y * laneHeight;

                ctx.fillStyle = "#ff0055";
                ctx.beginPath();
                ctx.arc(x, y, 6, 0, Math.PI * 2);
                ctx.fill();

                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        });

        ctx.restore();
    };

    // Helper: Check if Skeleton Collides with Wall (Hits solid parts outside the hole)
    const checkSkeletonWallCollision = (
        landmarks: NormalizedLandmark[],
        wall: WallObstacle,
        isMirrored: boolean
    ): boolean => {
        // Only register collision when the wall gets close to the foreground (z <= 0.35)
        if (wall.z > 0.35) return false;

        const scale = 0.2 + (1.0 - wall.z) * 0.8;
        const hW = wall.holeWidth * scale;
        const hH = wall.holeHeight * scale;

        const centerX = 0.5;
        const centerY = 0.45;

        // Check key body joints (Head, Shoulders, Elbows, Wrists, Hips)
        const keyJointIndices = [0, 11, 12, 13, 14, 15, 16, 23, 24];

        return keyJointIndices.some((idx) => {
            const p = landmarks[idx];
            if (!p || (p.visibility ?? 1) <= 0.4) return false;

            const px = isMirrored ? 1 - p.x : p.x;
            const py = p.y;

            let isInsideHole = false;

            if (wall.shape === "rectangle") {
                const left = centerX - hW / 2;
                const right = centerX + hW / 2;
                const top = centerY - hH / 2;
                const bottom = centerY + hH / 2;
                isInsideHole = px >= left && px <= right && py >= top && py <= bottom;
            } else if (wall.shape === "circle") {
                const radius = hW / 2;
                const dx = px - centerX;
                const dy = py - centerY;
                isInsideHole = Math.sqrt(dx * dx + dy * dy) <= radius;
            } else if (wall.shape === "diamond") {
                const dx = Math.abs(px - centerX);
                const dy = Math.abs(py - centerY);
                isInsideHole = dx / (hW / 2) + dy / (hH / 2) <= 1.0;
            }

            // If the joint is NOT inside the hole, it hit the solid wall!
            return !isInsideHole;
        });
    };

    // 4. Main Loop: Dual-Stream MediaPipe Processing & Composition
    useEffect(() => {
        let animationFrameId: number;
        let lastEmitTime = 0;

        const render = () => {
            const canvas = mainCanvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            if (!localMaskCanvasRef.current) {
                localMaskCanvasRef.current = document.createElement("canvas");
            }
            if (!remoteMaskCanvasRef.current) {
                remoteMaskCanvasRef.current = document.createElement("canvas");
            }

            ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

            const player1 = room.players[0];
            const player2 = room.players[1];

            // --- 1. Detect Local Stream Pose ---
            if (localPoseLandmarkerRef.current && isModelsReady && localVideoRef.current && localVideoRef.current.readyState >= 2) {
                try {
                    const poseResult = localPoseLandmarkerRef.current.detectForVideo(
                        localVideoRef.current,
                        performance.now()
                    );

                    if (poseResult.landmarks && poseResult.landmarks.length > 0) {
                        localLandmarksRef.current = poseResult.landmarks[0];
                    } else {
                        localLandmarksRef.current = null;
                    }

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
                    // Skip frame on error
                }
            }

            // --- 2. Detect Remote Stream Pose directly if missing broadcasted pose ---
            if (remotePoseLandmarkerRef.current && isModelsReady && remoteVideoRef.current && remoteVideoRef.current.readyState >= 2) {
                try {
                    const remotePoseResult = remotePoseLandmarkerRef.current.detectForVideo(
                        remoteVideoRef.current,
                        performance.now()
                    );

                    if (remotePoseResult.landmarks && remotePoseResult.landmarks.length > 0) {
                        if (player2 && player2.id !== myId) {
                            remoteLandmarksRef.current = remotePoseResult.landmarks[0];
                        } else if (player1 && player1.id !== myId) {
                            remoteLandmarksRef.current = remotePoseResult.landmarks[0];
                        }
                    }
                } catch (e) {
                    // Skip frame on error
                }
            }

            // --- Draw Lane 1 (Player 1) ---
            drawCustomBackground(ctx, 0, 0, HALF_WIDTH, CANVAS_HEIGHT, "#38bdf8");

            const isP1Local = player1?.id === myId;
            const p1Video = isP1Local ? localVideoRef.current : remoteVideoRef.current;
            const p1Segmenter = isP1Local ? localImageSegmenterRef.current : remoteImageSegmenterRef.current;
            const p1MaskCanvas = isP1Local ? localMaskCanvasRef.current : remoteMaskCanvasRef.current;

            if (p1Video && p1Video.readyState >= 2) {
                const cutoutCanvas = renderCutoutToCanvas(p1Video, p1Segmenter, p1MaskCanvas);
                ctx.save();
                ctx.translate(HALF_WIDTH, 0);
                ctx.scale(-1, 1);

                if (cutoutCanvas) {
                    drawAspectCover(ctx, cutoutCanvas, HALF_WIDTH, CANVAS_HEIGHT);
                } else {
                    drawAspectCover(ctx, p1Video, HALF_WIDTH, CANVAS_HEIGHT);
                }
                ctx.restore();
            }

            const p1Landmarks = isP1Local ? localLandmarksRef.current : remoteLandmarksRef.current;
            if (p1Landmarks) {
                drawSkeleton(ctx, p1Landmarks, HALF_WIDTH, CANVAS_HEIGHT, 0, true);
            }

            // --- Draw Lane 2 (Player 2) ---
            drawCustomBackground(ctx, HALF_WIDTH, 0, HALF_WIDTH, CANVAS_HEIGHT, "#a855f7");

            if (player2) {
                const isP2Local = player2.id === myId;
                const p2Video = isP2Local ? localVideoRef.current : remoteVideoRef.current;
                const p2Segmenter = isP2Local ? localImageSegmenterRef.current : remoteImageSegmenterRef.current;
                const p2MaskCanvas = isP2Local ? localMaskCanvasRef.current : remoteMaskCanvasRef.current;

                if (p2Video && p2Video.readyState >= 2) {
                    const cutoutCanvas2 = renderCutoutToCanvas(p2Video, p2Segmenter, p2MaskCanvas);
                    ctx.save();
                    ctx.translate(CANVAS_WIDTH, 0);
                    ctx.scale(-1, 1);

                    if (cutoutCanvas2) {
                        drawAspectCover(ctx, cutoutCanvas2, HALF_WIDTH, CANVAS_HEIGHT);
                    } else {
                        drawAspectCover(ctx, p2Video, HALF_WIDTH, CANVAS_HEIGHT);
                    }
                    ctx.restore();
                }

                const p2Landmarks = isP2Local ? localLandmarksRef.current : remoteLandmarksRef.current;
                if (p2Landmarks) {
                    drawSkeleton(ctx, p2Landmarks, HALF_WIDTH, CANVAS_HEIGHT, HALF_WIDTH, true);
                }
            }

            // --- Divider Line ---
            ctx.strokeStyle = "#38bdf8";
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(HALF_WIDTH, 0);
            ctx.lineTo(HALF_WIDTH, CANVAS_HEIGHT);
            ctx.stroke();

            // --- Update & Render Incoming 3D Obstacle Walls with Hole ---
            if (gameState.status === "PLAYING" && gameState.walls && gameState.walls.length > 0) {
                gameState.walls.forEach((wall) => {
                    if (isHost) {
                        wall.z -= wall.speed;
                        if (wall.z <= 0.0) {
                            wall.z = 1.0;
                            const shapes: ("rectangle" | "circle" | "diamond")[] = ["rectangle", "circle", "diamond"];
                            wall.shape = shapes[Math.floor(Math.random() * shapes.length)];
                            wall.holeWidth = 0.3 + Math.random() * 0.15;
                            wall.holeHeight = 0.35 + Math.random() * 0.15;
                        }
                    }

                    const scale = 0.2 + (1.0 - wall.z) * 0.8;
                    const hW = wall.holeWidth * HALF_WIDTH * scale;
                    const hH = wall.holeHeight * CANVAS_HEIGHT * scale;
                    const centerXLane1 = HALF_WIDTH * 0.5;
                    const centerYLane1 = CANVAS_HEIGHT * 0.45;

                    // Render Wall for Lane 1
                    ctx.save();
                    ctx.fillStyle = wall.z <= 0.35 ? "rgba(239, 68, 68, 0.75)" : "rgba(30, 41, 59, 0.75)";
                    ctx.fillRect(0, 0, HALF_WIDTH, CANVAS_HEIGHT);

                    ctx.save();
                    ctx.beginPath();
                    if (wall.shape === "rectangle") {
                        ctx.rect(centerXLane1 - hW / 2, centerYLane1 - hH / 2, hW, hH);
                    } else if (wall.shape === "circle") {
                        ctx.arc(centerXLane1, centerYLane1, hW / 2, 0, Math.PI * 2);
                    } else if (wall.shape === "diamond") {
                        ctx.moveTo(centerXLane1, centerYLane1 - hH / 2);
                        ctx.lineTo(centerXLane1 + hW / 2, centerYLane1);
                        ctx.lineTo(centerXLane1, centerYLane1 + hH / 2);
                        ctx.lineTo(centerXLane1 - hW / 2, centerYLane1);
                        ctx.closePath();
                    }
                    ctx.clip("nonzero");
                    ctx.clearRect(0, 0, HALF_WIDTH, CANVAS_HEIGHT);
                    ctx.restore();

                    // Outline hole
                    ctx.strokeStyle = wall.z <= 0.35 ? "#fca5a5" : "#38bdf8";
                    ctx.lineWidth = 6;
                    ctx.beginPath();
                    if (wall.shape === "rectangle") {
                        ctx.strokeRect(centerXLane1 - hW / 2, centerYLane1 - hH / 2, hW, hH);
                    } else if (wall.shape === "circle") {
                        ctx.arc(centerXLane1, centerYLane1, hW / 2, 0, Math.PI * 2);
                    } else if (wall.shape === "diamond") {
                        ctx.moveTo(centerXLane1, centerYLane1 - hH / 2);
                        ctx.lineTo(centerXLane1 + hW / 2, centerYLane1);
                        ctx.lineTo(centerXLane1, centerYLane1 + hH / 2);
                        ctx.lineTo(centerXLane1 - hW / 2, centerYLane1);
                        ctx.closePath();
                    }
                    ctx.stroke();

                    if (wall.z <= 0.35) {
                        ctx.fillStyle = "#ffffff";
                        ctx.font = "bold 18px sans-serif";
                        ctx.textAlign = "center";
                        ctx.fillText(`SQUEEZE THROUGH (${wall.shape.toUpperCase()})!`, centerXLane1, centerYLane1 - hH / 2 - 12);
                    }
                    ctx.restore();

                    // Render Wall for Lane 2
                    if (player2) {
                        const centerXLane2 = HALF_WIDTH + HALF_WIDTH * 0.5;

                        ctx.save();
                        ctx.fillStyle = wall.z <= 0.35 ? "rgba(239, 68, 68, 0.75)" : "rgba(30, 41, 59, 0.75)";
                        ctx.fillRect(HALF_WIDTH, 0, HALF_WIDTH, CANVAS_HEIGHT);

                        ctx.save();
                        ctx.beginPath();
                        if (wall.shape === "rectangle") {
                            ctx.rect(centerXLane2 - hW / 2, centerYLane1 - hH / 2, hW, hH);
                        } else if (wall.shape === "circle") {
                            ctx.arc(centerXLane2, centerYLane1, hW / 2, 0, Math.PI * 2);
                        } else if (wall.shape === "diamond") {
                            ctx.moveTo(centerXLane2, centerYLane1 - hH / 2);
                            ctx.lineTo(centerXLane2 + hW / 2, centerYLane1);
                            ctx.lineTo(centerXLane2, centerYLane1 + hH / 2);
                            ctx.lineTo(centerXLane2 - hW / 2, centerYLane1);
                            ctx.closePath();
                        }
                        ctx.clip("nonzero");
                        ctx.clearRect(HALF_WIDTH, 0, HALF_WIDTH, CANVAS_HEIGHT);
                        ctx.restore();

                        ctx.strokeStyle = wall.z <= 0.35 ? "#fca5a5" : "#a855f7";
                        ctx.lineWidth = 6;
                        ctx.beginPath();
                        if (wall.shape === "rectangle") {
                            ctx.strokeRect(centerXLane2 - hW / 2, centerYLane1 - hH / 2, hW, hH);
                        } else if (wall.shape === "circle") {
                            ctx.arc(centerXLane2, centerYLane1, hW / 2, 0, Math.PI * 2);
                        } else if (wall.shape === "diamond") {
                            ctx.moveTo(centerXLane2, centerYLane1 - hH / 2);
                            ctx.lineTo(centerXLane2 + hW / 2, centerYLane1);
                            ctx.lineTo(centerXLane2, centerYLane1 + hH / 2);
                            ctx.lineTo(centerXLane2 - hW / 2, centerYLane1);
                            ctx.closePath();
                        }
                        ctx.stroke();

                        if (wall.z <= 0.35) {
                            ctx.fillStyle = "#ffffff";
                            ctx.font = "bold 18px sans-serif";
                            ctx.textAlign = "center";
                            ctx.fillText(`SQUEEZE THROUGH (${wall.shape.toUpperCase()})!`, centerXLane2, centerYLane1 - hH / 2 - 12);
                        }
                        ctx.restore();
                    }
                });

                // Host Wall Collision Detection Loop
                if (isHost) {
                    gameState.walls.forEach((wall) => {
                        if (wall.z <= 0.35) {
                            if (p1Landmarks && player1) {
                                if (checkSkeletonWallCollision(p1Landmarks, wall, true)) {
                                    socket.emit("dodge_wall_hit", {
                                        roomCode: room.code,
                                        playerId: player1.id,
                                        wallId: wall.id,
                                    });
                                }
                            }
                            const p2Landmarks = player2?.id === myId ? localLandmarksRef.current : remoteLandmarksRef.current;
                            if (p2Landmarks && player2) {
                                if (checkSkeletonWallCollision(p2Landmarks, wall, true)) {
                                    socket.emit("dodge_wall_hit", {
                                        roomCode: room.code,
                                        playerId: player2.id,
                                        wallId: wall.id,
                                    });
                                }
                            }
                        }
                    });

                    socket.emit("dodge_update_walls", {
                        roomCode: room.code,
                        walls: gameState.walls,
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

    const startGame = () => {
        socket.emit("dodge_start_game", room.code);
    };

    const player1 = room.players[0];
    const player2 = room.players[1];

    return (
        <div className="flex flex-col h-screen w-screen bg-slate-950 text-white overflow-hidden font-sans select-none">
            <video ref={localVideoRef} autoPlay playsInline muted className="hidden" />
            <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />

            {/* Header HUD */}
            <header className="p-3 bg-slate-900/90 border-b border-sky-500/30 flex justify-between items-center z-20 shadow-xl">
                <div className="flex items-center gap-3">
                    <span className="text-2xl animate-bounce">🧱</span>
                    <div>
                        <h1 className="text-lg font-black bg-gradient-to-r from-red-400 via-amber-300 to-sky-400 bg-clip-text text-transparent">
                            HUMAN TETRIS WALL DODGE
                        </h1>
                        <p className="text-xs text-sky-400 font-medium">
                            {!isModelsReady ? "Loading MediaPipe Vision Models..." : `Round ${gameState.round}`}
                        </p>
                    </div>
                </div>

                {/* Scoreboard */}
                <div className="flex items-center gap-6 bg-slate-800/80 px-5 py-2 rounded-2xl border border-slate-700 shadow-inner">
                    {player1 && (
                        <div className="flex items-center gap-2">
                            <span className="font-extrabold text-xs text-amber-400">{player1.name}:</span>
                            <span className="text-sm font-black text-white">{gameState.scores[player1.id] || 0} pts</span>
                            <span className="text-xs text-rose-400">{"❤️".repeat(gameState.lives[player1.id] ?? 3)}</span>
                        </div>
                    )}
                    {player2 && (
                        <>
                            <div className="h-4 w-px bg-slate-600" />
                            <div className="flex items-center gap-2">
                                <span className="font-extrabold text-xs text-cyan-400">{player2.name}:</span>
                                <span className="text-sm font-black text-white">{gameState.scores[player2.id] || 0} pts</span>
                                <span className="text-xs text-rose-400">{"❤️".repeat(gameState.lives[player2.id] ?? 3)}</span>
                            </div>
                        </>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {isHost && (gameState.status === "WAITING" || gameState.status === "GAME_OVER") && (
                        <button
                            onClick={startGame}
                            disabled={!isModelsReady}
                            className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-black px-4 py-2 rounded-xl transition shadow-lg shadow-emerald-900/40 text-xs active:scale-95"
                        >
                            🚀 START GAME
                        </button>
                    )}
                    <button
                        onClick={() => socket.emit("return_lobby", room.code)}
                        className="bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-xl text-xs font-bold text-slate-300 transition border border-slate-700"
                    >
                        Exit
                    </button>
                </div>
            </header>

            {/* Game Canvas Container */}
            <main className="flex-1 relative flex items-center justify-center p-2 bg-slate-950 min-h-0">
                <div className="relative w-full h-full max-w-[1280px] max-h-[720px] aspect-video bg-black rounded-3xl border-4 border-rose-500/30 overflow-hidden shadow-2xl flex items-center justify-center">

                    {/* Main Game Render Canvas */}
                    <canvas ref={mainCanvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="w-full h-full object-contain z-0" />

                    {/* Countdown Overlay */}
                    {gameCountdown !== null && (
                        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center z-30">
                            <span className="text-2xl font-black text-rose-400 tracking-widest uppercase mb-2">Get Ready to Squeeze!</span>
                            <span className="text-9xl font-black text-amber-400 drop-shadow-[0_10px_10px_rgba(0,0,0,0.8)] animate-bounce">
                                {gameCountdown}
                            </span>
                        </div>
                    )}

                    {/* Game Over Overlay */}
                    {gameState.status === "GAME_OVER" && (
                        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center z-40 p-6 text-center">
                            <h2 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-red-500 via-amber-400 to-yellow-500 mb-4">
                                GAME OVER
                            </h2>
                            <div className="bg-slate-900/90 border border-purple-500/30 rounded-2xl p-6 max-w-md w-full mb-6 shadow-2xl">
                                <h3 className="text-xs font-bold text-sky-400 uppercase tracking-widest mb-4">Final Leaderboard</h3>
                                {room.players.map((p) => (
                                    <div key={p.id} className="flex justify-between items-center py-2 border-b border-slate-800 last:border-0">
                                        <span className="font-bold text-slate-200">{p.name}</span>
                                        <span className="font-black text-amber-400 text-lg">{gameState.scores[p.id] || 0} pts</span>
                                    </div>
                                ))}
                            </div>
                            {isHost && (
                                <button
                                    onClick={startGame}
                                    className="bg-gradient-to-r from-emerald-400 to-teal-500 hover:from-emerald-500 hover:to-teal-600 text-slate-950 font-black px-8 py-3 rounded-2xl text-sm shadow-xl transition active:scale-95"
                                >
                                    Play Again 🔄
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
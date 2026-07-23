import { useEffect, useRef, useState } from "react";
import { socket } from "./socket";

interface Props {
    roomCode: string;
    opponentName: string;
}

const peerConnectionConfig: RTCConfiguration = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
    ],
};

export default function VideoCall({ roomCode, opponentName }: Props) {
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);

    const [isAudioMuted, setIsAudioMuted] = useState(false);
    const [isVideoOff, setIsVideoOff] = useState(false);
    const [isConnected, setIsConnected] = useState(false);

    // Floating Widget Layout & Drag States
    const [isMinimized, setIsMinimized] = useState(false);
    const [dockPosition, setDockPosition] = useState<"free" | "top-right" | "top-left" | "bottom-right">("top-right");
    const [position, setPosition] = useState<{ x: number; y: number }>({ x: 20, y: 20 });
    const [isDragging, setIsDragging] = useState(false);
    const dragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

    useEffect(() => {
        let isMounted = true;

        async function initWebRTC() {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                localStreamRef.current = stream;

                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                }

                const pc = new RTCPeerConnection(peerConnectionConfig);
                pcRef.current = pc;

                stream.getTracks().forEach((track) => {
                    pc.addTrack(track, stream);
                });

                pc.ontrack = (event) => {
                    if (remoteVideoRef.current && event.streams[0]) {
                        remoteVideoRef.current.srcObject = event.streams[0];
                        if (isMounted) setIsConnected(true);
                    }
                };

                pc.onicecandidate = (e) => {
                    if (e.candidate) {
                        socket.emit("webrtc_ice_candidate", { roomCode, candidate: e.candidate });
                    }
                };

                pc.oniceconnectionstatechange = () => {
                    if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
                        if (isMounted) setIsConnected(true);
                    }
                };

                const handleOffer = async ({ offer }: { offer: RTCSessionDescriptionInit; senderId: string }) => {
                    if (!pcRef.current) return;
                    try {
                        await pcRef.current.setRemoteDescription(new RTCSessionDescription(offer));
                        const answer = await pcRef.current.createAnswer();
                        await pcRef.current.setLocalDescription(answer);
                        socket.emit("webrtc_answer", { roomCode, answer });
                    } catch (err) {
                        console.error("Error handling Offer:", err);
                    }
                };

                const handleAnswer = async ({ answer }: { answer: RTCSessionDescriptionInit; senderId: string }) => {
                    if (!pcRef.current) return;
                    try {
                        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
                    } catch (err) {
                        console.error("Error handling Answer:", err);
                    }
                };

                const handleCandidate = async ({ candidate }: { candidate: RTCIceCandidateInit; senderId: string }) => {
                    if (!pcRef.current) return;
                    try {
                        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
                    } catch (err) {
                        console.error("Error adding ICE candidate:", err);
                    }
                };

                socket.on("webrtc_offer", handleOffer);
                socket.on("webrtc_answer", handleAnswer);
                socket.on("webrtc_ice_candidate", handleCandidate);

                socket.emit("webrtc_ready", roomCode);

                socket.on("start_webrtc_offer", async () => {
                    if (!pcRef.current) return;
                    try {
                        const offer = await pcRef.current.createOffer();
                        await pcRef.current.setLocalDescription(offer);
                        socket.emit("webrtc_offer", { roomCode, offer });
                    } catch (err) {
                        console.error("Error creating Offer:", err);
                    }
                });

            } catch (err) {
                console.error("Camera/Microphone access error:", err);
            }
        }

        initWebRTC();

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
    }, [roomCode]);

    const toggleAudio = () => {
        if (localStreamRef.current) {
            const track = localStreamRef.current.getAudioTracks()[0];
            if (track) {
                track.enabled = !track.enabled;
                setIsAudioMuted(!track.enabled);
            }
        }
    };

    const toggleVideo = () => {
        if (localStreamRef.current) {
            const track = localStreamRef.current.getVideoTracks()[0];
            if (track) {
                track.enabled = !track.enabled;
                setIsVideoOff(!track.enabled);
            }
        }
    };

    // Drag-and-Drop Handlers
    const handleStartDrag = (clientX: number, clientY: number) => {
        setIsDragging(true);
        setDockPosition("free");
        dragOffset.current = {
            x: clientX - position.x,
            y: clientY - position.y,
        };
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        handleStartDrag(e.clientX, e.clientY);
    };

    const handleTouchStart = (e: React.TouchEvent) => {
        const touch = e.touches[0];
        handleStartDrag(touch.clientX, touch.clientY);
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            setPosition({
                x: Math.max(10, Math.min(window.innerWidth - 260, e.clientX - dragOffset.current.x)),
                y: Math.max(10, Math.min(window.innerHeight - 150, e.clientY - dragOffset.current.y)),
            });
        };

        const handleTouchMove = (e: TouchEvent) => {
            if (!isDragging) return;
            const touch = e.touches[0];
            setPosition({
                x: Math.max(10, Math.min(window.innerWidth - 260, touch.clientX - dragOffset.current.x)),
                y: Math.max(10, Math.min(window.innerHeight - 150, touch.clientY - dragOffset.current.y)),
            });
        };

        const handleMouseUp = () => setIsDragging(false);

        if (isDragging) {
            window.addEventListener("mousemove", handleMouseMove);
            window.addEventListener("mouseup", handleMouseUp);
            window.addEventListener("touchmove", handleTouchMove);
            window.addEventListener("touchend", handleMouseUp);
        }

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
            window.removeEventListener("touchmove", handleTouchMove);
            window.removeEventListener("touchend", handleMouseUp);
        };
    }, [isDragging]);

    const getPositionStyle = () => {
        if (dockPosition === "top-right") return { top: "16px", right: "16px" };
        if (dockPosition === "top-left") return { top: "16px", left: "16px" };
        if (dockPosition === "bottom-right") return { bottom: "16px", right: "16px" };
        return { top: `${position.y}px`, left: `${position.x}px` };
    };

    return (
        <div
            style={getPositionStyle()}
            className="fixed z-50 transition-shadow duration-200"
        >
            <div className="bg-slate-800/90 backdrop-blur-md border border-slate-700 rounded-2xl shadow-2xl overflow-hidden w-64 flex flex-col">
                {/* Drag Handle & Header Controls */}
                <div
                    onMouseDown={handleMouseDown}
                    onTouchStart={handleTouchStart}
                    className="cursor-grab active:cursor-grabbing bg-slate-900/80 px-3 py-2 flex items-center justify-between border-b border-slate-700/60 select-none"
                >
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">⋮⋮</span>
                        <div className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`}></div>
                        <span className="text-xs font-semibold text-slate-200">
                            {isConnected ? "Call Active" : "Connecting..."}
                        </span>
                    </div>

                    <div className="flex items-center gap-1">
                        {/* Quick Snap Positions */}
                        <button
                            onClick={() => setDockPosition(dockPosition === "top-right" ? "bottom-right" : "top-right")}
                            className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded transition"
                            title="Lock / Dock Alignment"
                        >
                            📌
                        </button>
                        {/* Minimize / Expand Toggle */}
                        <button
                            onClick={() => setIsMinimized(!isMinimized)}
                            className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded transition"
                        >
                            {isMinimized ? "🟩" : "➖"}
                        </button>
                    </div>
                </div>

                {!isMinimized && (
                    <div className="p-2 space-y-2">
                        {/* Video Streams Grid */}
                        <div className="grid grid-cols-2 gap-2">
                            {/* Remote Video */}
                            <div className="relative rounded-lg overflow-hidden bg-slate-950 border border-slate-700 aspect-video">
                                <video
                                    ref={remoteVideoRef}
                                    autoPlay
                                    playsInline
                                    className="absolute inset-0 w-full h-full object-cover"
                                />
                                <div className="absolute bottom-1 left-1 bg-black/60 px-1 py-0.5 rounded text-[9px] text-slate-200 truncate max-w-[90%]">
                                    {isConnected ? opponentName : "Connecting..."}
                                </div>
                            </div>

                            {/* Local Video */}
                            <div className="relative rounded-lg overflow-hidden bg-slate-950 border border-slate-700 aspect-video">
                                <video
                                    ref={localVideoRef}
                                    autoPlay
                                    playsInline
                                    muted
                                    className="absolute inset-0 w-full h-full object-cover -scale-x-100"
                                />
                                <div className="absolute bottom-1 left-1 bg-black/60 px-1 py-0.5 rounded text-[9px] text-slate-200">
                                    You
                                </div>
                            </div>
                        </div>

                        {/* Control Buttons */}
                        <div className="grid grid-cols-2 gap-1.5 pt-1">
                            <button
                                onClick={toggleAudio}
                                className={`py-1.5 text-xs rounded-lg font-medium transition-colors text-white ${isAudioMuted ? "bg-red-500 hover:bg-red-600" : "bg-slate-700 hover:bg-slate-600"
                                    }`}
                            >
                                {isAudioMuted ? "🔇 Muted" : "🎤 Mic On"}
                            </button>
                            <button
                                onClick={toggleVideo}
                                className={`py-1.5 text-xs rounded-lg font-medium transition-colors text-white ${isVideoOff ? "bg-red-500 hover:bg-red-600" : "bg-slate-700 hover:bg-slate-600"
                                    }`}
                            >
                                {isVideoOff ? "🚫 Cam Off" : "📷 Cam On"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
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

    useEffect(() => {
        let isMounted = true;

        async function initWebRTC() {
            try {
                console.log("🎥 [Client] Requesting Camera & Microphone...");
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                localStreamRef.current = stream;

                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                }

                console.log("🛠️ [Client] Initializing Peer Connection...");
                const pc = new RTCPeerConnection(peerConnectionConfig);
                pcRef.current = pc;

                stream.getTracks().forEach((track) => {
                    console.log(`➕ [Client] Adding track: ${track.kind}`);
                    pc.addTrack(track, stream);
                });

                pc.ontrack = (event) => {
                    console.log("📡 [Client] Received Remote Track!", event.streams);
                    if (remoteVideoRef.current && event.streams[0]) {
                        remoteVideoRef.current.srcObject = event.streams[0];
                        if (isMounted) setIsConnected(true);
                    }
                };

                pc.onicecandidate = (e) => {
                    if (e.candidate) {
                        console.log("🧊 [Client] Sending ICE Candidate to server...");
                        socket.emit("webrtc_ice_candidate", { roomCode, candidate: e.candidate });
                    }
                };

                pc.oniceconnectionstatechange = () => {
                    console.log(`⚡ [Client] ICE Connection State Changed: ${pc.iceConnectionState}`);
                    if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
                        if (isMounted) setIsConnected(true);
                    }
                };

                // --- SOCKET EVENT HANDLERS ---

                const handleOffer = async ({ offer, senderId }: { offer: RTCSessionDescriptionInit; senderId: string }) => {
                    console.log(`📩 [Client] Received WebRTC OFFER from ${senderId}`);
                    if (!pcRef.current) return;
                    try {
                        await pcRef.current.setRemoteDescription(new RTCSessionDescription(offer));
                        const answer = await pcRef.current.createAnswer();
                        await pcRef.current.setLocalDescription(answer);
                        console.log("📤 [Client] Sending WebRTC ANSWER back to server...");
                        socket.emit("webrtc_answer", { roomCode, answer });
                    } catch (err) {
                        console.error("❌ [Client] Error handling Offer:", err);
                    }
                };

                const handleAnswer = async ({ answer, senderId }: { answer: RTCSessionDescriptionInit; senderId: string }) => {
                    console.log(`📩 [Client] Received WebRTC ANSWER from ${senderId}`);
                    if (!pcRef.current) return;
                    try {
                        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
                        console.log("✅ [Client] Remote description set successfully from answer!");
                    } catch (err) {
                        console.error("❌ [Client] Error handling Answer:", err);
                    }
                };

                const handleCandidate = async ({ candidate, senderId }: { candidate: RTCIceCandidateInit; senderId: string }) => {
                    console.log(`📩 [Client] Received ICE Candidate from ${senderId}`);
                    if (!pcRef.current) return;
                    try {
                        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
                    } catch (err) {
                        console.error("❌ [Client] Error adding ICE candidate:", err);
                    }
                };

                socket.on("webrtc_offer", handleOffer);
                socket.on("webrtc_answer", handleAnswer);
                socket.on("webrtc_ice_candidate", handleCandidate);

                // Tell server this client is ready to exchange WebRTC signals
                console.log("🚀 [Client] Emitting webrtc_ready...");
                socket.emit("webrtc_ready", roomCode);

                // Triggered only on Player 1 when both players are connected
                socket.on("start_webrtc_offer", async () => {
                    console.log("⚡ [Client] Server instructed this browser to create Offer!");
                    if (!pcRef.current) return;
                    try {
                        const offer = await pcRef.current.createOffer();
                        await pcRef.current.setLocalDescription(offer);
                        console.log("📤 [Client] Sending created OFFER to server...");
                        socket.emit("webrtc_offer", { roomCode, offer });
                    } catch (err) {
                        console.error("❌ [Client] Error creating Offer:", err);
                    }
                });

            } catch (err) {
                console.error("❌ [Client] Camera/Microphone access error:", err);
            }
        }

        initWebRTC();

        return () => {
            isMounted = false;
            console.log("🧹 [Client] Cleaning up WebRTC connection...");
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

    return (
        <div className="w-64 bg-slate-800 border-r border-slate-700 h-screen flex flex-col p-4 shadow-xl shrink-0 z-10">
            <div className="flex items-center gap-2 mb-6">
                <div className={`w-3 h-3 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`}></div>
                <span className="font-semibold text-slate-200">
                    {isConnected ? "Live Call" : "Connecting..."}
                </span>
            </div>

            <div className="flex-1 flex flex-col gap-4">
                {/* Remote Video (Top) */}
                <div className="relative rounded-xl overflow-hidden bg-slate-900 border-2 border-slate-700 shadow-lg flex-1">
                    <video
                        ref={remoteVideoRef}
                        autoPlay
                        playsInline
                        className="absolute inset-0 w-full h-full object-cover"
                    />
                    <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs font-medium backdrop-blur-sm">
                        {isConnected ? opponentName : "Connecting..."}
                    </div>
                </div>

                {/* Local Video (Bottom) */}
                <div className="relative rounded-xl overflow-hidden bg-slate-900 border-2 border-slate-700 shadow-lg flex-1">
                    <video
                        ref={localVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="absolute inset-0 w-full h-full object-cover -scale-x-100"
                    />
                    <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs font-medium backdrop-blur-sm">
                        You
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-4">
                <button
                    onClick={toggleAudio}
                    className={`py-3 rounded-lg font-medium transition-colors ${isAudioMuted ? "bg-red-500 hover:bg-red-600" : "bg-slate-700 hover:bg-slate-600"
                        }`}
                >
                    {isAudioMuted ? "🔇 Muted" : "🎤 Mic On"}
                </button>
                <button
                    onClick={toggleVideo}
                    className={`py-3 rounded-lg font-medium transition-colors ${isVideoOff ? "bg-red-500 hover:bg-red-600" : "bg-slate-700 hover:bg-slate-600"
                        }`}
                >
                    {isVideoOff ? "🚫 Cam Off" : "📷 Cam On"}
                </button>
            </div>
        </div>
    );
}
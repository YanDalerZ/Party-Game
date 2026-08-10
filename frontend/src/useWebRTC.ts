import { useRef, useEffect, useCallback } from 'react';

interface UseWebRTCOptions {
    socket: any;
    roomId: string;
    onRemoteStream?: (stream: MediaStream) => void;
}

export const useWebRTC = ({ socket, roomId, onRemoteStream }: UseWebRTCOptions) => {
    const pc = useRef<RTCPeerConnection | null>(null);
    const iceCandidateQueue = useRef<RTCIceCandidateInit[]>([]);
    const isNegotiating = useRef<boolean>(false);

    const createPeerConnection = useCallback(() => {
        if (pc.current) return pc.current;

        const peer = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        peer.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', { roomId, candidate: event.candidate });
            }
        };

        peer.ontrack = (event) => {
            if (onRemoteStream && event.streams[0]) {
                onRemoteStream(event.streams[0]);
            }
        };

        peer.onsignalingstatechange = () => {
            if (peer.signalingState === 'stable') {
                isNegotiating.current = false;
            }
        };

        pc.current = peer;
        return peer;
    }, [socket, roomId, onRemoteStream]);

    const processIceQueue = async () => {
        if (!pc.current || !pc.current.remoteDescription) return;
        while (iceCandidateQueue.current.length > 0) {
            const candidate = iceCandidateQueue.current.shift();
            if (candidate) {
                try {
                    await pc.current.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (err) {
                    console.error('Error adding queued ICE candidate:', err);
                }
            }
        }
    };

    useEffect(() => {
        const peer = createPeerConnection();

        const handleOffer = async ({ offer }: { offer: RTCSessionDescriptionInit }) => {
            if (!peer) return;
            try {
                if (peer.signalingState !== 'stable') {
                    await Promise.all([
                        peer.setLocalDescription({ type: 'rollback' }),
                        peer.setRemoteDescription(new RTCSessionDescription(offer))
                    ]);
                } else {
                    await peer.setRemoteDescription(new RTCSessionDescription(offer));
                }
                await processIceQueue();

                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);
                socket.emit('webrtc-answer', { roomId, answer });
            } catch (err) {
                console.error('Error handling offer:', err);
            }
        };

        const handleAnswer = async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
            if (!peer) return;
            try {
                if (peer.signalingState === 'have-local-offer') {
                    await peer.setRemoteDescription(new RTCSessionDescription(answer));
                    await processIceQueue();
                }
            } catch (err) {
                console.error('Error handling answer:', err);
            }
        };

        const handleIceCandidate = async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
            if (!peer) return;
            if (peer.remoteDescription && peer.remoteDescription.type) {
                try {
                    await peer.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (err) {
                    console.error('Error adding ICE candidate:', err);
                }
            } else {
                iceCandidateQueue.current.push(candidate);
            }
        };

        socket.on('webrtc-offer', handleOffer);
        socket.on('webrtc-answer', handleAnswer);
        socket.on('ice-candidate', handleIceCandidate);

        return () => {
            socket.off('webrtc-offer', handleOffer);
            socket.off('webrtc-answer', handleAnswer);
            socket.off('ice-candidate', handleIceCandidate);
            if (pc.current) {
                pc.current.close();
                pc.current = null;
            }
        };
    }, [socket, roomId, createPeerConnection]);

    const startOffer = async () => {
        const peer = createPeerConnection();
        if (isNegotiating.current || peer.signalingState !== 'stable') return;

        try {
            isNegotiating.current = true;
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            socket.emit('webrtc-offer', { roomId, offer });
        } catch (err) {
            isNegotiating.current = false;
            console.error('Error starting offer:', err);
        }
    };

    return { pc: pc.current, startOffer, createPeerConnection };
};
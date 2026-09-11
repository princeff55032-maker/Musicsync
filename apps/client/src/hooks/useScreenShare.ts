"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useClientId } from "@/hooks/useClientId";
import { RTC_CONFIG, webrtcSignalBus, type IncomingSignalPayload } from "@/lib/webrtc";
import { useGlobalStore } from "@/store/global";
import { sendWSRequest } from "@/utils/ws";
import { ClientActionEnum, type WebRTCSignalDataType } from "@beatsync/shared";

export function useScreenShare() {
  const { clientId } = useClientId();
  const socket = useGlobalStore((state) => state.socket);
  const connectedClients = useGlobalStore((state) => state.connectedClients);
  const isScreenSharing = useGlobalStore((state) => state.isScreenSharing);
  const screenSharer = useGlobalStore((state) => state.screenSharer);
  const localStream = useGlobalStore((state) => state.localStream);
  const remoteStream = useGlobalStore((state) => state.remoteStream);
  const screenShareVolume = useGlobalStore((state) => state.screenShareVolume);

  const setIsScreenSharing = useGlobalStore((state) => state.setIsScreenSharing);
  const setLocalStream = useGlobalStore((state) => state.setLocalStream);
  const setRemoteStream = useGlobalStore((state) => state.setRemoteStream);
  const setScreenSharer = useGlobalStore((state) => state.setScreenSharer);

  // Active RTCPeerConnections mapped by remote clientId
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  // Candidates received before remoteDescription was set
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  // Ref to track localStream inside callbacks without stale closures
  const localStreamRef = useRef<MediaStream | null>(null);
  localStreamRef.current = localStream;

  // Send a WebRTC signaling packet to a target peer
  const sendSignal = useCallback(
    (targetClientId: string, signal: WebRTCSignalDataType) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      sendWSRequest({
        ws: socket,
        request: {
          type: ClientActionEnum.enum.WEBRTC_SIGNAL,
          targetClientId,
          signal,
        },
      });
    },
    [socket]
  );

  // Close peer connection for a specific client
  const closePeerConnection = useCallback((peerId: string) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onnegotiationneeded = null;
      pc.close();
      peerConnectionsRef.current.delete(peerId);
    }
    pendingCandidatesRef.current.delete(peerId);
  }, []);

  // Close all peer connections
  const closeAllPeerConnections = useCallback(() => {
    peerConnectionsRef.current.forEach((pc) => {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onnegotiationneeded = null;
      pc.close();
    });
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();
  }, []);

  // Drain buffered ICE candidates after setRemoteDescription
  const drainPendingCandidates = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    const queue = pendingCandidatesRef.current.get(peerId) || [];
    pendingCandidatesRef.current.delete(peerId);
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error("Error adding queued ICE candidate:", err);
      }
    }
  }, []);

  // Create and configure a new RTCPeerConnection
  const getOrCreatePeerConnection = useCallback(
    (peerId: string): RTCPeerConnection => {
      const existing = peerConnectionsRef.current.get(peerId);
      if (existing && existing.connectionState !== "closed") {
        return existing;
      }

      const pc = new RTCPeerConnection(RTC_CONFIG);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal(peerId, {
            type: "candidate",
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (event) => {
        console.log("WebRTC ontrack received from", peerId, event.streams);
        if (event.streams && event.streams[0]) {
          setRemoteStream(event.streams[0]);
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`WebRTC connection to ${peerId} state:`, pc.connectionState);
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          // Do not close immediately on disconnect to allow reconnection, but log
        }
      };

      peerConnectionsRef.current.set(peerId, pc);
      return pc;
    },
    [sendSignal, setRemoteStream]
  );

  // Stop screen sharing cleanly
  const stopShare = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      setLocalStream(null);
    }

    closeAllPeerConnections();
    setIsScreenSharing(false);
    setScreenSharer(null);

    if (socket && socket.readyState === WebSocket.OPEN) {
      sendWSRequest({
        ws: socket,
        request: {
          type: ClientActionEnum.enum.STOP_SCREEN_SHARE,
        },
      });
    }

    toast.info("Screen sharing stopped");
  }, [closeAllPeerConnections, setIsScreenSharing, setLocalStream, setScreenSharer, socket]);

  // Start screen sharing
  const startShare = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      toast.error("Screen sharing is not supported in this browser");
      return;
    }

    try {
      // Prompt user to pick a display surface (tab, window, or screen)
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "browser",
        } as MediaTrackConstraints,
        audio: true, // Capture tab/system audio if user chooses to share audio
      });

      // Handle user stopping via browser native controls
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          stopShare();
        };
      }

      setLocalStream(stream);
      setIsScreenSharing(true);

      // Notify server that this user is sharing screen
      if (socket && socket.readyState === WebSocket.OPEN) {
        sendWSRequest({
          ws: socket,
          request: {
            type: ClientActionEnum.enum.START_SCREEN_SHARE,
          },
        });
      }

      // Connect to each peer currently in the room
      const peers = connectedClients.filter((c) => c.clientId !== clientId);

      for (const peer of peers) {
        const pc = getOrCreatePeerConnection(peer.clientId);

        // Add local tracks to peer connection
        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream);
        });

        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          sendSignal(peer.clientId, {
            type: "offer",
            sdp: offer.sdp,
          });
        } catch (err) {
          console.error(`Failed to create offer for peer ${peer.clientId}:`, err);
        }
      }

      toast.success("Screen sharing started");
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        // User canceled browser share dialog
        return;
      }
      console.error("Error starting screen share:", err);
      toast.error("Failed to start screen share");
    }
  }, [clientId, connectedClients, getOrCreatePeerConnection, sendSignal, setIsScreenSharing, setLocalStream, socket, stopShare]);

  // When presenter is sharing and a NEW client joins the room, send an offer to them
  useEffect(() => {
    if (!isScreenSharing || !localStream) return;

    const currentStream = localStream;
    connectedClients.forEach(async (peer) => {
      if (peer.clientId === clientId) return;

      // If connection doesn't exist yet, initiate it
      if (!peerConnectionsRef.current.has(peer.clientId)) {
        const pc = getOrCreatePeerConnection(peer.clientId);
        currentStream.getTracks().forEach((track) => {
          pc.addTrack(track, currentStream);
        });

        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendSignal(peer.clientId, {
            type: "offer",
            sdp: offer.sdp,
          });
        } catch (err) {
          console.error(`Failed to offer to new peer ${peer.clientId}:`, err);
        }
      }
    });
  }, [connectedClients, isScreenSharing, localStream, clientId, getOrCreatePeerConnection, sendSignal]);

  // Handle incoming signaling messages from WebRTC bus
  useEffect(() => {
    const unsubscribe = webrtcSignalBus.subscribe(async ({ fromClientId, signal }: IncomingSignalPayload) => {
      const { type } = signal;

      if (type === "offer") {
        try {
          const pc = getOrCreatePeerConnection(fromClientId);

          await pc.setRemoteDescription(
            new RTCSessionDescription({
              type: "offer",
              sdp: signal.sdp,
            })
          );

          await drainPendingCandidates(fromClientId, pc);

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          sendSignal(fromClientId, {
            type: "answer",
            sdp: answer.sdp,
          });
        } catch (err) {
          console.error(`Error handling offer from ${fromClientId}:`, err);
        }
      } else if (type === "answer") {
        try {
          const pc = peerConnectionsRef.current.get(fromClientId);
          if (pc) {
            await pc.setRemoteDescription(
              new RTCSessionDescription({
                type: "answer",
                sdp: signal.sdp,
              })
            );
            await drainPendingCandidates(fromClientId, pc);
          }
        } catch (err) {
          console.error(`Error handling answer from ${fromClientId}:`, err);
        }
      } else if (type === "candidate" && signal.candidate) {
        const pc = peerConnectionsRef.current.get(fromClientId);
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } catch (err) {
            console.error(`Error adding ICE candidate from ${fromClientId}:`, err);
          }
        } else {
          // Buffer candidate until remoteDescription is set
          const queue = pendingCandidatesRef.current.get(fromClientId) || [];
          queue.push(signal.candidate);
          pendingCandidatesRef.current.set(fromClientId, queue);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [drainPendingCandidates, getOrCreatePeerConnection, sendSignal]);

  // Clean up when remote screen sharer stops sharing
  useEffect(() => {
    if (!screenSharer && !isScreenSharing) {
      setRemoteStream(null);
      closeAllPeerConnections();
    }
  }, [closeAllPeerConnections, isScreenSharing, screenSharer, setRemoteStream]);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      closeAllPeerConnections();
    };
  }, [closeAllPeerConnections]);

  return {
    isScreenSharing,
    screenSharer,
    localStream,
    remoteStream,
    screenShareVolume,
    startShare,
    stopShare,
  };
}

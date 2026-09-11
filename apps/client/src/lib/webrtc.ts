import type { WebRTCSignalDataType } from "@beatsync/shared";

export interface IncomingSignalPayload {
  fromClientId: string;
  fromUsername?: string;
  signal: WebRTCSignalDataType;
}

type SignalListener = (payload: IncomingSignalPayload) => void;

class WebRTCSignalBus {
  private listeners: Set<SignalListener> = new Set();

  subscribe(listener: SignalListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(payload: IncomingSignalPayload): void {
    this.listeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (err) {
        console.error("Error in WebRTC signal listener:", err);
      }
    });
  }
}

export const webrtcSignalBus = new WebRTCSignalBus();

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"] },
  ],
};

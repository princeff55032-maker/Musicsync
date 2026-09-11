import { useEffect, useRef } from "react";
import { audioContextManager } from "@/lib/audioContextManager";
import { extractFileNameFromUrl } from "@/lib/utils";
import { useCanMutate, useGlobalStore } from "@/store/global";
import { useRoomStore } from "@/store/room";

// Minimal silent WAV (46 bytes) to anchor media playback on mobile OS notifications
const SILENCE_DATA_URL =
  "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA==";

/**
 * Parses a track filename into artist and title.
 * Standard format: "Artist - Title"
 */
function parseTrackMetadata(fileName: string): { title: string; artist: string } {
  const delimiter = " - ";
  const parts = fileName.split(delimiter);
  if (parts.length >= 2) {
    const artist = parts[0].trim();
    const title = parts.slice(1).join(delimiter).trim();
    return { title, artist };
  }
  return { title: fileName, artist: "MusicSync" };
}

/**
 * Safely sets a MediaSession action handler, catching unsupported action errors.
 */
function safeSetActionHandler(
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null
) {
  if (typeof window === "undefined" || !("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // Browser may not support this specific action
  }
}

/**
 * Hook to synchronize playback state, track metadata, and hardware/lock-screen controls
 * via the browser MediaSession API.
 */
export const useMediaSession = () => {
  const canMutate = useCanMutate();
  const roomId = useRoomStore((state) => state.roomId);

  const isPlaying = useGlobalStore((state) => state.isPlaying);
  const selectedAudioUrl = useGlobalStore((state) => state.selectedAudioUrl);
  const getSelectedTrack = useGlobalStore((state) => state.getSelectedTrack);
  const duration = useGlobalStore((state) => state.duration);
  const getCurrentTrackPosition = useGlobalStore((state) => state.getCurrentTrackPosition);

  const silentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Initialize silent audio anchor for mobile lock screens
  useEffect(() => {
    if (typeof window === "undefined") return;

    const audio = document.createElement("audio");
    audio.setAttribute("x-webkit-airplay", "deny");
    audio.controls = false;
    audio.disableRemotePlayback = true;
    audio.preload = "auto";
    audio.loop = true;
    audio.src = SILENCE_DATA_URL;

    silentAudioRef.current = audio;

    return () => {
      audio.pause();
      audio.src = "";
      silentAudioRef.current = null;
    };
  }, []);

  // Sync silent audio playback to keep mobile OS media session active
  useEffect(() => {
    const audio = silentAudioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.play().catch(() => {
        // Handled silently if autoplay restrictions apply
      });
    } else {
      audio.pause();
    }
  }, [isPlaying]);

  // Update track metadata (Title, Artist, Album, Artwork)
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return;

    const track = getSelectedTrack();
    if (!track) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
      return;
    }

    try {
      const fileName = extractFileNameFromUrl(track.source.url);
      const { title, artist } = parseTrackMetadata(fileName);
      const album = roomId ? `MusicSync • Room ${roomId}` : "MusicSync";

      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist,
        album,
        artwork: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
          { src: "/icon.svg", sizes: "96x96", type: "image/svg+xml" },
          { src: "/icon.svg", sizes: "128x128", type: "image/svg+xml" },
          { src: "/icon.svg", sizes: "192x192", type: "image/svg+xml" },
          { src: "/icon.svg", sizes: "256x256", type: "image/svg+xml" },
          { src: "/icon.svg", sizes: "512x512", type: "image/svg+xml" },
        ],
      });
    } catch (err) {
      console.error("[useMediaSession] Error setting metadata:", err);
    }
  }, [selectedAudioUrl, roomId, getSelectedTrack]);

  // Update playbackState ("playing" | "paused" | "none")
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return;

    if (!selectedAudioUrl) {
      navigator.mediaSession.playbackState = "none";
    } else {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    }
  }, [isPlaying, selectedAudioUrl]);

  // Sync position state (scrubber on lock screen / notification)
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return;
    if (!("setPositionState" in navigator.mediaSession)) return;

    const syncPosition = () => {
      if (duration > 0) {
        const currentPos = Math.max(0, Math.min(getCurrentTrackPosition(), duration));
        try {
          navigator.mediaSession.setPositionState({
            duration: Math.max(1, duration),
            playbackRate: 1.0,
            position: currentPos,
          });
        } catch {
          // Ignored if browser throws on transient position bounds
        }
      }
    };

    syncPosition();

    // While playing, update position state periodically to keep lock screen scrubber accurate
    if (isPlaying) {
      const intervalId = setInterval(syncPosition, 1000);
      return () => clearInterval(intervalId);
    }
  }, [isPlaying, duration, getCurrentTrackPosition]);

  // Register hardware & lock-screen media action handlers
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return;

    // Play action
    safeSetActionHandler("play", async () => {
      if (!canMutate) return;
      try {
        await audioContextManager.resume();
      } catch {
        // User interaction handled
      }
      const state = useGlobalStore.getState();
      if (!state.isPlaying) {
        state.broadcastPlay();
      }
    });

    // Pause action
    safeSetActionHandler("pause", () => {
      if (!canMutate) return;
      const state = useGlobalStore.getState();
      if (state.isPlaying) {
        state.broadcastPause();
      }
    });

    // Previous track action
    safeSetActionHandler("previoustrack", () => {
      if (!canMutate) return;
      const state = useGlobalStore.getState();
      if (!state.isShuffled && state.audioSources.length > 1) {
        state.skipToPreviousTrack();
      }
    });

    // Next track action
    safeSetActionHandler("nexttrack", () => {
      if (!canMutate) return;
      const state = useGlobalStore.getState();
      if (state.audioSources.length > 1) {
        state.skipToNextTrack();
      }
    });

    // Seek to specific timestamp
    safeSetActionHandler("seekto", (details) => {
      if (!canMutate || typeof details.seekTime !== "number") return;
      const state = useGlobalStore.getState();
      const target = Math.max(0, Math.min(details.seekTime, state.duration || 0));

      if (state.isPlaying) {
        state.broadcastPlay(target);
      } else {
        useGlobalStore.setState({ currentTime: target });
      }
    });

    // Skip backward (e.g. 10s)
    safeSetActionHandler("seekbackward", (details) => {
      if (!canMutate) return;
      const offset = details.seekOffset || 10;
      const state = useGlobalStore.getState();
      const current = state.getCurrentTrackPosition();
      const target = Math.max(0, current - offset);

      if (state.isPlaying) {
        state.broadcastPlay(target);
      } else {
        useGlobalStore.setState({ currentTime: target });
      }
    });

    // Skip forward (e.g. 10s)
    safeSetActionHandler("seekforward", (details) => {
      if (!canMutate) return;
      const offset = details.seekOffset || 10;
      const state = useGlobalStore.getState();
      const current = state.getCurrentTrackPosition();
      const target = Math.min(state.duration || 0, current + offset);

      if (state.isPlaying) {
        state.broadcastPlay(target);
      } else {
        useGlobalStore.setState({ currentTime: target });
      }
    });

    // Stop action
    safeSetActionHandler("stop", () => {
      if (!canMutate) return;
      const state = useGlobalStore.getState();
      if (state.isPlaying) {
        state.broadcastPause();
      }
    });

    return () => {
      const actions: MediaSessionAction[] = [
        "play",
        "pause",
        "previoustrack",
        "nexttrack",
        "seekto",
        "seekbackward",
        "seekforward",
        "stop",
      ];
      for (const action of actions) {
        safeSetActionHandler(action, null);
      }
    };
  }, [canMutate]);
};

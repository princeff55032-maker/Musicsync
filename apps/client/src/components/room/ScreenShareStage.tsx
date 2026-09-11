"use client";

import { useClientId } from "@/hooks/useClientId";
import { useScreenShare } from "@/hooks/useScreenShare";
import { cn } from "@/lib/utils";
import { useGlobalStore } from "@/store/global";
import {
  Cast,
  Maximize2,
  Minimize2,
  Monitor,
  MonitorOff,
  PictureInPicture2,
  Radio,
  Volume2,
  VolumeX,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Slider } from "../ui/slider";

interface ScreenShareStageProps {
  className?: string;
}

export const ScreenShareStage = ({ className }: ScreenShareStageProps) => {
  const { clientId } = useClientId();
  const { stopShare } = useScreenShare();

  const isScreenSharing = useGlobalStore((state) => state.isScreenSharing);
  const screenSharer = useGlobalStore((state) => state.screenSharer);
  const localStream = useGlobalStore((state) => state.localStream);
  const remoteStream = useGlobalStore((state) => state.remoteStream);
  const screenShareVolume = useGlobalStore((state) => state.screenShareVolume);
  const setScreenShareVolume = useGlobalStore((state) => state.setScreenShareVolume);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [prevVolume, setPrevVolume] = useState(1);

  const isLocalPresenter = isScreenSharing && !!localStream;
  const activeStream = isLocalPresenter ? localStream : remoteStream;
  const isSharingActive = isLocalPresenter || (!!screenSharer && !!remoteStream);

  // Bind media stream to HTML5 video element
  useEffect(() => {
    if (videoRef.current && activeStream) {
      videoRef.current.srcObject = activeStream;
      videoRef.current.play().catch((err) => {
        console.warn("Autoplay was prevented:", err);
      });
    }
  }, [activeStream]);

  // Adjust volume for remote viewers (mute for presenter to avoid echo)
  useEffect(() => {
    if (videoRef.current) {
      if (isLocalPresenter) {
        videoRef.current.muted = true;
      } else {
        videoRef.current.muted = isMuted;
        videoRef.current.volume = isMuted ? 0 : screenShareVolume;
      }
    }
  }, [screenShareVolume, isMuted, isLocalPresenter]);

  // Track fullscreen change
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error("Fullscreen error:", err);
    }
  };

  const togglePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.error("PiP error:", err);
    }
  };

  const handleMuteToggle = () => {
    if (isMuted) {
      setIsMuted(false);
      setScreenShareVolume(prevVolume || 0.8);
    } else {
      setPrevVolume(screenShareVolume);
      setIsMuted(true);
      setScreenShareVolume(0);
    }
  };

  const handleVolumeChange = (values: number[]) => {
    const newVol = values[0] ?? 1;
    setScreenShareVolume(newVol);
    if (newVol > 0 && isMuted) {
      setIsMuted(false);
    }
  };

  // If no one is sharing, do not render
  if (!isSharingActive && !isScreenSharing && !screenSharer) {
    return null;
  }

  const presenterName = isLocalPresenter ? "You" : screenSharer?.username || "Someone";

  return (
    <AnimatePresence>
      <motion.div
        ref={containerRef}
        initial={{ opacity: 0, y: -20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.98 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className={cn(
          "relative w-full rounded-2xl overflow-hidden border border-neutral-800/80 bg-neutral-950/90 shadow-2xl backdrop-blur-xl group transition-all duration-300",
          isFullscreen ? "h-screen rounded-none border-none" : isCollapsed ? "h-14" : "h-[360px] md:h-[460px]",
          className
        )}
      >
        {/* Header bar overlay */}
        <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-4 py-2.5 bg-gradient-to-b from-black/80 via-black/40 to-transparent">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wider uppercase bg-red-500/20 text-red-400 border border-red-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              Live
            </span>
            <div className="flex items-center gap-1.5 text-xs text-neutral-300 font-medium">
              <Monitor className="w-3.5 h-3.5 text-neutral-400" />
              <span>
                <strong className="text-white font-semibold">{presenterName}</strong>
                {isLocalPresenter ? " are presenting" : " is sharing"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* PiP Button */}
            {!isCollapsed && (
              <button
                onClick={togglePiP}
                title="Picture in Picture"
                className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <PictureInPicture2 className="w-4 h-4" />
              </button>
            )}

            {/* Fullscreen Button */}
            {!isCollapsed && (
              <button
                onClick={toggleFullscreen}
                title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            )}

            {/* Collapse / Expand Button */}
            {!isFullscreen && (
              <button
                onClick={() => setIsCollapsed((prev) => !prev)}
                title={isCollapsed ? "Expand Stage" : "Minimize Stage"}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                {isCollapsed ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
              </button>
            )}

            {/* Stop Presenting Button for Host */}
            {isLocalPresenter && (
              <button
                onClick={stopShare}
                className="ml-2 flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white transition-all shadow-md active:scale-95"
              >
                <MonitorOff className="w-3.5 h-3.5" />
                Stop
              </button>
            )}
          </div>
        </div>

        {/* Video Area */}
        {!isCollapsed && (
          <div className="relative w-full h-full flex items-center justify-center bg-black/90">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-full object-contain cursor-pointer"
              onClick={toggleFullscreen}
            />

            {/* Connecting state fallback if activeStream is waiting */}
            {!activeStream && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950/80">
                <Radio className="w-8 h-8 text-neutral-500 animate-spin" />
                <p className="text-xs text-neutral-400">Connecting to stream...</p>
              </div>
            )}

            {/* Bottom Controls Bar */}
            <div className="absolute bottom-0 inset-x-0 z-20 flex items-center justify-between px-4 py-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              {/* Screen audio volume control for viewers */}
              {!isLocalPresenter && (
                <div className="flex items-center gap-2 bg-neutral-900/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-neutral-800">
                  <button
                    onClick={handleMuteToggle}
                    className="text-neutral-400 hover:text-white transition-colors"
                  >
                    {isMuted || screenShareVolume === 0 ? (
                      <VolumeX className="w-4 h-4 text-red-400" />
                    ) : (
                      <Volume2 className="w-4 h-4" />
                    )}
                  </button>
                  <div className="w-20">
                    <Slider
                      value={[isMuted ? 0 : screenShareVolume]}
                      min={0}
                      max={1}
                      step={0.05}
                      onValueChange={handleVolumeChange}
                    />
                  </div>
                </div>
              )}

              <div className="text-[11px] text-neutral-400 bg-neutral-900/80 backdrop-blur-md px-2.5 py-1 rounded-full border border-neutral-800 ml-auto">
                WebRTC P2P • Direct
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

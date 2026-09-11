"use client";
import { SOCIAL_LINKS } from "@/constants";
import { audioContextManager } from "@/lib/audioContextManager";
import { MAX_NTP_MEASUREMENTS, useGlobalStore } from "@/store/global";
import { Crown, Hash, MonitorOff, MonitorUp, Radio, Users } from "lucide-react";
import { useScreenShare } from "@/hooks/useScreenShare";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { FaDiscord, FaGithub } from "react-icons/fa";
import { SyncProgress } from "../ui/SyncProgress";

interface TopBarProps {
  roomId: string;
}

export const TopBar = ({ roomId }: TopBarProps) => {
  const isLoadingAudio = useGlobalStore((state) => state.isInitingSystem);
  const isSynced = useGlobalStore((state) => state.isSynced);
  const roundTripEstimate = useGlobalStore((state) => state.roundTripEstimate);
  const connectedClientCount = useGlobalStore((state) => state.connectedClients.length);
  const clockOffset = useGlobalStore((state) => state.offsetEstimate);
  const syncMeasurementCount = useGlobalStore((state) => state.syncMeasurements.length);

  // Get current user from global store to check admin status
  const currentUser = useGlobalStore((state) => state.currentUser);
  const isAdmin = currentUser?.isAdmin || false;

  const { isScreenSharing, screenSharer, startShare, stopShare } = useScreenShare();

  // Show minimal nav bar when synced and not loading
  if (!isLoadingAudio && isSynced) {
    return (
      <div className="h-8 bg-black/80 backdrop-blur-md z-50 flex items-center justify-between px-4 border-b border-zinc-800">
        <div className="flex items-center space-x-4 text-xs text-neutral-400 py-2 md:py-0">
          {isAdmin && (
            <div className="flex items-center">
              <Crown className="h-3 w-3 text-green-500" fill="currentColor" />
            </div>
          )}
          <Link href="/" className="font-medium hover:text-white transition-colors">
            Musicsync
          </Link>

          {/* NTP Measurements Indicator */}
          <div className="items-center hidden md:flex">
            <motion.svg width="14" height="14" viewBox="0 0 14 14" className="mr-1">
              <circle
                cx="7"
                cy="7"
                r="5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-neutral-600"
              />
              <motion.circle
                cx="7"
                cy="7"
                r="5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-green-500"
                strokeDasharray={`${(syncMeasurementCount / MAX_NTP_MEASUREMENTS) * 31.4} 31.4`}
                strokeLinecap="round"
                transform="rotate(-90 7 7)"
                initial={{ strokeDasharray: "0 31.4" }}
                animate={{
                  strokeDasharray: `${(syncMeasurementCount / MAX_NTP_MEASUREMENTS) * 31.4} 31.4`,
                }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
              />
            </motion.svg>
            <span className="text-xs">
              {syncMeasurementCount}/{MAX_NTP_MEASUREMENTS}
            </span>
          </div>
          <div className="flex items-center">
            <Hash size={12} className="mr-1" />
            <span className="flex items-center">{roomId}</span>
          </div>
          <div className="flex items-center">
            <Users size={12} className="mr-1" />
            <span className="flex items-center">
              <span className="mr-1.5">
                {connectedClientCount} {connectedClientCount === 1 ? "user" : "users"}
              </span>
            </span>
          </div>
          {/* Hide separator on small screens */}
          <div className="hidden md:block">|</div>
          {/* Hide Offset/RTT on small screens */}
          <div className="hidden md:flex items-center space-x-2">
            <span>Offset: {clockOffset.toFixed(2)}ms</span>
            <span>RTT: {roundTripEstimate.toFixed(2)}ms</span>
            <span>OL: {((audioContextManager.getContext().outputLatency ?? 0) * 1000).toFixed(0)}ms</span>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2.5">
          {/* Screen Share Action Button */}
          {isScreenSharing ? (
            <button
              onClick={stopShare}
              className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-600/80 hover:bg-red-500 text-white border border-red-500/50 shadow-sm transition-all active:scale-95 animate-pulse cursor-pointer"
              title="Stop sharing your screen"
            >
              <MonitorOff className="w-3 h-3" />
              <span>Stop Share</span>
            </button>
          ) : screenSharer ? (
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>{screenSharer.username} Live</span>
            </div>
          ) : (
            <button
              onClick={startShare}
              className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium text-neutral-300 hover:text-white bg-neutral-800/80 hover:bg-neutral-700/80 border border-neutral-700 transition-all active:scale-95 cursor-pointer"
              title="Share your screen with the room"
            >
              <MonitorUp className="w-3 h-3 text-neutral-400" />
              <span>Share Screen</span>
            </button>
          )}

          <div className="hidden sm:block text-neutral-700">|</div>

          {/* Discord icon */}
          <a
            href={SOCIAL_LINKS.discord}
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-400 hover:text-white transition-colors"
          >
            <FaDiscord className="size-[17px]" />
          </a>
          {/* GitHub icon in the top right */}
          <a
            href={SOCIAL_LINKS.github}
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-400 hover:text-white transition-colors"
          >
            <FaGithub className="size-4" />
          </a>
        </div>
      </div>
    );
  }

  // Use the existing SyncProgress component for loading/syncing states
  return (
    <AnimatePresence>
      {isLoadingAudio && (
        <motion.div exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
          <SyncProgress />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

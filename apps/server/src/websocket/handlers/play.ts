import type { ExtractWSRequestFrom } from "@beatsync/shared";
import { IS_DEMO_MODE } from "@/demo";
import { requireCanMutate } from "@/websocket/middlewares";
import type { HandlerFunction } from "@/websocket/types";

export const handlePlay: HandlerFunction<ExtractWSRequestFrom["PLAY"]> = ({ ws, message, server }) => {
  const { room } = requireCanMutate(ws);

  // Notify all connected clients to buffer this track
  room.broadcastLoadAudioSource(message.audioSource, server);

  // Execute playback immediately with dynamic network scheduling (~200-400ms)
  // No artificial 10-15s timeout delays!
  room.executeImmediatePlay(message, server);
};



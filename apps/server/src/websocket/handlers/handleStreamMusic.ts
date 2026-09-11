import { IS_DEMO_MODE } from "@/demo";
import { globalManager } from "@/managers";
import { MUSIC_PROVIDER_MANAGER } from "@/managers/MusicProviderManager";
import { sendBroadcast } from "@/utils/responses";
import type { HandlerFunction } from "@/websocket/types";
import type { ExtractWSRequestFrom } from "@beatsync/shared";

export const handleStreamMusic: HandlerFunction<ExtractWSRequestFrom["STREAM_MUSIC"]> = async ({
  ws,
  message,
  server,
}) => {
  if (IS_DEMO_MODE) return;
  const roomId = ws.data.roomId;

  // Require room to exist before processing stream request
  const room = globalManager.getRoom(roomId);
  if (!room) {
    console.error(`Stream request failed: Room ${roomId} not found`);
    return;
  }

  // Check if this track is already being streamed
  const trackId = message.trackId.toString();
  if (room.hasActiveStreamJob(trackId)) {
    console.log(`Track ${trackId} is already being streamed for room ${roomId}, ignoring duplicate request`);
    return;
  }

  // Add job to room and broadcast updated count
  room.addStreamJob(trackId);
  sendBroadcast({
    server,
    roomId,
    message: {
      type: "STREAM_JOB_UPDATE",
      activeJobCount: room.getActiveStreamJobCount(),
    },
  });

  try {
    // Get the stream URL from the music provider (with fallback resolution by name)
    const streamResponse = await MUSIC_PROVIDER_MANAGER.stream(message.trackId, message.trackName);

    if (!streamResponse.success) {
      throw new Error("Failed to get stream URL");
    }

    const streamUrl = streamResponse.data.url;

    // Use direct high-speed CDN streaming (zero server memory overhead, instant start)
    const finalAudioUrl = streamUrl;

    const isRoomIdle = room.getPlaybackState().type !== "playing";

    // Add the audio source to the room and get updated sources list
    const sources = room.addAudioSource({ url: finalAudioUrl });

    console.log(`Successfully added track: ${finalAudioUrl}`);
    console.log(`Broadcasting new audio sources to room ${roomId}: ${sources.length} total sources`);

    // Broadcast to all room members that new audio is available and selected
    sendBroadcast({
      server,
      roomId,
      message: {
        type: "ROOM_EVENT",
        event: {
          type: "SET_AUDIO_SOURCES",
          sources,
          currentAudioSource: isRoomIdle ? finalAudioUrl : undefined,
        },
      },
    });

    // If nothing was playing, automatically start playing the selected song in sync!
    if (isRoomIdle) {
      console.log(`Room ${roomId} is idle. Automatically starting playback for: ${finalAudioUrl}`);
      room.broadcastLoadAudioSource(finalAudioUrl, server);
      room.executeImmediatePlay(
        {
          type: "PLAY",
          trackTimeSeconds: 0,
          audioSource: finalAudioUrl,
        },
        server
      );
    }
  } catch (error) {
    console.error("Error in handleStreamMusic:", error);
  } finally {
    // Job completed or failed - remove from tracking and notify clients
    room.removeStreamJob(trackId);
    sendBroadcast({
      server,
      roomId,
      message: {
        type: "STREAM_JOB_UPDATE",
        activeJobCount: room.getActiveStreamJobCount(),
      },
    });
  }
};

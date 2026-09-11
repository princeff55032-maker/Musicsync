import { AUDIO_FILE_CACHE, IS_DEMO_MODE } from "@/demo";
import { generateAudioFileName, uploadBytes, validateR2Config } from "@/lib/r2";
import { globalManager } from "@/managers";
import { MUSIC_PROVIDER_MANAGER } from "@/managers/MusicProviderManager";
import { sendBroadcast } from "@/utils/responses";
import type { HandlerFunction } from "@/websocket/types";
import type { ExtractWSRequestFrom } from "@beatsync/shared";

function getServerOrigin(): string {
  if (process.env.RENDER_EXTERNAL_URL) {
    return process.env.RENDER_EXTERNAL_URL;
  }
  if (process.env.PUBLIC_SERVER_URL) {
    return process.env.PUBLIC_SERVER_URL;
  }
  if (process.env.NODE_ENV === "production") {
    return "https://musicsync-pz3t.onrender.com";
  }
  return `http://localhost:${process.env.PORT || 8080}`;
}

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
    // Get the stream URL from the music provider
    const streamResponse = await MUSIC_PROVIDER_MANAGER.stream(message.trackId);

    if (!streamResponse.success) {
      throw new Error("Failed to get stream URL");
    }

    const streamUrl = streamResponse.data.url;

    // Use provided track name or fallback to track ID
    const originalName = message.trackName ?? `track-${message.trackId}`;

    // Download the audio file
    console.log(`Downloading audio from: ${streamUrl}`);
    const response = await fetch(streamUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    // Generate a unique filename for the track
    const fileName = generateAudioFileName(`${originalName}.mp3`);

    if (!response.ok) {
      throw new Error(`Failed to download audio: ${response.status}`);
    }

    // Get audio bytes
    const arrayBuffer = await response.arrayBuffer();

    // Get content type from response headers, fallback to audio/mp4 (AAC) or audio/mpeg
    const contentType = response.headers.get("content-type") ?? "audio/mp4";

    let finalAudioUrl: string;
    const r2Config = validateR2Config();

    if (r2Config.isValid) {
      try {
        console.log(`Uploading to R2: room-${roomId}/${fileName}`);
        finalAudioUrl = await uploadBytes(arrayBuffer, roomId, fileName, contentType);
      } catch (uploadError) {
        console.warn("Failed to upload to R2, falling back to server memory cache:", uploadError);
        AUDIO_FILE_CACHE.set(fileName, {
          bytes: Buffer.from(arrayBuffer),
          type: contentType,
        });
        finalAudioUrl = `${getServerOrigin()}/audio/${encodeURIComponent(fileName)}`;
      }
    } else {
      console.log(`R2 not configured. Caching audio in server memory (${arrayBuffer.byteLength} bytes).`);
      AUDIO_FILE_CACHE.set(fileName, {
        bytes: Buffer.from(arrayBuffer),
        type: contentType,
      });
      finalAudioUrl = `${getServerOrigin()}/audio/${encodeURIComponent(fileName)}`;
    }

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

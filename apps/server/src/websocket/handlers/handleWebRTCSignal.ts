import type { ExtractWSRequestFrom } from "@beatsync/shared";
import { sendUnicast } from "@/utils/responses";
import { requireRoom } from "@/websocket/middlewares";
import type { HandlerFunction } from "@/websocket/types";

export const handleWebRTCSignal: HandlerFunction<ExtractWSRequestFrom["WEBRTC_SIGNAL"]> = ({
  ws,
  message,
}) => {
  const { room } = requireRoom(ws);

  const targetWs = room.getClientWs(message.targetClientId);
  if (!targetWs) {
    console.warn(
      `WebRTC signal from ${ws.data.username} (${ws.data.clientId}) targeted unknown client ${message.targetClientId}`
    );
    return;
  }

  sendUnicast({
    ws: targetWs,
    message: {
      type: "WEBRTC_SIGNAL",
      fromClientId: ws.data.clientId,
      fromUsername: ws.data.username,
      signal: message.signal,
    },
  });
};

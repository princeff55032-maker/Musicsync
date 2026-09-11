import type { ExtractWSRequestFrom } from "@beatsync/shared";
import { sendBroadcast } from "@/utils/responses";
import { requireRoom } from "@/websocket/middlewares";
import type { HandlerFunction } from "@/websocket/types";

export const handleStopScreenShare: HandlerFunction<ExtractWSRequestFrom["STOP_SCREEN_SHARE"]> = ({
  ws,
  server,
}) => {
  const { room } = requireRoom(ws);

  // Clear if this client was the active sharer
  if (room.getScreenSharer()?.clientId === ws.data.clientId) {
    room.setScreenSharer(null);
  }

  sendBroadcast({
    server,
    roomId: ws.data.roomId,
    message: {
      type: "ROOM_EVENT",
      event: {
        type: "SCREEN_SHARE_UPDATE",
        sharingClientId: null,
        sharingUsername: null,
      },
    },
  });
};

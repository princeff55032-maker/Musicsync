import type { ExtractWSRequestFrom } from "@beatsync/shared";
import { sendBroadcast } from "@/utils/responses";
import { requireRoom } from "@/websocket/middlewares";
import type { HandlerFunction } from "@/websocket/types";

export const handleStartScreenShare: HandlerFunction<ExtractWSRequestFrom["START_SCREEN_SHARE"]> = ({
  ws,
  server,
}) => {
  const { room } = requireRoom(ws);

  room.setScreenSharer({
    clientId: ws.data.clientId,
    username: ws.data.username,
  });

  sendBroadcast({
    server,
    roomId: ws.data.roomId,
    message: {
      type: "ROOM_EVENT",
      event: {
        type: "SCREEN_SHARE_UPDATE",
        sharingClientId: ws.data.clientId,
        sharingUsername: ws.data.username,
      },
    },
  });
};

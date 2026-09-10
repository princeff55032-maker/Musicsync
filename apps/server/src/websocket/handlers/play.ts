import type { ExtractWSRequestFrom } from "@beatsync/shared";
import { IS_DEMO_MODE } from "@/demo";
import { requireCanMutate } from "@/websocket/middlewares";
import type { HandlerFunction } from "@/websocket/types";

export const handlePlay: HandlerFunction<ExtractWSRequestFrom["PLAY"]> = ({ ws, message, server }) => {
  const { room } = requireCanMutate(ws);

  // Initiate audio loading for all clients so all devices are buffered before play
  room.initiateAudioSourceLoad(message, ws.data.clientId, server);
};


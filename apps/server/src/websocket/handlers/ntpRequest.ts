import type { HandlerFunction } from "@/websocket/types";
import type { ExtractWSRequestFrom } from "@beatsync/shared";

// NTP requests are handled by the fast-path in websocketHandlers.ts (handleMessage)
// to minimize server processing latency. This no-op handler exists solely to satisfy
// the exhaustive WebsocketRegistry type — it is never reached at runtime.
export const handleNTPRequest: HandlerFunction<ExtractWSRequestFrom["NTP_REQUEST"]> = () => {
  /* noop — fast-path in handleMessage handles NTP */
};

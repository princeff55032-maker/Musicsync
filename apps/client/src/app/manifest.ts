import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Musicsync",
    short_name: "Musicsync",
    description:
      "Turn every device into a synchronized speaker. Musicsync is an open-source music player for multi-device audio playback. Host a listening party today!",
    start_url: "/",
    display: "standalone",
    background_color: "#111111",
    theme_color: "#111111",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}

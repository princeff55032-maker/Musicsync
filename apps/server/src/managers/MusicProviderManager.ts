import {
  RawSearchResponseSchema,
  SearchParamsSchema,
  StreamResponseSchema,
  TrackParamsSchema,
  type TrackType,
} from "@beatsync/shared";
import CryptoJS from "crypto-js";
import type { z } from "zod";

interface CachedTrackInfo {
  numericId: number;
  songId: string;
  title: string;
  artist: string;
  duration: number;
  encryptedMediaUrl?: string;
  streamUrl?: string;
  imageUrl?: string;
}

const DES_KEY = "38346591";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Decodes standard HTML entities in song titles and artists (e.g. &quot;, &#039;)
 */
function decodeHtmlEntities(text: string): string {
  if (!text) return "";
  return text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&bull;/g, "•")
    .trim();
}

/**
 * Decrypts JioSaavn's DES-encrypted media URL to high-quality 320 kbps stream URL
 */
function decryptMediaUrl(encryptedUrl: string): string {
  const key = CryptoJS.enc.Utf8.parse(DES_KEY);
  const decrypted = CryptoJS.DES.decrypt(
    { ciphertext: CryptoJS.enc.Base64.parse(encryptedUrl) },
    key,
    {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7,
    }
  ).toString(CryptoJS.enc.Utf8);

  if (!decrypted) {
    throw new Error("Failed to decrypt audio stream URL");
  }

  // Upgrade to highest bitrate (320kbps MP4/AAC)
  return decrypted.replace("_96.mp4", "_320.mp4");
}

/**
 * Checks if input is a YouTube URL and extracts info via oEmbed
 */
async function resolveYouTubeUrl(url: string): Promise<{ title: string; author: string } | null> {
  const isYouTube =
    url.includes("youtube.com/watch") ||
    url.includes("youtu.be/") ||
    url.includes("youtube.com/shorts/");

  if (!isYouTube) return null;

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const response = await fetch(oembedUrl, {
      headers: { "User-Agent": DEFAULT_USER_AGENT },
      signal: AbortSignal.timeout(4000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { title?: string; author_name?: string };
    if (data?.title) {
      return {
        title: data.title,
        author: data.author_name || "",
      };
    }
  } catch {
    // Fallback if oEmbed times out
  }
  return null;
}

export class MusicProviderManager {
  private trackCache = new Map<number, CachedTrackInfo>();
  private nextNumericId = 100000;

  private generateNumericId(songId: string): number {
    let hash = 0;
    for (let i = 0; i < songId.length; i++) {
      hash = (hash << 5) - hash + songId.charCodeAt(i);
      hash |= 0;
    }
    const positiveId = Math.abs(hash);
    return positiveId === 0 ? this.nextNumericId++ : positiveId;
  }

  /**
   * Searches for music tracks. Supports text queries and YouTube links.
   */
  async search(query: string, offset = 0): Promise<z.infer<typeof RawSearchResponseSchema>> {
    try {
      const { q, offset: validOffset } = SearchParamsSchema.parse({
        q: query,
        offset,
      });

      let cleanQuery = q.trim();

      // Check if user entered a direct YouTube URL
      const ytInfo = await resolveYouTubeUrl(cleanQuery);
      if (ytInfo) {
        // Clean video title (e.g. remove "Official Music Video", "(Audio)", etc.)
        cleanQuery = ytInfo.title
          .replace(/\[.*?\]/g, "")
          .replace(/\(.*?\)/g, "")
          .replace(/official\s*(music\s*)?video/gi, "")
          .replace(/official\s*audio/gi, "")
          .replace(/hd|4k/gi, "")
          .trim();
      }

      const page = Math.floor(validOffset / 20) + 1;
      const searchUrl = new URL("https://www.jiosaavn.com/api.php");
      searchUrl.searchParams.set("__call", "search.getResults");
      searchUrl.searchParams.set("_format", "json");
      searchUrl.searchParams.set("_marker", "0");
      searchUrl.searchParams.set("api_version", "4");
      searchUrl.searchParams.set("ctx", "web6dot0");
      searchUrl.searchParams.set("n", "20");
      searchUrl.searchParams.set("p", page.toString());
      searchUrl.searchParams.set("q", cleanQuery);

      const response = await fetch(searchUrl.toString(), {
        headers: {
          "User-Agent": DEFAULT_USER_AGENT,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(6000),
      });

      if (!response.ok) {
        throw new Error(`Catalog search failed with status: ${response.status}`);
      }

      const rawData = (await response.json()) as {
        results?: Array<{
          id: string;
          title: string;
          subtitle?: string;
          image?: string;
          more_info?: {
            music?: string;
            album?: string;
            duration?: string;
            encrypted_media_url?: string;
            artistMap?: { primary_artists?: Array<{ name: string }> };
            release_date?: string;
          };
        }>;
        total?: number | string;
      };

      const results = rawData.results || [];
      const totalResults = typeof rawData.total === "number" ? rawData.total : parseInt(rawData.total || "0", 10);

      const items: TrackType[] = [];

      for (let i = 0; i < results.length; i++) {
        const song = results[i];
        if (!song || !song.id) continue;

        const numericId = this.generateNumericId(song.id);
        const title = decodeHtmlEntities(song.title);
        const artist = decodeHtmlEntities(
          song.more_info?.music ||
            song.more_info?.artistMap?.primary_artists?.[0]?.name ||
            song.subtitle ||
            "Various Artists"
        );
        const durationSec = parseInt(song.more_info?.duration || "180", 10) || 180;
        const albumTitle = decodeHtmlEntities(song.more_info?.album || title);

        const baseImage =
          song.image ||
          "https://c.saavncdn.com/default/album-150x150.jpg";

        const smallImage = baseImage.replace(/150x150/, "50x50");
        const thumbImage = baseImage.replace(/50x50|500x500/, "150x150");
        const largeImage = baseImage.replace(/50x50|150x150/, "500x500");

        // Save to cache for stream retrieval
        this.trackCache.set(numericId, {
          numericId,
          songId: song.id,
          title,
          artist,
          duration: durationSec,
          encryptedMediaUrl: song.more_info?.encrypted_media_url,
          imageUrl: largeImage,
        });

        items.push({
          id: numericId,
          title,
          duration: durationSec,
          parental_warning: false,
          track_number: i + 1,
          performer: {
            name: artist,
            id: i + 1,
          },
          album: {
            id: `album-${numericId}`,
            title: albumTitle,
            duration: durationSec,
            parental_warning: false,
            release_date_original: song.more_info?.release_date || new Date().toISOString().slice(0, 10),
            image: {
              small: smallImage,
              thumbnail: thumbImage,
              large: largeImage,
              back: null,
            },
          },
        });
      }

      const formattedResponse = {
        data: {
          tracks: {
            limit: 20,
            offset: validOffset,
            total: totalResults || items.length,
            items,
          },
        },
      };

      return RawSearchResponseSchema.parse(formattedResponse);
    } catch (error) {
      console.error("[MusicProviderManager] Search error:", error);
      throw new Error(`Search failed: ${error instanceof Error ? error.message : "Unknown error"}`, {
        cause: error,
      });
    }
  }

  /**
   * Resolves a track ID into a direct audio stream URL
   */
  async stream(trackId: number, fallbackTrackName?: string): Promise<z.infer<typeof StreamResponseSchema>> {
    try {
      const { id } = TrackParamsSchema.parse({ id: trackId });

      // Look up track in in-memory cache
      let trackInfo = this.trackCache.get(id);

      // If not in cache (e.g. server restarted or instance changed), attempt fallback resolution
      if (!trackInfo || !trackInfo.encryptedMediaUrl) {
        console.log(`[MusicProviderManager] Track ${id} not in memory cache, attempting fallback resolution with track name: ${fallbackTrackName}`);
        if (fallbackTrackName) {
          // Clean track name for searching (e.g. remove "Artist - " prefix)
          const cleanName = fallbackTrackName.includes("-")
            ? fallbackTrackName.split("-").slice(1).join("-").trim()
            : fallbackTrackName.trim();

          await this.search(cleanName || fallbackTrackName);
          trackInfo = this.trackCache.get(id);

          // If still not matched by numericId, take the top result from search
          if (!trackInfo || !trackInfo.encryptedMediaUrl) {
            const allCached = Array.from(this.trackCache.values());
            if (allCached.length > 0) {
              trackInfo = allCached[allCached.length - 1];
            }
          }
        }
      }

      let streamUrl = trackInfo?.streamUrl;

      if (!streamUrl && trackInfo?.encryptedMediaUrl) {
        streamUrl = decryptMediaUrl(trackInfo.encryptedMediaUrl);
        trackInfo.streamUrl = streamUrl;
      }

      if (!streamUrl) {
        throw new Error(`Could not resolve stream URL for track ${id} (${fallbackTrackName || "unknown"})`);
      }

      const response = {
        success: true,
        data: {
          url: streamUrl,
        },
      };

      return StreamResponseSchema.parse(response);
    } catch (error) {
      console.error("[MusicProviderManager] Stream error:", error);
      throw new Error(`Stream failed: ${error instanceof Error ? error.message : "Unknown error"}`, {
        cause: error,
      });
    }
  }
}

// Export singleton instance
export const MUSIC_PROVIDER_MANAGER = new MusicProviderManager();

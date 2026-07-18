import { YoutubeTranscript } from "youtube-transcript";
import type { GroqSegment } from "./groq";

export type YouTubeTranscriptResult = {
  segments: GroqSegment[];
  duration: number;
  title: string;
  thumbnail: string;
};

export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

const INNERTUBE_CLIENTS = [
  {
    clientName: "WEB",
    clientVersion: "2.20250717.00.00",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    apiKey: "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
    context: {
      client: {
        clientName: "WEB",
        clientVersion: "2.20250717.00.00",
        hl: "en",
        gl: "US",
      },
    },
  },
  {
    clientName: "MWEB",
    clientVersion: "2.20250717.00.00",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
    apiKey: "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
    context: {
      client: {
        clientName: "MWEB",
        clientVersion: "2.20250717.00.00",
        hl: "en",
        gl: "US",
      },
    },
  },
  {
    clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    clientVersion: "2.0",
    userAgent: "Mozilla/5.0",
    apiKey: "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
    context: {
      client: {
        clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
        clientVersion: "2.0",
        hl: "en",
        gl: "US",
      },
      thirdParty: {
        embedUrl: "https://www.youtube.com",
      },
    },
  },
];

async function fetchCaptionTracksViaInnerTube(
  videoId: string
): Promise<{ baseUrl: string; languageCode: string }[] | null> {
  for (const client of INNERTUBE_CLIENTS) {
    try {
      const url = `https://www.youtube.com/youtubei/v1/player?key=${client.apiKey}&prettyPrint=false`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": client.userAgent,
        },
        body: JSON.stringify({
          context: client.context,
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const tracks =
        data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(tracks) && tracks.length > 0) {
        return tracks;
      }
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchCaptionTracksViaPageScrape(
  videoId: string
): Promise<{ baseUrl: string; languageCode: string }[] | null> {
  try {
    const resp = await fetch(
      `https://www.youtube.com/watch?v=${videoId}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
      }
    );
    const html = await resp.text();
    if (html.includes('class="g-recaptcha"')) return null;
    const m = html.match(/"captionTracks":\s*(\[.*?\])/);
    if (m) {
      return JSON.parse(m[1]);
    }
  } catch {
    // ignore
  }
  return null;
}

async function fetchCaptionTracks(
  videoId: string
): Promise<{ baseUrl: string; languageCode: string }[] | null> {
  const tracks = await fetchCaptionTracksViaInnerTube(videoId);
  if (tracks && tracks.length > 0) return tracks;
  return fetchCaptionTracksViaPageScrape(videoId);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function parseTranscriptXml(xml: string, lang: string) {
  const results: { text: string; duration: number; offset: number; lang: string }[] = [];

  const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let match;
  while ((match = pRegex.exec(xml)) !== null) {
    const startMs = parseInt(match[1], 10);
    const durMs = parseInt(match[2], 10);
    const inner = match[3];
    let text = "";
    const sRegex = /<s[^>]*>([^<]*)<\/s>/g;
    let sMatch;
    while ((sMatch = sRegex.exec(inner)) !== null) {
      text += sMatch[1];
    }
    if (!text) {
      text = inner.replace(/<[^>]+>/g, "");
    }
    text = decodeEntities(text).trim();
    if (text) {
      results.push({ text, duration: durMs, offset: startMs, lang });
    }
  }
  if (results.length > 0) return results;

  const classicRegex =
    /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
  const classicResults = [...xml.matchAll(classicRegex)];
  return classicResults.map((r) => ({
    text: decodeEntities(r[3]),
    duration: parseFloat(r[2]) * 1000,
    offset: parseFloat(r[1]) * 1000,
    lang,
  }));
}

async function fetchTranscriptText(
  baseUrl: string,
  lang: string
): Promise<{ text: string; duration: number; offset: number; lang: string }[]> {
  const url = new URL(baseUrl);
  if (!url.hostname.endsWith("youtube.com")) {
    throw new Error("Invalid caption URL");
  }

  const resp = await fetch(baseUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    },
  });
  if (!resp.ok) {
    throw new Error(`Caption fetch failed: ${resp.status}`);
  }
  const xml = await resp.text();
  return parseTranscriptXml(xml, lang);
}

async function fetchTranscriptDirectly(
  videoId: string
): Promise<{ text: string; duration: number; offset: number; lang: string }[]> {
  const tracks = await fetchCaptionTracks(videoId);
  if (!tracks || tracks.length === 0) {
    throw new Error("No caption tracks found");
  }
  const track = tracks[0];
  return fetchTranscriptText(track.baseUrl, track.languageCode);
}

async function fetchTranscriptViaLibrary(
  videoId: string
): Promise<{ text: string; duration: number; offset: number; lang: string }[]> {
  const items = await YoutubeTranscript.fetchTranscript(videoId);
  return items.map((item) => ({
    text: item.text,
    duration: item.duration,
    offset: item.offset,
    lang: item.lang ?? "en",
  }));
}

async function fetchTranscriptSmart(
  videoId: string
): Promise<{ text: string; duration: number; offset: number; lang: string }[]> {
  let lastError: Error | null = null;

  try {
    const result = await fetchTranscriptDirectly(videoId);
    if (result.length > 0) return result;
  } catch (e) {
    lastError = e instanceof Error ? e : new Error(String(e));
  }

  try {
    const result = await fetchTranscriptViaLibrary(videoId);
    if (result.length > 0) return result;
  } catch (e) {
    lastError = e instanceof Error ? e : new Error(String(e));
  }

  throw lastError || new Error("Failed to fetch transcript");
}

export async function fetchYouTubeTranscript(
  videoId: string
): Promise<YouTubeTranscriptResult> {
  const [rawTranscript, metadata] = await Promise.all([
    fetchTranscriptSmart(videoId).catch((e) => {
      throw e;
    }),
    fetchVideoMetadata(videoId),
  ]);

  if (rawTranscript.length === 0) {
    throw new Error("No captions available for this video");
  }

  const mergedSegments: GroqSegment[] = [];
  let currentText = "";
  let currentStart = 0;
  let currentEnd = 0;

  for (const item of rawTranscript) {
    const text = item.text.trim();
    if (!text) continue;

    const segStart = item.offset / 1000;
    const segEnd = (item.offset + item.duration) / 1000;

    if (currentText === "") {
      currentStart = segStart;
    }

    currentText += (currentText ? " " : "") + text;
    currentEnd = segEnd;

    if (/[.!?]$/.test(text) || mergedSegments.length >= 30) {
      mergedSegments.push({
        start: Math.round(currentStart * 100) / 100,
        end: Math.round(currentEnd * 100) / 100,
        text: currentText.trim(),
      });
      currentText = "";
    }
  }

  if (currentText.trim()) {
    mergedSegments.push({
      start: Math.round(currentStart * 100) / 100,
      end: Math.round(currentEnd * 100) / 100,
      text: currentText.trim(),
    });
  }

  const duration = mergedSegments[mergedSegments.length - 1].end;

  return {
    segments: mergedSegments,
    duration,
    title: metadata.title,
    thumbnail: metadata.thumbnail,
  };
}

async function fetchVideoMetadata(
  videoId: string
): Promise<{ title: string; thumbnail: string }> {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(oembedUrl);
    if (res.ok) {
      const data = await res.json();
      return {
        title: data.title || "YouTube Video",
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      };
    }
  } catch {}
  return {
    title: "YouTube Video",
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

export function getYouTubeDownloadUrl(
  videoId: string,
  start: number,
  end: number
): string {
  const serverUrl = process.env.NEXT_PUBLIC_DOWNLOAD_SERVER_URL || "";
  return `${serverUrl}/api/download`;
}

export function buildYouTubeEmbedUrl(
  videoId: string,
  start: number,
  end: number
): string {
  const params = new URLSearchParams({
    start: String(Math.floor(start)),
    end: String(Math.ceil(end)),
  });
  return `https://www.youtube.com/embed/${videoId}?${params}`;
}

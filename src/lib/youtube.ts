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

export async function fetchYouTubeTranscript(
  videoId: string
): Promise<YouTubeTranscriptResult> {
  const [rawTranscript, metadata] = await Promise.all([
    fetchTranscriptClient(videoId),
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

const CORS_PROXIES = [
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

async function fetchViaProxy(url: string): Promise<string> {
  for (const proxyFn of CORS_PROXIES) {
    try {
      const proxyUrl = proxyFn(url);
      const res = await fetch(proxyUrl);
      if (res.ok) {
        const text = await res.text();
        if (text.length > 1000) return text;
      }
    } catch {
      continue;
    }
  }
  throw new Error("All proxies failed");
}

async function fetchTranscriptClient(
  videoId: string
): Promise<{ text: string; duration: number; offset: number }[]> {
  let lastError: Error | null = null;

  try {
    const result = await fetchTranscriptViaPage(videoId);
    if (result.length > 0) return result;
  } catch (e) {
    lastError = e instanceof Error ? e : new Error(String(e));
  }

  try {
    const result = await fetchTranscriptViaPage(videoId, true);
    if (result.length > 0) return result;
  } catch (e) {
    lastError = e instanceof Error ? e : new Error(String(e));
  }

  throw lastError || new Error("Failed to fetch transcript");
}

async function fetchTranscriptViaPage(
  videoId: string,
  useProxy = false
): Promise<{ text: string; duration: number; offset: number }[]> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=en`;
  const html = useProxy
    ? await fetchViaProxy(watchUrl)
    : await fetch(watchUrl).then((r) => r.text());

  if (html.includes('class="g-recaptcha"')) {
    throw new Error("YouTube is requiring captcha verification");
  }

  const captionTracks = extractCaptionTracks(html);
  if (!captionTracks || captionTracks.length === 0) {
    throw new Error("No caption tracks found in page");
  }

  const track = captionTracks[0];
  const captionUrl = track.baseUrl;

  const xml = useProxy
    ? await fetchViaProxy(captionUrl)
    : await fetch(captionUrl).then((r) => r.text());

  return parseTranscriptXml(xml);
}

function extractCaptionTracks(
  html: string
): { baseUrl: string; languageCode: string }[] | null {
  const m = html.match(/"captionTracks":\s*(\[.*?\])/);
  if (m) {
    try {
      return JSON.parse(m[1]);
    } catch {}
  }

  const playerMatch = html.match(
    /var ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});/
  );
  if (playerMatch) {
    try {
      const playerData = JSON.parse(playerMatch[1]);
      const tracks =
        playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(tracks) && tracks.length > 0) {
        return tracks;
      }
    } catch {}
  }

  return null;
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

function parseTranscriptXml(
  xml: string
): { text: string; duration: number; offset: number }[] {
  const results: {
    text: string;
    duration: number;
    offset: number;
  }[] = [];

  const pRegex =
    /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
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
      results.push({ text, duration: durMs, offset: startMs });
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
  }));
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

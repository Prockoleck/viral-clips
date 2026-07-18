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
  const [transcriptData, metadata] = await Promise.all([
    fetchTranscript(videoId),
    fetchVideoMetadata(videoId),
  ]);

  const segments = parseTimedText(transcriptData);
  if (segments.length === 0) {
    throw new Error("No captions available for this video");
  }

  const duration = segments[segments.length - 1].end;

  return {
    segments,
    duration,
    title: metadata.title,
    thumbnail: metadata.thumbnail,
  };
}

async function fetchTranscript(videoId: string): Promise<unknown> {
  const langs = ["en", "en-US", "en-GB"];
  let lastError: Error | null = null;

  for (const lang of langs) {
    try {
      const timedTextUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`;
      const res = await fetch(timedTextUrl);
      if (res.ok) {
        const data = await res.json();
        if (data.events && data.events.length > 0) return data;
      }

      const asrUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&kind=asr&fmt=json3`;
      const asrRes = await fetch(asrUrl);
      if (asrRes.ok) {
        const data = await asrRes.json();
        if (data.events && data.events.length > 0) return data;
      }
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }

  const listUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&type=list`;
  const listRes = await fetch(listUrl);
  if (listRes.ok) {
    const listText = await listRes.text();
    const langMatch = listText.match(/lang_code="([^"]+)"/);
    if (langMatch) {
      const fallbackUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${langMatch[1]}&fmt=json3`;
      const fallbackRes = await fetch(fallbackUrl);
      if (fallbackRes.ok) {
        const data = await fallbackRes.json();
        if (data.events && data.events.length > 0) return data;
      }
    }
  }

  throw new Error(
    lastError?.message || "No captions available for this video"
  );
}

function parseTimedText(data: unknown): GroqSegment[] {
  const d = data as { events?: Array<{ tStartMs: number; dDurationMs: number; segs?: Array<{ utf8: string }> }> };
  if (!d.events) return [];

  const segments: GroqSegment[] = [];
  let currentText = "";
  let currentStart = 0;
  let currentEnd = 0;

  for (const event of d.events) {
    if (!event.segs) continue;

    const text = event.segs
      .map((s) => s.utf8 || "")
      .join("")
      .trim();
    if (!text) continue;

    const eventStart = event.tStartMs / 1000;
    const eventEnd = (event.tStartMs + event.dDurationMs) / 1000;

    if (currentText === "") {
      currentStart = eventStart;
    }

    currentText += (currentText ? " " : "") + text;
    currentEnd = eventEnd;

    if (/[.!?]$/.test(text)) {
      segments.push({
        start: Math.round(currentStart * 100) / 100,
        end: Math.round(currentEnd * 100) / 100,
        text: currentText.trim(),
      });
      currentText = "";
    }
  }

  if (currentText.trim()) {
    segments.push({
      start: Math.round(currentStart * 100) / 100,
      end: Math.round(currentEnd * 100) / 100,
      text: currentText.trim(),
    });
  }

  return segments;
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

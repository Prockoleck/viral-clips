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

export async function fetchYouTubeTranscript(
  videoId: string
): Promise<YouTubeTranscriptResult> {
  const [rawTranscript, metadata] = await Promise.all([
    YoutubeTranscript.fetchTranscript(videoId).catch(() => []),
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

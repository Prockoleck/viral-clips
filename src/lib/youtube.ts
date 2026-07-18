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

function parseTimestamp(ts: string): number {
  const parts = ts.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function dedupeTriplicatedText(text: string): string {
  const words = text.split(/\s+/);
  if (words.length < 6) return text;

  for (let unitLen = 1; unitLen <= Math.floor(words.length / 3); unitLen++) {
    const unit = words.slice(0, unitLen).join(" ").toLowerCase();
    let allMatch = true;
    for (let rep = 1; rep < 3; rep++) {
      const candidate = words.slice(rep * unitLen, (rep + 1) * unitLen).join(" ").toLowerCase();
      if (candidate !== unit) { allMatch = false; break; }
    }
    if (allMatch) return words.slice(0, unitLen).join(" ");
  }
  return text;
}

function parseTranscriptText(raw: string): { text: string; start: number; end: number }[] {
  const lines = raw.split("\n").filter((l) => l.trim());
  const entries: { text: string; start: number }[] = [];

  for (const line of lines) {
    const m = line.match(/^\[(\d+:\d+(?::\d+)?)\]\s*(.+)$/);
    if (!m) continue;
    entries.push({ start: parseTimestamp(m[1]), text: dedupeTriplicatedText(m[2].trim()) });
  }

  const deduped: { text: string; start: number }[] = [];
  for (const entry of entries) {
    if (deduped.length === 0 || entry.text !== deduped[deduped.length - 1].text) {
      deduped.push(entry);
    }
  }

  const segments: { text: string; start: number; end: number }[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const nextStart = i < deduped.length - 1 ? deduped[i + 1].start : deduped[i].start + 5;
    segments.push({
      text: deduped[i].text,
      start: deduped[i].start,
      end: nextStart,
    });
  }

  return segments;
}

export async function fetchYouTubeTranscript(
  videoId: string
): Promise<YouTubeTranscriptResult> {
  const [rawText, metadata] = await Promise.all([
    fetchTranscriptViaApi(videoId),
    fetchVideoMetadata(videoId),
  ]);

  const parsed = parseTranscriptText(rawText);
  if (parsed.length === 0) {
    throw new Error("No captions available for this video");
  }

  const mergedSegments: GroqSegment[] = [];
  let currentText = "";
  let currentStart = 0;
  let currentEnd = 0;

  for (const item of parsed) {
    const text = item.text.replace(/^&gt;&gt;\s*/, "").trim();
    if (!text || text === "[music]" || text === "[sighs]" || text === "[snorts]" || text.startsWith("[")) continue;

    if (currentText === "") {
      currentStart = item.start;
    }

    currentText += (currentText ? " " : "") + text;
    currentEnd = item.end;

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

async function fetchTranscriptViaApi(videoId: string): Promise<string> {
  const res = await fetch(
    `https://youtube-transcript.ai/transcript/${videoId}.txt`
  );
  if (!res.ok) {
    throw new Error(`Transcript fetch failed: ${res.status}`);
  }
  const text = await res.text();
  const transcriptStart = text.indexOf("## Transcript");
  if (transcriptStart === -1) {
    return text;
  }
  return text.substring(transcriptStart + "## Transcript".length).trim();
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

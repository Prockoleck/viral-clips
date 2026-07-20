import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const INSTANCES = [
  "https://inv.riverside.rocks",
  "https://yewtu.be",
  "https://invidious.snopyta.org",
  "https://inv.tux.pizza",
  "https://invidious.privacydev.net",
  "https://invidious.private.coffee",
];

async function fetchInvidious(videoId: string): Promise<any> {
  for (const base of INSTANCES) {
    try {
      const res = await fetch(`${base}/api/v1/videos/${videoId}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data || data.error) continue;
      return data;
    } catch {
      continue;
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    const m = url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
    if (!m) {
      return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });
    }

    const data = await fetchInvidious(m[1]);
    if (!data) {
      return NextResponse.json({ error: "All instances failed" }, { status: 502 });
    }

    const duration = data.lengthSeconds ?? 0;
    const streams = data.formatStreams ?? [];
    const adaptive = data.adaptiveFormats ?? [];

    // Muxed (formatStreams have both video+audio)
    if (streams.length > 0) {
      const best = streams.sort((a: any, b: any) => (b.height || 0) - (a.height || 0))[0];
      return NextResponse.json({
        mode: "muxed" as const,
        streamUrl: best.url,
        duration,
        fileSize: 0,
        quality: `${best.height ?? 360}p`,
      });
    }

    // Adaptive
    const vStreams = adaptive.filter((s: any) => s.type.startsWith("video"));
    const aStreams = adaptive.filter((s: any) => s.type.startsWith("audio"));

    if (vStreams.length === 0 || aStreams.length === 0) {
      return NextResponse.json({ error: "No suitable streams" }, { status: 400 });
    }

    const bestV = vStreams.sort((a: any, b: any) => (b.height || 0) - (a.height || 0))[0];
    const bestA = aStreams.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];

    return NextResponse.json({
      mode: "adaptive" as const,
      videoUrl: bestV.url,
      audioUrl: bestA.url,
      duration,
      videoQuality: `${bestV.height ?? 360}p`,
      videoSize: 0,
      audioSize: 0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown";
    console.error("Invidious error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

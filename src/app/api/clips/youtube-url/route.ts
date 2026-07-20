import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.syncpundit.io",
  "https://pipedapi.moomoo.me",
  "https://pipedapi.adminforge.de",
  "https://piped-api.lunar.icu",
  "https://pipedapi.r4fo.com",
  "https://pipedapi.leptons.xyz",
  "https://pipedapi.colinslegacy.com",
];

async function fetchPiped(videoId: string): Promise<any> {
  for (const base of PIPED_INSTANCES) {
    try {
      const res = await fetch(`${base}/streams/${videoId}`, {
        signal: AbortSignal.timeout(10000),
        headers: { Accept: "application/json" },
      });
      if (!res.ok) continue;
      return res.json();
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

    const data = await fetchPiped(m[1]);
    if (!data) {
      return NextResponse.json({ error: "All Piped instances failed" }, { status: 502 });
    }

    const duration = data.duration ?? 0;

    // Try muxed (video+audio combined) — videoOnly: false
    const muxed = data.videoStreams?.filter?.((s: any) => !s.videoOnly) ?? [];
    if (muxed.length > 0) {
      const best = muxed.sort((a: any, b: any) => {
        const qa = parseInt(a.quality) || 0;
        const qb = parseInt(b.quality) || 0;
        return qb - qa;
      })[0];

      return NextResponse.json({
        mode: "muxed" as const,
        streamUrl: best.url,
        duration,
        fileSize: 0,
        quality: best.quality ?? "unknown",
      });
    }

    // Adaptive (separate video + audio)
    const vStreams = data.videoStreams?.filter?.((s: any) => s.videoOnly) ?? [];
    const aStreams = data.audioStreams ?? [];

    if (vStreams.length === 0 || aStreams.length === 0) {
      return NextResponse.json({ error: "No suitable streams" }, { status: 400 });
    }

    const bestV = vStreams.sort((a: any, b: any) => {
      const qa = parseInt(a.quality) || 0;
      const qb = parseInt(b.quality) || 0;
      return qb - qa;
    })[0];

    const bestA = aStreams.sort((a: any, b: any) => {
      const qa = parseInt(a.quality) || 0;
      const qb = parseInt(b.quality) || 0;
      return qb - qa;
    })[0];

    return NextResponse.json({
      mode: "adaptive" as const,
      videoUrl: bestV.url,
      audioUrl: bestA.url,
      duration,
      videoQuality: bestV.quality ?? "unknown",
      videoSize: 0,
      audioSize: 0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown";
    console.error("Piped error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

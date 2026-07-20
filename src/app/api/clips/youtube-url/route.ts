import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const YTDL_SERVER = process.env.YTDL_SERVER_URL || "";

let innertubePromise: Promise<any> | null = null;

async function getInnertube() {
  if (!innertubePromise) {
    innertubePromise = (async () => {
      const { Innertube } = await import("youtubei.js");
      return Innertube.create({ lang: "en", location: "US" });
    })();
  }
  return innertubePromise;
}

async function tryYoutubei(videoId: string): Promise<NextResponse | null> {
  try {
    const innertube = await getInnertube();

    let info = await innertube.getInfo(videoId, { client: "ANDROID" as any });
    let sd = info.streaming_data;

    if (!sd?.formats?.length && !sd?.adaptive_formats?.length) {
      info = await innertube.getInfo(videoId);
      sd = info.streaming_data;
    }
    if (!sd) return null;

    const duration = info.basic_info.duration ?? 0;
    const player = innertube.session.player;

    async function url(f: any): Promise<string | null> {
      if (f.url) return f.url;
      if (f.decipher) try { return await f.decipher(player); } catch { return null; }
      return null;
    }

    if (sd.formats?.length) {
      const f = [...sd.formats].sort((a: any, b: any) => (b.width || 0) - (a.width || 0))[0];
      const u = await url(f);
      if (u) return NextResponse.json({ mode: "muxed", streamUrl: u, duration, fileSize: f.content_length ?? 0, quality: f.quality_label ?? "unknown" });
    }

    const v = sd.adaptive_formats?.filter((f: any) => f.hasVideo && !f.hasAudio)
      .sort((a: any, b: any) => (b.width || 0) - (a.width || 0))[0];
    const a = sd.adaptive_formats?.filter((f: any) => f.hasAudio && !f.hasVideo)
      .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];

    if (v && a) {
      const [vu, au] = await Promise.all([url(v), url(a)]);
      if (vu && au) return NextResponse.json({ mode: "adaptive", videoUrl: vu, audioUrl: au, duration, videoQuality: v.quality_label ?? `${v.width ?? 360}p`, videoSize: v.content_length ?? 0, audioSize: a.content_length ?? 0 });
    }
  } catch {}
  return null;
}

async function tryReplit(videoId: string) {
  if (!YTDL_SERVER) return null;
  try {
    const res = await fetch(`${YTDL_SERVER}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${videoId}` }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.streamUrl) return null;
    return NextResponse.json({
      mode: "muxed",
      streamUrl: data.streamUrl,
      duration: data.duration ?? 0,
      fileSize: 0,
      quality: data.resolution ?? "unknown",
    });
  } catch {}
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string")
      return NextResponse.json({ error: "Missing url" }, { status: 400 });

    const m = url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
    if (!m)
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });

    const videoId = m[1];

    const result = await tryYoutubei(videoId);
    if (result) return result;

    const fallback = await tryReplit(videoId);
    if (fallback) return fallback;

    return NextResponse.json(
      { error: "No streaming data. Set YTDL_SERVER_URL env var for full coverage." },
      { status: 400 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

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

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string")
      return NextResponse.json({ error: "Missing url" }, { status: 400 });

    const m = url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
    if (!m) return NextResponse.json({ error: "Invalid URL" }, { status: 400 });

    const innertube = await getInnertube();

    let info = await innertube.getInfo(m[1], { client: "ANDROID" as any });
    let sd = info.streaming_data;

    if (!sd?.formats?.length && !sd?.adaptive_formats?.length) {
      info = await innertube.getInfo(m[1]);
      sd = info.streaming_data;
    }

    if (!sd) return NextResponse.json({ error: "No streaming data" }, { status: 400 });

    const duration = info.basic_info.duration ?? 0;
    const player = innertube.session.player;

    async function decipher(f: any): Promise<string | null> {
      if (f.url) return f.url;
      if (f.decipher) try { return await f.decipher(player); } catch { return null; }
      return null;
    }

    // Muxed
    if (sd.formats?.length) {
      const f = [...sd.formats].sort((a: any, b: any) => (b.width || 0) - (a.width || 0))[0];
      const streamUrl = await decipher(f);
      if (!streamUrl) return NextResponse.json({ error: "No URL" }, { status: 500 });
      return NextResponse.json({
        mode: "muxed", streamUrl, duration,
        fileSize: f.content_length ?? 0,
        quality: f.quality_label ?? "unknown",
      });
    }

    // Adaptive
    const v = sd.adaptive_formats.filter((f: any) => f.hasVideo && !f.hasAudio)
      .sort((a: any, b: any) => (b.width || 0) - (a.width || 0))[0];
    const a = sd.adaptive_formats.filter((f: any) => f.hasAudio && !f.hasVideo)
      .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];

    if (!v || !a) return NextResponse.json({ error: "No adaptive formats" }, { status: 400 });

    const [vu, au] = await Promise.all([decipher(v), decipher(a)]);
    if (!vu || !au) return NextResponse.json({ error: "No URL" }, { status: 500 });

    return NextResponse.json({
      mode: "adaptive", videoUrl: vu, audioUrl: au, duration,
      videoQuality: v.quality_label ?? `${v.width ?? 360}p`,
      videoSize: v.content_length ?? 0,
      audioSize: a.content_length ?? 0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown err";
    console.error("youtubei.js error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

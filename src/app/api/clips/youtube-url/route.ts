import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

let innertubePromise: Promise<any> | null = null;

async function getInnertube() {
  if (!innertubePromise) {
    innertubePromise = (async () => {
      const { Innertube, Platform } = await import("youtubei.js");

      Platform.shim.eval = async (data: any) => {
        const vm = await import("vm");
        const wrappedCode = `(function() {\n${data.output}\n})`;
        const script = new vm.Script(wrappedCode, { filename: "yt-player.js" });
        const fn = script.runInNewContext({}, { timeout: 5000 });
        return fn();
      };

      return Innertube.create({
        lang: "en",
        location: "US",
      });
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
    if (!m)
      return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });

    const innertube = await getInnertube();
    const info = await innertube.getBasicInfo(m[1]);
    const sd = info.streaming_data;
    if (!sd)
      return NextResponse.json({ error: "No streaming data" }, { status: 400 });

    const player = innertube.session.player;
    const duration = info.basic_info.duration ?? 0;

    // Muxed format (video+audio combined)
    if (sd.formats?.length) {
      const f = info.chooseFormat({ type: "video+audio", format: "mp4", quality: "best" });
      return NextResponse.json({
        mode: "muxed" as const,
        streamUrl: await f.decipher(player),
        duration,
        fileSize: f.content_length ?? 0,
        quality: f.quality_label ?? "unknown",
      });
    }

    // Adaptive formats (separate video + audio)
    if (sd.adaptive_formats?.length) {
      const vf = info.chooseFormat({ type: "video", format: "mp4", quality: "best" });
      const af = info.chooseFormat({ type: "audio", format: "any", quality: "best" });
      const [vu, au] = await Promise.all([vf.decipher(player), af.decipher(player)]);
      return NextResponse.json({
        mode: "adaptive" as const,
        videoUrl: vu, audioUrl: au, duration,
        videoQuality: vf.quality_label ?? "unknown",
        videoSize: vf.content_length ?? 0,
        audioSize: af.content_length ?? 0,
      });
    }

    return NextResponse.json({ error: "No streaming data" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown";
    console.error("YouTube URL extraction error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

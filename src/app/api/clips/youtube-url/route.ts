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

async function extractFormats(innertube: any, videoId: string, client: string) {
  const info = await innertube.getInfo(videoId, { client: client as any });
  const sd = info.streaming_data;
  if (!sd) return null;

  const player = innertube.session.player;
  const duration = info.basic_info.duration ?? 0;

  // Try muxed
  if (sd.formats?.length > 0) {
    const format = info.chooseFormat({ type: "video+audio", format: "mp4", quality: "best" });
    const streamUrl = await format.decipher(player);
    return { mode: "muxed" as const, streamUrl, duration, fileSize: format.content_length ?? 0, quality: format.quality_label ?? "unknown" };
  }

  // Adaptive
  if (sd.adaptive_formats?.length > 0) {
    const videoFormat = info.chooseFormat({ type: "video", format: "mp4", quality: "best" });
    const audioFormat = info.chooseFormat({ type: "audio", format: "any", quality: "best" });
    const [videoUrl, audioUrl] = await Promise.all([
      videoFormat.decipher(player),
      audioFormat.decipher(player),
    ]);
    return {
      mode: "adaptive" as const,
      videoUrl, audioUrl, duration,
      videoQuality: videoFormat.quality_label ?? "unknown",
      videoSize: videoFormat.content_length ?? 0,
      audioSize: audioFormat.content_length ?? 0,
    };
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    const videoIdMatch = url.match(
      /(?:youtu\.be\/|v=|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/
    );
    if (!videoIdMatch) {
      return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });
    }
    const videoId = videoIdMatch[1];

    const innertube = await getInnertube();

    // Try multiple clients
    for (const client of ["ANDROID", "WEB", "TV_EMBEDDED", "IOS"]) {
      try {
        const result = await extractFormats(innertube, videoId, client);
        if (result) return NextResponse.json(result);
      } catch {
        continue;
      }
    }

    return NextResponse.json({ error: "No streaming data available for this video" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("YouTube URL extraction error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

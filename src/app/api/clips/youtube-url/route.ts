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
        generate_session_locally: true,
      });
    })();
  }
  return innertubePromise;
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
    const info = await innertube.getInfo(videoId);

    const streamingData = info.streaming_data;
    if (!streamingData) {
      return NextResponse.json({ error: "No streaming data available" }, { status: 400 });
    }

    const player = innertube.session.player;
    const duration = info.basic_info.duration ?? 0;

    // Try muxed format first (simpler, single stream)
    const muxedFormats = streamingData.formats;
    if (muxedFormats && muxedFormats.length > 0) {
      const format = info.chooseFormat({
        type: "video+audio",
        format: "mp4",
        quality: "best",
      });

      const streamUrl = await format.decipher(player);
      return NextResponse.json({
        mode: "muxed" as const,
        streamUrl,
        duration,
        fileSize: format.content_length ?? 0,
        quality: format.quality_label ?? "unknown",
      });
    }

    // Fall back to adaptive formats (separate video + audio)
    const adaptiveFormats = streamingData.adaptive_formats;
    if (!adaptiveFormats || adaptiveFormats.length === 0) {
      return NextResponse.json({ error: "No formats available" }, { status: 400 });
    }

    const videoFormat = info.chooseFormat({
      type: "video",
      format: "mp4",
      quality: "best",
    });

    const audioFormat = info.chooseFormat({
      type: "audio",
      format: "any",
      quality: "best",
    });

    const [videoUrl, audioUrl] = await Promise.all([
      videoFormat.decipher(player),
      audioFormat.decipher(player),
    ]);

    return NextResponse.json({
      mode: "adaptive" as const,
      videoUrl,
      audioUrl,
      duration,
      videoQuality: videoFormat.quality_label ?? "unknown",
      videoSize: videoFormat.content_length ?? 0,
      audioSize: audioFormat.content_length ?? 0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("YouTube URL extraction error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

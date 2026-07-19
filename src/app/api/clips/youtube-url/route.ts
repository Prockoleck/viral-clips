import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

let innertubePromise: Promise<any> | null = null;

async function getInnertube() {
  if (!innertubePromise) {
    innertubePromise = (async () => {
      const { Innertube, Platform } = await import("youtubei.js");

      Platform.shim.eval = async (data: any) => {
        return new Function(`return (${data.output})`)();
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
    const { url, start, end } = await req.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }
    if (typeof start !== "number" || typeof end !== "number") {
      return NextResponse.json({ error: "Missing start/end" }, { status: 400 });
    }

    const videoIdMatch = url.match(
      /(?:youtu\.be\/|v=|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/
    );
    if (!videoIdMatch) {
      return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });
    }
    const videoId = videoIdMatch[1];

    const innertube = await getInnertube();
    const info = await innertube.getBasicInfo(videoId);

    const muxed = info.streaming_data?.formats;
    if (!muxed || muxed.length === 0) {
      return NextResponse.json({ error: "No muxed formats available" }, { status: 400 });
    }

    const format = info.chooseFormat({
      type: "video+audio",
      format: "mp4",
      quality: "best",
    });

    const streamUrl = await format.decipher(innertube.session.player);
    if (!streamUrl) {
      return NextResponse.json({ error: "Failed to decipher stream URL" }, { status: 500 });
    }

    const duration = info.basic_info.duration ?? 0;
    const fileSize = format.content_length ?? 0;

    return NextResponse.json({
      streamUrl,
      duration,
      fileSize,
      quality: format.quality_label ?? "unknown",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("YouTube URL extraction error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

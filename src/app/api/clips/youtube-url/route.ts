import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

let innertubePromise: Promise<any> | null = null;

async function getInnertube(client?: string) {
  const cacheKey = client || "default";
  if (!innertubePromise || client) {
    const promise = (async () => {
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
        client_type: (client || "WEB") as any,
        generate_session_locally: true,
      });
    })();

    if (!client) innertubePromise = promise;
    return promise;
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

    // Try different client types
    for (const clientType of ["WEB", "ANDROID", "TV_EMBEDDED"]) {
      try {
        const innertube = await getInnertube(clientType);
        const info = await innertube.getInfo(videoId);
        const sd = info.streaming_data;
        if (!sd) continue;

        const player = innertube.session.player;
        const duration = info.basic_info.duration ?? 0;

        if (sd.formats?.length > 0) {
          const format = info.chooseFormat({ type: "video+audio", format: "mp4", quality: "best" });
          const streamUrl = await format.decipher(player);
          return NextResponse.json({
            mode: "muxed" as const,
            streamUrl, duration,
            fileSize: format.content_length ?? 0,
            quality: format.quality_label ?? "unknown",
          });
        }

        if (sd.adaptive_formats?.length > 0) {
          const vf = info.chooseFormat({ type: "video", format: "mp4", quality: "best" });
          const af = info.chooseFormat({ type: "audio", format: "any", quality: "best" });
          const [videoUrl, audioUrl] = await Promise.all([
            vf.decipher(player), af.decipher(player),
          ]);
          return NextResponse.json({
            mode: "adaptive" as const,
            videoUrl, audioUrl, duration,
            videoQuality: vf.quality_label ?? "unknown",
            videoSize: vf.content_length ?? 0,
            audioSize: af.content_length ?? 0,
          });
        }
      } catch (e) {
        console.error(`Client ${clientType} failed:`, e instanceof Error ? e.message : e);
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

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

let innertubePromise: Record<string, Promise<any>> = {};

async function getInnertube(clientType: string) {
  if (!innertubePromise[clientType]) {
    innertubePromise[clientType] = (async () => {
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
        client_type: clientType as any,
        generate_session_locally: true,
      });
    })();
  }
  return innertubePromise[clientType];
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

    for (const clientType of ["TV_EMBEDDED", "WEB"]) {
      try {
        const innertube = await getInnertube(clientType);
        const info = await innertube.getInfo(videoId);
        const sd = info.streaming_data;
        if (!sd?.formats?.length && !sd?.adaptive_formats?.length) continue;

        const player = innertube.session.player;
        const duration = info.basic_info.duration ?? 0;

        // Prefer muxed
        if (sd.formats?.length) {
          const format = info.chooseFormat({ type: "video+audio", format: "mp4", quality: "best" });
          const streamUrl = format.url || (await format.decipher(player));
          return NextResponse.json({
            mode: "muxed" as const,
            streamUrl, duration,
            fileSize: format.content_length ?? 0,
            quality: format.quality_label ?? "unknown",
          });
        }

        // Adaptive
        const vf = info.chooseFormat({ type: "video", format: "mp4", quality: "best" });
        const af = info.chooseFormat({ type: "audio", format: "any", quality: "best" });
        const [videoUrl, audioUrl] = await Promise.all([
          vf.url || vf.decipher(player),
          af.url || af.decipher(player),
        ]);
        return NextResponse.json({
          mode: "adaptive" as const,
          videoUrl, audioUrl, duration,
          videoQuality: vf.quality_label ?? "unknown",
          videoSize: vf.content_length ?? 0,
          audioSize: af.content_length ?? 0,
        });
      } catch (e) {
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

import { NextRequest, NextResponse } from "next/server";
import ytdl from "@distube/ytdl-core";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { url, start, end } = await req.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }
    if (typeof start !== "number" || typeof end !== "number") {
      return NextResponse.json({ error: "Missing start/end" }, { status: 400 });
    }

    const info = await ytdl.getInfo(url);
    const format = ytdl.chooseFormat(info.formats, {
      quality: "highestvideo",
      filter: (f) => f.container === "mp4" && f.hasVideo && f.hasAudio,
    });

    if (!format || !format.url) {
      return NextResponse.json({ error: "No suitable format found" }, { status: 400 });
    }

    const duration = info.videoDetails.lengthSeconds;
    const fileSize = format.contentLength ? parseInt(format.contentLength) : 0;

    return NextResponse.json({
      streamUrl: format.url,
      duration: parseFloat(duration),
      fileSize,
      quality: format.qualityLabel || "unknown",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("YouTube URL extraction error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

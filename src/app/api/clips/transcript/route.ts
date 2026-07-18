import { NextRequest, NextResponse } from "next/server";
import { extractVideoId, fetchYouTubeTranscript } from "@/lib/youtube";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl.searchParams.get("url");
    if (!url) {
      return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });
    }

    const result = await fetchYouTubeTranscript(videoId);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Transcript error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

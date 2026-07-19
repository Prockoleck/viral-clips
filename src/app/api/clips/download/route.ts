import { NextRequest, NextResponse } from "next/server";

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { error: "Deprecated — downloads now happen in-browser via ytdl-core + FFmpeg.wasm" },
    { status: 410 }
  );
}

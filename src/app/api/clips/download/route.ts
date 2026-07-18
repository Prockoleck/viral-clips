import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { url, start, end } = await req.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }
    if (typeof start !== "number" || typeof end !== "number") {
      return NextResponse.json({ error: "Missing start/end" }, { status: 400 });
    }
    if (start >= end) {
      return NextResponse.json({ error: "start must be less than end" }, { status: 400 });
    }

    const serverUrl = process.env.DOWNLOAD_SERVER_URL;
    if (!serverUrl) {
      return NextResponse.json({ error: "Download server not configured" }, { status: 500 });
    }

    const res = await fetch(`${serverUrl}/api/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, start, end }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Download server error:", res.status, err);
      return NextResponse.json({ error: err }, { status: res.status });
    }

    const clipBuffer = await res.arrayBuffer();
    return new NextResponse(clipBuffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="clip_${Math.round(start)}-${Math.round(end)}.mp4"`,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Download proxy error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const streamUrl = req.nextUrl.searchParams.get("url");
    const range = req.nextUrl.searchParams.get("range");

    if (!streamUrl) {
      return NextResponse.json({ error: "Missing url param" }, { status: 400 });
    }

    const headers: Record<string, string> = {};
    if (range) {
      headers["Range"] = range;
    }

    const upstream = await fetch(streamUrl, { headers });

    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json({ error: `Upstream returned ${upstream.status}` }, { status: 502 });
    }

    const body = await upstream.arrayBuffer();

    const responseHeaders: Record<string, string> = {
      "Content-Type": upstream.headers.get("Content-Type") || "video/mp4",
      "Content-Length": String(body.byteLength),
      "Access-Control-Allow-Origin": "*",
    };

    const contentRange = upstream.headers.get("Content-Range");
    if (contentRange) {
      responseHeaders["Content-Range"] = contentRange;
    }

    return new NextResponse(body, {
      status: upstream.status === 206 ? 206 : 200,
      headers: responseHeaders,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Proxy error";
    console.error("Stream proxy error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

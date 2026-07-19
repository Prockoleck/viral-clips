import { NextRequest, NextResponse } from "next/server";

const POLL_INTERVAL = 3000;
const MAX_POLLS = 60;

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

    const startRes = await fetch(`${serverUrl}/api/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, start, end }),
    });

    if (!startRes.ok) {
      const err = await startRes.text();
      console.error("Download server start error:", startRes.status, err);
      return NextResponse.json({ error: err }, { status: startRes.status });
    }

    const { jobId } = await startRes.json();
    if (!jobId) {
      return NextResponse.json({ error: "No job ID returned" }, { status: 500 });
    }

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));

      const pollRes = await fetch(`${serverUrl}/api/download/${jobId}`);
      if (!pollRes.ok) {
        return NextResponse.json({ error: "Poll failed" }, { status: 500 });
      }

      const ct = pollRes.headers.get("content-type") || "";
      if (ct.includes("video/mp4")) {
        const clipBuffer = await pollRes.arrayBuffer();
        return new NextResponse(clipBuffer, {
          headers: {
            "Content-Type": "video/mp4",
            "Content-Disposition": `attachment; filename="clip_${Math.round(start)}-${Math.round(end)}.mp4"`,
          },
        });
      }

      const status = await pollRes.json();
      if (status.status === "error") {
        return NextResponse.json({ error: status.error || "Download failed" }, { status: 500 });
      }
    }

    return NextResponse.json({ error: "Download timed out" }, { status: 504 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Download proxy error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

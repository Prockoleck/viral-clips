import { NextRequest, NextResponse } from "next/server";

const GROQ_BASE = "https://api.groq.com/openai/v1";

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });
    }

    const formData = await req.formData();
    const audioFile = formData.get("file") as File | null;
    const model = formData.get("model") as string || "whisper-large-v3-turbo";

    if (!audioFile) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    const groqForm = new FormData();
    groqForm.append("file", audioFile, audioFile.name);
    groqForm.append("model", model);
    groqForm.append("response_format", "verbose_json");

    const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: groqForm,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Groq Whisper error:", res.status, errText);
      return NextResponse.json({ error: errText }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Transcribe error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

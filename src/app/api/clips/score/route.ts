import { NextRequest, NextResponse } from "next/server";

const GROQ_BASE = "https://api.groq.com/openai/v1";

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });
    }

    const { prompt, model } = await req.json();
    if (!prompt) {
      return NextResponse.json({ error: "No prompt provided" }, { status: 400 });
    }

    const bodyStr = JSON.stringify({
        model: model || "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 2048,
      });
    console.log(`[score] Prompt length: ${prompt.length} chars, body: ${bodyStr.length} bytes`);

    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: bodyStr,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Groq LLM error:", res.status, errText);
      return NextResponse.json({ error: errText }, { status: res.status });
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim() || "[]";
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let clips;
    try {
      clips = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: `Invalid JSON from LLM: ${cleaned}` }, { status: 500 });
    }

    return NextResponse.json({ clips });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Score error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

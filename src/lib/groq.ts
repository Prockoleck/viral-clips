export type GroqWord = {
  text: string;
  start: number;
  end: number;
};

export type GroqSegment = {
  start: number;
  end: number;
  text: string;
};

export type GroqSentence = {
  text: string;
  start: number;
  end: number;
};

export type GroqTranscript = {
  text: string;
  words: GroqWord[];
  segments: GroqSegment[];
};

export type ClipPick = {
  start_seconds: number;
  end_seconds: number;
  score: number;
  reason: string;
};

function estimateWordsFromSegments(
  segments: GroqSegment[],
  timeOffset: number
): GroqWord[] {
  const words: GroqWord[] = [];
  for (const seg of segments) {
    const tokens = seg.text.trim().split(/\s+/);
    if (tokens.length === 0) continue;
    const duration = seg.end - seg.start;
    const perWord = duration / tokens.length;
    for (let i = 0; i < tokens.length; i++) {
      words.push({
        text: tokens[i],
        start: Math.round((seg.start + i * perWord + timeOffset) * 100) / 100,
        end: Math.round((seg.start + (i + 1) * perWord + timeOffset) * 100) / 100,
      });
    }
  }
  return words;
}

function splitSegmentsIntoSentences(segments: GroqSegment[]): GroqSentence[] {
  const sentences: GroqSentence[] = [];

  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;

    const rawParts = text.match(/[^.!?]*[.!?]+/g);
    const parts: string[] = [];

    if (rawParts && rawParts.length > 1) {
      for (const p of rawParts) {
        const trimmed = p.trim();
        if (trimmed) parts.push(trimmed);
      }
    } else {
      const trimmed = text.trim();
      if (trimmed) parts.push(trimmed);
    }

    if (parts.length === 0) continue;

    const partWordCounts = parts.map((p) => p.split(/\s+/).length);
    const totalWords = partWordCounts.reduce((a, b) => a + b, 0);
    const segDuration = seg.end - seg.start;

    let wordOffset = 0;
    for (let i = 0; i < parts.length; i++) {
      const pStart = seg.start + (wordOffset / totalWords) * segDuration;
      wordOffset += partWordCounts[i];
      const pEnd = seg.start + (wordOffset / totalWords) * segDuration;

      sentences.push({
        text: parts[i],
        start: Math.round(pStart * 100) / 100,
        end: Math.round(pEnd * 100) / 100,
      });
    }
  }

  return sentences;
}

function buildSentenceTranscript(sentences: GroqSentence[]): string {
  if (sentences.length === 0) return "";
  return sentences
    .map((s, i) => `SENTENCE ${i + 1} [${s.start.toFixed(2)}s → ${s.end.toFixed(2)}s]: ${s.text}`)
    .join("\n");
}

function autoDetectContentType(transcript: string): string {
  const lower = transcript.toLowerCase();

  const podcastKeywords = ["welcome", "episode", "podcast", "interview", "host", "guest", "subscribe", "show notes", "today we", "let's talk about", "joining us", "conversation", "discuss"];
  const movieKeywords = ["scene", "cut", "action", "director", "film", "cinema", "character", "plot", "story", "movie"];
  const educationalKeywords = ["tutorial", "guide", "how to", "lesson", "learn", "understand", "explain", "concept", "science", "study", "research", "according to", "fact", "actually", "basically", "essentially"];
  const funnyKeywords = ["haha", "lol", "funny", "hilarious", "laugh", "joke", "comedy", "skit", "prank", "crazy", "insane", "dude", "bro", "wait", "what", "omg", "nope"];

  let podcastScore = 0, movieScore = 0, eduScore = 0, funnyScore = 0;

  for (const kw of podcastKeywords) if (lower.includes(kw)) podcastScore++;
  for (const kw of movieKeywords) if (lower.includes(kw)) movieScore++;
  for (const kw of educationalKeywords) if (lower.includes(kw)) eduScore++;
  for (const kw of funnyKeywords) if (lower.includes(kw)) funnyScore++;

  const max = Math.max(podcastScore, movieScore, eduScore, funnyScore);
  if (max === 0) return "general";

  if (max === funnyScore && funnyScore >= 2) return "funny";
  if (max === podcastScore && podcastScore >= 2) return "podcast";
  if (max === movieScore && movieScore >= 2) return "movie";
  if (max === eduScore && eduScore >= 2) return "educational";

  return "general";
}

function snapToSentenceBoundary(sentences: GroqSentence[], targetSeconds: number, side: "start" | "end"): number {
  if (sentences.length === 0) return targetSeconds;

  if (side === "start") {
    let best = sentences[0].start;
    for (const s of sentences) {
      if (s.start <= targetSeconds + 0.5) best = s.start;
    }
    return best;
  } else {
    let best = sentences[sentences.length - 1].end;
    for (const s of sentences) {
      if (s.end >= targetSeconds - 0.3 && s.end <= targetSeconds + 1) {
        best = s.end;
        return best;
      }
    }
    let nearest = sentences[0].end;
    let minDist = Infinity;
    for (const s of sentences) {
      const dist = Math.abs(s.end - targetSeconds);
      if (dist < minDist) {
        minDist = dist;
        nearest = s.end;
      }
    }
    return nearest;
  }
}

export async function transcribeAudio(
  audioBlob: Blob,
  timeOffset = 0
): Promise<GroqTranscript> {
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.flac");
  formData.append("model", "whisper-large-v3-turbo");
  formData.append("response_format", "verbose_json");

  const res = await fetch("/api/clips/transcribe", {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Transcription failed: ${err}`);
  }

  const data = await res.json();

  const rawSegments: { start: number; end: number; text: string }[] =
    data.segments || [];

  const segments = rawSegments.map((s) => ({
    start: s.start + timeOffset,
    end: s.end + timeOffset,
    text: s.text.trim(),
  }));

  const words = estimateWordsFromSegments(rawSegments, timeOffset);

  return { text: data.text || "", words, segments };
}

export async function scoreTranscript(
  transcript: string,
  segments: GroqSegment[],
  duration: number,
  topN: number
): Promise<ClipPick[]> {
  const sentences = splitSegmentsIntoSentences(segments);
  const contentType = autoDetectContentType(transcript);
  const sentenceTranscript = buildSentenceTranscript(sentences);

  const contentTypeGuides: Record<string, string> = {
    general: `- Look for the most engaging, surprising, or emotionally resonant moments.
- Pick complete sentences that tell a mini-story: setup → tension → payoff.
- If nothing stands out, pick the most information-dense 2-3 consecutive sentences.`,

    funny: `- Find the joke setup + punchline — this is usually 2-3 consecutive sentences.
- Capture the full beat: setup → delivery → reaction.
- Include the audience laughter or the comedian's own reaction as the closing sentence.
- Never cut the punchline short — always include the sentence that lands the joke.
- Look for: unexpected twists, exaggerated reactions, "wait what" moments, roasts.`,

    podcast: `- Find the most quotable hot take or surprising personal story.
- Stories usually span 3-8 consecutive sentences. Capture the whole arc.
- Start at the sentence that sets up the story, end on the sentence with the payoff.
- Look for: surprising confessions, strong opinions, "here's the thing" moments, emotional stories.
- Avoid: filler sentences, "um", "like", intro/outro patter.`,

    movie: `- Find iconic lines, emotional peaks, or plot twists.
- Dialogue clips: include at least the triggering line + the reaction line.
- Action clips: let the action breathe — don't cut mid-movement.
- Look for: character-defining moments, emotional reveals, stunning visuals described.`,

    educational: `- Find the key insight sentence followed by its explanation.
- The "aha" moment is usually 2-3 sentences: problem → reveal → implication.
- Start on the question, end on the answer.
- Look for: "here's the thing", "actually", "believe it or not", surprising facts.`,
  };

  const prompt = `You are a professional video editor creating viral clips for Shorts, Reels, and TikTok.

CONTENT TYPE: ${contentType.toUpperCase()}
VIDEO DURATION: ${Math.round(duration)}s
CLIPS TO PICK: ${topN}

## CRITICAL RULE — CUT ON COMPLETE SENTENCES

Below is the transcript split into SENTENCES. Each line is one complete sentence with its exact start and end timestamp.

- Your clip's start_seconds MUST be the start time of the FIRST sentence you want to include.
- Your clip's end_seconds MUST be the end time of the LAST sentence you want to include.
- NEVER start or end mid-sentence. Never cut a sentence in half.
- A good clip typically contains 2-5 consecutive sentences that form a complete thought, story, or joke.
- Include the full context so the viewer understands what's happening.

## CONTENT-SPECIFIC STRATEGY

${contentTypeGuides[contentType] || contentTypeGuides.general}

## CLIP QUALITY RULES

- First sentence must hook immediately — if the opening sentence is boring, start later.
- Last sentence must provide payoff — end when the thought completes, not when it trails off.
- Ideal length: 15-60 seconds (shorter for pure comedy, longer for stories).
- The clip must be understandable on its own — someone watching this 20-second clip should get the full context.

## OUTPUT FORMAT

Return a JSON array of ${topN} clip picks, sorted by score (highest first):

[
  {
    "start_seconds": number,
    "end_seconds": number,
    "score": 1-10,
    "reason": "short phrase explaining the viral hook"
  }
]

Rules: score must be integer 1-10. reason max 5 words. Return ONLY the JSON array — no markdown, no code fences, no surrounding text.

## TRANSCRIPT — SENTENCE LIST

${sentenceTranscript}

Full raw text:
${transcript}`;

  const res = await fetch("/api/clips/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, model: "llama-3.3-70b-versatile" }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Scoring failed: ${err}`);
  }

  const data = await res.json();
  const rawClips = data.clips as ClipPick[];

  const snapped: ClipPick[] = rawClips.map((c) => ({
    ...c,
    start_seconds: snapToSentenceBoundary(sentences, c.start_seconds, "start"),
    end_seconds: snapToSentenceBoundary(sentences, c.end_seconds, "end"),
  }));

  return snapped;
}

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

function sampleSentences(sentences: GroqSentence[], maxCount: number, duration: number): GroqSentence[] {
  if (sentences.length <= maxCount) return sentences;

  const step = sentences.length / maxCount;
  const sampled: GroqSentence[] = [];
  for (let i = 0; i < maxCount; i++) {
    sampled.push(sentences[Math.floor(i * step)]);
  }

  sampled.sort((a, b) => a.start - b.start);
  return sampled;
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

function snapToSegmentBoundary(segs: { start: number; end: number }[], targetSeconds: number, side: "start" | "end"): number {
  if (segs.length === 0) return targetSeconds;

  if (side === "start") {
    let best = segs[0].start;
    for (const s of segs) {
      if (s.start <= targetSeconds + 0.5) best = s.start;
    }
    return best;
  } else {
    let best = segs[segs.length - 1].end;
    for (const s of segs) {
      if (s.end >= targetSeconds - 0.3 && s.end <= targetSeconds + 1) {
        best = s.end;
        return best;
      }
    }
    let nearest = segs[0].end;
    let minDist = Infinity;
    for (const s of segs) {
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
  const contentType = autoDetectContentType(transcript);

  const filteredSegs = segments.filter(
    (s) => s.text.trim().length > 5 && !/^\[/.test(s.text.trim())
  );

  const MAX_SEGS = 300;
  const segs = filteredSegs.length > MAX_SEGS
    ? (() => {
        const step = filteredSegs.length / MAX_SEGS;
        const sampled: GroqSegment[] = [];
        for (let i = 0; i < MAX_SEGS; i++) {
          sampled.push(filteredSegs[Math.floor(i * step)]);
        }
        return sampled.sort((a, b) => a.start - b.start);
      })()
    : filteredSegs;

  const segTranscript = segs
    .map((s, i) => `BLOCK ${i + 1} [${s.start.toFixed(0)}s-${s.end.toFixed(0)}s]: ${s.text}`)
    .join("\n");

  const maxChars = 20000;
  const truncated = segTranscript.length > maxChars
    ? segTranscript.substring(0, maxChars) + "\n\n[TRUNCATED]"
    : segTranscript;


  const contentTypeGuides: Record<string, string> = {
    general: `Look for stop-scrolling moments. Mini-story: interesting → here's why it matters. Pick what someone would send a friend.`,

    funny: `Comedy = setup + punchline + reaction. Don't cut the beat. If you smiled, clip it.`,

    podcast: `Think clip hunter. "This one time" or "craziest part was" = opening. Let stories play out. Avoid intros, sponsor reads, dead tangents. Capture great back-and-forth exchanges.`,

    movie: `Need context. Include triggering line AND response. Let emotional beats land. Action: let tension build first. A great clip makes non-viewers understand why it matters.`,

    educational: `Give the whole insight in 30s. Start at the surprising idea, end after the "aha." Look for "most people don't know", "key insight is."`,

    motivational: `Capture struggle → breakthrough arc. Raw emotion connects. End on the line that makes you want to get up and do something.`,
  };

  const prompt = `You're a video editor finding viral clips for Shorts/Reels/TikTok.

CONTENT: ${contentType.toUpperCase()} | ${Math.round(duration)}s | Pick ${topN} clips

Each BLOCK below has a time range and text. A clip spans multiple consecutive blocks.
- Pick a START block and END block for each clip.
- start_seconds = START block's start time
- end_seconds = END block's end time
- CLIPS SHOULD BE 15-120 seconds. Don't pick clips under 15 seconds.
- Mix sizes: some 15-30s, some 30-60s, some 60-120s.
- Self-contained: viewer gets the full point without context.
- Hook first sentence, complete ending.

${contentTypeGuides[contentType] || contentTypeGuides.general}

BLOCKS:
${truncated}

Return JSON array: [{"start_seconds":num,"end_seconds":num,"score":1-10,"reason":"2-5 words"}]
score=10 most viral. Return ONLY JSON array.`;

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
    start_seconds: snapToSegmentBoundary(segs, c.start_seconds, "start"),
    end_seconds: snapToSegmentBoundary(segs, c.end_seconds, "end"),
  }));

  return snapped;
}

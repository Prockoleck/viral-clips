export type GroqWord = {
  text: string;
  start: number;
  end: number;
};

export type GroqTranscript = {
  text: string;
  words: GroqWord[];
};

export type ClipPick = {
  start_seconds: number;
  end_seconds: number;
  score: number;
  reason: string;
};

function estimateWordsFromSegments(
  segments: { start: number; end: number; text: string }[],
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
        text: tokens[i].replace(/[^\w\s'-]/g, ""),
        start: Math.round((seg.start + i * perWord + timeOffset) * 100) / 100,
        end: Math.round((seg.start + (i + 1) * perWord + timeOffset) * 100) / 100,
      });
    }
  }
  return words;
}

function buildTimestampedTranscript(words: GroqWord[]): string {
  if (words.length === 0) return "";
  const lines: string[] = [];
  const chunkSize = 20;

  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize);
    const line = chunk
      .map((w) => `  ${w.start.toFixed(2)}s  ${w.text}`)
      .join("\n");
    lines.push(line);
  }

  return `WORD TIMESTAMPS (format: "start_time  word"):
${lines.join("\n")}`;
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

function snapStartToWordBoundary(words: GroqWord[], targetSeconds: number): number {
  if (words.length === 0) return targetSeconds;

  const sentenceStarts = new Set<number>();
  for (let i = 0; i < words.length; i++) {
    const isStartOfSegment = i === 0;
    const prevEndsSentence = i > 0 && /[.!?:]$/.test(words[i - 1].text);
    const wordStartsUpper = words[i].text.length > 0 && /[A-Z]/.test(words[i].text[0]);
    if (isStartOfSegment || prevEndsSentence || wordStartsUpper) {
      sentenceStarts.add(words[i].start);
    }
  }

  const sortedStarts = Array.from(sentenceStarts).sort((a, b) => a - b);
  let best = sortedStarts[0] ?? words[0].start;
  for (const s of sortedStarts) {
    if (s <= targetSeconds + 0.5) best = s;
  }

  if (best === sortedStarts[0] || best === undefined) {
    let nearest = words[0].start;
    let minDist = Infinity;
    for (const w of words) {
      const dist = Math.abs(w.start - targetSeconds);
      if (dist < minDist) {
        minDist = dist;
        nearest = w.start;
      }
    }
    return nearest;
  }

  return best;
}

function snapEndToWordBoundary(words: GroqWord[], targetSeconds: number): number {
  if (words.length === 0) return targetSeconds;

  const sentenceEnds = new Set<number>();
  for (let i = 0; i < words.length; i++) {
    const isEndOfSegment = i === words.length - 1;
    const endsSentence = /[.!?:]$/.test(words[i].text);
    if (isEndOfSegment || endsSentence) {
      sentenceEnds.add(words[i].end);
    }
  }

  const sortedEnds = Array.from(sentenceEnds).sort((a, b) => a - b);
  let best = sortedEnds[sortedEnds.length - 1] ?? words[words.length - 1].end;
  for (const e of sortedEnds) {
    if (e >= targetSeconds - 0.5 && e <= targetSeconds + 1) {
      best = e;
      break;
    }
  }

  let nearest = words[words.length - 1].end;
  let minDist = Infinity;
  for (const w of words) {
    const dist = Math.abs(w.end - targetSeconds);
    if (dist < minDist) {
      minDist = dist;
      nearest = w.end;
    }
  }
  if (targetSeconds < nearest) nearest = targetSeconds === 0 ? nearest : Math.min(targetSeconds, nearest);
  return nearest;
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

  const segments: { start: number; end: number; text: string }[] =
    data.segments || [];

  const words = estimateWordsFromSegments(segments, timeOffset);

  return { text: data.text || "", words };
}

export async function scoreTranscript(
  transcript: string,
  words: GroqWord[],
  duration: number,
  topN: number
): Promise<ClipPick[]> {
  const contentType = autoDetectContentType(transcript);
  const tsTranscript = buildTimestampedTranscript(words);

  const contentTypeGuides: Record<string, string> = {
    general: `- Look for the most engaging, surprising, or emotionally resonant moments.
- Prioritize clips that tell a complete mini-story: setup → tension → payoff.
- If nothing stands out, pick the most information-dense 20-30 seconds.`,

    funny: `- Cut right before the punchline and let the laughter/reaction play out.
- Include the setup so the punchline lands — never cut the setup.
- End immediately after the punchline or reaction, not during dead air.
- Look for: unexpected twists, exaggerated reactions, "wait what" moments, roasts.
- Comedy is timing: keep clips tight (15-25s ideal for pure jokes).`,

    podcast: `- Find the most quotable, controversial, or insightful 20-40 second hot take.
- Start at the beginning of a complete thought, not mid-sentence.
- End when the speaker finishes their point (pauses are fine, trailing off is not).
- Look for: surprising opinions, personal stories, heated debates, "aha" insights.
- Avoid: intros, outros, sponsor reads, "um" / filler-heavy sections.`,

    movie: `- For dialogue: include the lead-in line AND the reaction/response.
- For action: start on the tension build (2-3s before the action), end on the money shot.
- For emotional scenes: start on the trigger, end on the emotional reaction.
- Keep clips tight: 10-30s. Every second must earn its place.
- Look for: iconic lines, emotional peaks, plot twists, stunning visuals moments.`,

    educational: `- Find the key insight or "aha" moment — the sentence that makes it click.
- Start with the question or problem statement, end with the answer.
- Include the surprising fact or counterintuitive reveal.
- Keep clips 20-45s — long enough to explain, short enough to not lose attention.
- Look for: "here's the thing", "actually", "believe it or not", numbered lists.`,
  };

  const prompt = `You are a professional video editor who creates viral clips for YouTube Shorts, Instagram Reels, and TikTok.

CONTENT TYPE DETECTED: ${contentType.toUpperCase()}

VIDEO DURATION: ${Math.round(duration)} seconds
CLIPS TO PICK: ${topN}
CLIP LENGTH RULE: Each clip must be 15-60 seconds. Never shorter than 10s, never longer than 90s.

## CORE RULES (MANDATORY)

1. **CUT ON COMPLETE WORDS** — Every cut must begin at a word's START timestamp and end at a word's END timestamp. Never cut mid-word.

2. **CUT ON COMPLETE PHRASES** — Start at the beginning of a sentence or major phrase. End when the thought completes. Never start or end mid-sentence unless the sentence is over 40 seconds long.

3. **HOOK IN THE FIRST 3 SECONDS** — The opening 3 seconds must immediately grab attention. If it starts slow, choose a different segment.

4. **NO TAIL DEAD AIR** — End on a strong word, not trailing off, pauses, or silence.

5. **USE THE WORD TIMESTAMPS BELOW** — Your start_seconds and end_seconds MUST match timestamps from the word list. Round to 2 decimal places.

## CONTENT-SPECIFIC GUIDANCE

${contentTypeGuides[contentType] || contentTypeGuides.general}

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

Rules: score must be an integer. reason max 5 words. Return ONLY the JSON array, no markdown, no surrounding text, no code fences.

## TRANSCRIPT WITH WORD TIMESTAMPS

Full text:
${transcript}

${tsTranscript}`;

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
    start_seconds: snapStartToWordBoundary(words, c.start_seconds),
    end_seconds: snapEndToWordBoundary(words, c.end_seconds),
  }));

  return snapped;
}

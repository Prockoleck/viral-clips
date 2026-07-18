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
    general: `You're looking for moments that make a viewer stop scrolling.
A great clip tells a mini-story: here's something interesting → oh wait, here's why it matters. Pick the part that a person would send to their friend saying "listen to this."
Clip however many sentences it takes to tell that moment — whether it's one sentence or twenty.
If the whole video is dry, at least find the most surprising or information-dense part.`,

    funny: `Comedy is about the beat. The setup, the punchline, the reaction.
Don't cut the setup — without it the punchline has no power. Don't cut the reaction — that's half the fun.
If it's a long story that builds to a hilarious payoff, take the whole story. If it's a quick one-liner, take just theline and the laugh.
The clip should make someone laugh even if they haven't seen the rest of the video.
Trust your gut: if you smiled, clip it.`,

    podcast: `Podcasts are about people saying interesting things. Think like a clip hunter.
When a guest starts a story with "this one time" or "the craziest part was" — that's your opening. Let the story play out naturally. If it takes 30 sentences over two minutes to tell the full story, that's your clip. The viewer will watch every second if it's compelling.
Avoid: introductions, sponsor reads, tangents that go nowhere, the host saying "let me stop you there."
If the conversation goes back and forth between two people having a great dynamic, capture the whole exchange. The chemistry is the content.`,

    movie: `Movie clips need context. A single line without context falls flat.
For dialogue: include the triggering line AND the response. Let the emotional beat land — whether it's anger, heartbreak, or triumph.
For action: let the viewer feel the tension build before the explosion. Start a few seconds early, let the action breathe.
For emotional scenes: start where the emotion begins, not where it peaks. Let the viewer experience the whole arc.
A great movie clip makes someone who's never seen the movie understand exactly why it matters.`,

    educational: `People watch educational clips because they want to learn something in 30 seconds instead of 30 minutes. Give them the whole insight.
Start where the teacher introduces the surprising idea. End when the idea has fully landed — after the example, after the "aha."
If the explanation needs a setup ("imagine this scenario") and a payoff, include both. A clip that teaches nothing is worthless.
Look for: "here's what most people don't know", "the key insight is", "this changed everything."
The best educational clips make the viewer feel smarter after watching.`,

    motivational: `People watch these for the emotional push. Capture the entire arc from struggle to breakthrough.
If someone's telling a personal failure story, start at the low point and ride through to the lesson learned.
The raw emotion is what connects — don't sanitize it. Stutters, pauses, voice cracks make it real.
End on the line that makes the viewer want to get up and do something.`,
  };

  const prompt = `You're a video editor going through footage looking for clips that will blow up on Shorts, Reels, and TikTok.

CONTENT TYPE: ${contentType.toUpperCase()}
VIDEO DURATION: ${Math.round(duration)}s
CLIPS TO PICK: ${topN}

## THE ONE RULE

Cut on complete sentences. Every sentence below has a timestamp. Your clip starts at the first sentence's time and ends at the last sentence's time. Never cut a sentence in half. Never start or end mid-word.

That's the only hard rule. Everything below is just advice.

## VARY THE CLIP SIZES — SMALL, MEDIUM, LARGE

Don't make all clips the same length. Think in three sizes, each matching the content it captures:

**SMALL clip (1-3 sentences, ~5-15 seconds):** A quick punchline. A one-liner reaction. A single surprising fact. A short "wait what" moment. These hit fast and end quick.

**MEDIUM clip (3-10 sentences, ~15-45 seconds):** A full joke with setup + punchline + reaction. One complete story beat. A key insight with explanation. A short back-and-forth exchange. Most clips should be this size.

**LARGE clip (10+ sentences, ~45-120 seconds):** A whole story arc from start to finish. An emotional journey. A deep dive into one topic. A conversation where people go back and forth multiple times. Only use this for content that genuinely needs the space — a great storyteller telling a complete story, a heated debate, a detailed explanation.

Pick a mix of sizes in your ${topN} clips. If you pick 5 clips, maybe 2 small + 2 medium + 1 large. Or 1 small + 3 medium + 1 large. Let the content decide.

## HOW TO READ THE TRANSCRIPT BELOW

The transcript is split into SENTENCES. Each line looks like:
SENTENCE 1 [0.00s → 2.50s]: This is the sentence text.

If you want a clip from sentence 3 to sentence 8:
- start_seconds = sentence 3's start time
- end_seconds = sentence 8's end time

Simple. Just pick which sentences belong in the clip.

## WHAT MAKES A GOOD CLIP

- A viewer should get it without watching anything else. The clip needs to be self-contained — setup and payoff in one package.
- The first sentence has to hook. If the first sentence is boring, start later. If the last sentence trails off, end earlier or extend to where the thought actually completes.
- A 10-second joke is fine. A 90-second story is fine. What matters is: does the clip feel complete? If you stop watching and feel like you missed the point, it's too short. If you stop watching because it dragged on, it's too long.
- Pick the BEST moments, not the ones that fit a specific length. Of all the interesting things said in this video, which ${topN} are the most share-worthy? Those are your clips.

## YOUR STRATEGY FOR THIS TYPE OF CONTENT

${contentTypeGuides[contentType] || contentTypeGuides.general}

## OUTPUT

Return a JSON array of ${topN} clips, best ones first:

[
  { "start_seconds": number, "end_seconds": number, "score": 1-10, "reason": "short reason" }
]

- score is an integer 1-10 (10 = most viral)
- reason is 2-5 words describing the hook
- Return ONLY the array. No markdown. No code fences. No extra text.

## THE TRANSCRIPT — SENTENCES WITH TIMESTAMPS

${sentenceTranscript}

Full text:
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

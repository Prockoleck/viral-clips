import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

const CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";

let ffmpeg: FFmpeg | null = null;
let ffmpegLoaded = false;

export type ClipInfo = {
  start: number;
  end: number;
  score: number;
  reason: string;
};

export type ProgressCallback = (percent: number, label: string) => void;

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegLoaded && ffmpeg) return ffmpeg;

  ffmpeg = new FFmpeg();
  await ffmpeg.load({
    coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
  });

  ffmpegLoaded = true;
  return ffmpeg;
}

export async function extractAudio(
  videoFile: File,
  onProgress?: ProgressCallback
): Promise<Blob> {
  const ff = await getFFmpeg();

  onProgress?.(0, "Loading video...");
  await ff.writeFile("input.mp4", await fetchFile(videoFile));

  onProgress?.(20, "Extracting audio...");
  await ff.exec([
    "-i", "input.mp4",
    "-vn",
    "-ar", "16000",
    "-ac", "1",
    "-c:a", "flac",
    "-y", "audio.flac",
  ]);

  onProgress?.(60, "Compressing audio...");
  const data = await ff.readFile("audio.flac");
  const blob = new Blob([data as Uint8Array], { type: "audio/flac" });

  await ff.deleteFile("input.mp4").catch(() => {});
  await ff.deleteFile("audio.flac").catch(() => {});

  onProgress?.(100, "Audio ready");
  return blob;
}

export async function chunkAudio(
  audioBlob: Blob,
  totalDuration: number,
  onProgress?: ProgressCallback
): Promise<{ chunk: Blob; offset: number }[]> {
  const MAX_SIZE = 23 * 1024 * 1024;

  if (audioBlob.size <= MAX_SIZE) {
    return [{ chunk: audioBlob, offset: 0 }];
  }

  const ff = await getFFmpeg();
  const numChunks = Math.ceil(audioBlob.size / MAX_SIZE);
  const chunkDuration = totalDuration / numChunks;
  const chunks: { chunk: Blob; offset: number }[] = [];

  await ff.writeFile("source.flac", await fetchFile(audioBlob));

  for (let i = 0; i < numChunks; i++) {
    const offset = i * chunkDuration;
    const outName = `chunk_${i}.flac`;

    onProgress?.(
      Math.round((i / numChunks) * 100),
      `Chunk ${i + 1}/${numChunks}`
    );

    await ff.exec([
      "-i", "source.flac",
      "-ss", String(offset),
      "-t", String(chunkDuration),
      "-c:a", "flac",
      "-y", outName,
    ]);

    const data = await ff.readFile(outName);
    chunks.push({
      chunk: new Blob([data as Uint8Array], { type: "audio/flac" }),
      offset,
    });

    await ff.deleteFile(outName).catch(() => {});
  }

  await ff.deleteFile("source.flac").catch(() => {});
  return chunks;
}

export async function cutClips(
  videoFile: File,
  clips: ClipInfo[],
  onProgress?: ProgressCallback
): Promise<{ blob: Blob; filename: string; clip: ClipInfo }[]> {
  const ff = await getFFmpeg();
  const results: { blob: Blob; filename: string; clip: ClipInfo }[] = [];

  onProgress?.(0, "Loading video...");
  await ff.writeFile("source.mp4", await fetchFile(videoFile));

  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const start = Math.max(0, c.start);
    const duration = Math.min(c.end - start, 120);
    const outName = `clip_${i + 1}.mp4`;

    onProgress?.(
      Math.round((i / clips.length) * 100),
      `Cutting clip ${i + 1}/${clips.length}...`
    );

    ff.on("progress", ({ progress }) => {
      const base = Math.round((i / clips.length) * 100);
      const step = Math.round((progress * 100) / clips.length);
      onProgress?.(Math.min(base + step, 99), `Cutting clip ${i + 1}/${clips.length}...`);
    });

    await ff.exec([
      "-i", "source.mp4",
      "-ss", String(start),
      "-t", String(duration),
      "-c:v", "libx264",
      "-preset", "fast",
      "-c:a", "aac",
      "-movflags", "+faststart",
      "-y", outName,
    ]);

    const data = await ff.readFile(outName);
    results.push({
      blob: new Blob([data as Uint8Array], { type: "video/mp4" }),
      filename: `clip_${i + 1}_score${c.score}.mp4`,
      clip: c,
    });

    await ff.deleteFile(outName).catch(() => {});
  }

  await ff.deleteFile("source.mp4").catch(() => {});
  onProgress?.(100, "Done");
  return results;
}

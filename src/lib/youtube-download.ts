import { getFFmpeg, type ProgressCallback } from "./ffmpeg";

type UrlInfo =
  | { mode: "muxed"; streamUrl: string; duration: number; fileSize: number; quality: string }
  | { mode: "adaptive"; videoUrl: string; audioUrl: string; duration: number; videoSize: number; audioSize: number; videoQuality: string };

async function proxyFetch(url: string, range?: string): Promise<Uint8Array> {
  const params = new URLSearchParams({ url });
  if (range) params.set("range", range);
  const res = await fetch(`/api/clips/proxy-stream?${params}`);
  if (!res.ok) throw new Error(`Proxy fetch failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function fetchStreamViaProxy(streamUrl: string, fileSize: number, duration: number, startSec: number, endSec: number): Promise<Uint8Array> {
  const PADDING = 10;
  const paddedStart = Math.max(0, startSec - PADDING);
  const paddedEnd = endSec + PADDING;

  if (fileSize > 0 && duration > 0) {
    const bytesPerSec = fileSize / duration;
    const startByte = Math.max(0, Math.floor(paddedStart * bytesPerSec));
    const endByte = Math.min(fileSize - 1, Math.ceil(paddedEnd * bytesPerSec));

    const data = await proxyFetch(streamUrl, `bytes=${startByte}-${endByte}`);
    if (data.length > 0) return data;
  }

  return proxyFetch(streamUrl);
}

export async function downloadYouTubeClip(
  youtubeUrl: string,
  startSec: number,
  endSec: number,
  onProgress?: ProgressCallback
): Promise<Blob> {
  onProgress?.(0, "Getting video info...");

  const infoRes = await fetch("/api/clips/youtube-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: youtubeUrl }),
  });

  if (!infoRes.ok) {
    const err = await infoRes.json();
    throw new Error(err.error || "Failed to get video info");
  }

  const info: UrlInfo = await infoRes.json();

  const ff = await getFFmpeg();

  if (info.mode === "muxed") {
    onProgress?.(10, "Downloading video segment...");
    const videoData = await fetchStreamViaProxy(info.streamUrl, info.fileSize, info.duration, startSec, endSec);

    onProgress?.(50, "Processing clip...");
    await ff.writeFile("input.mp4", videoData);

    const PADDING = 10;
    const paddedStart = Math.max(0, startSec - PADDING);
    const seekOffset = startSec - paddedStart;
    const clipDuration = endSec - startSec;

    await ff.exec([
      "-ss", String(Math.max(0, seekOffset)),
      "-i", "input.mp4",
      "-t", String(clipDuration),
      "-c:v", "libx264",
      "-preset", "fast",
      "-c:a", "aac",
      "-movflags", "+faststart",
      "-y", "clip.mp4",
    ]);
  } else {
    onProgress?.(10, "Downloading video track...");
    const videoData = await fetchStreamViaProxy(info.videoUrl, info.videoSize, info.duration, startSec, endSec);

    onProgress?.(25, "Downloading audio track...");
    const audioData = await fetchStreamViaProxy(info.audioUrl, info.audioSize, info.duration, startSec, endSec);

    onProgress?.(50, "Merging tracks & cutting clip...");
    await ff.writeFile("video.mp4", videoData);
    await ff.writeFile("audio.mp4", audioData);

    const PADDING = 10;
    const paddedStart = Math.max(0, startSec - PADDING);
    const seekOffset = startSec - paddedStart;
    const clipDuration = endSec - startSec;

    await ff.exec([
      "-ss", String(Math.max(0, seekOffset)),
      "-i", "video.mp4",
      "-ss", String(Math.max(0, seekOffset)),
      "-i", "audio.mp4",
      "-t", String(clipDuration),
      "-c:v", "libx264",
      "-preset", "fast",
      "-c:a", "aac",
      "-movflags", "+faststart",
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-y", "clip.mp4",
    ]);

    await ff.deleteFile("video.mp4").catch(() => {});
    await ff.deleteFile("audio.mp4").catch(() => {});
  }

  onProgress?.(90, "Finalizing...");

  const output = await ff.readFile("clip.mp4");
  const blob = new Blob([output as Uint8Array], { type: "video/mp4" });

  await ff.deleteFile("input.mp4").catch(() => {});
  await ff.deleteFile("clip.mp4").catch(() => {});

  onProgress?.(100, "Done");
  return blob;
}

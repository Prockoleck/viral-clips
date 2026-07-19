import { getFFmpeg, type ProgressCallback } from "./ffmpeg";

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
    body: JSON.stringify({ url: youtubeUrl, start: startSec, end: endSec }),
  });

  if (!infoRes.ok) {
    const err = await infoRes.json();
    throw new Error(err.error || "Failed to get video info");
  }

  const { streamUrl, duration, fileSize } = await infoRes.json();

  onProgress?.(10, "Downloading video segment...");

  const clipDuration = endSec - startSec;
  const PADDING = 10;
  const paddedStart = Math.max(0, startSec - PADDING);

  let videoData: Uint8Array;

  if (fileSize > 0 && duration > 0) {
    const bytesPerSec = fileSize / duration;
    const startByte = Math.max(0, Math.floor(paddedStart * bytesPerSec));
    const endByte = Math.min(fileSize - 1, Math.ceil((endSec + PADDING) * bytesPerSec));

    const proxyUrl = `/api/clips/proxy-stream?url=${encodeURIComponent(streamUrl)}&range=bytes=${startByte}-${endByte}`;
    const rangeRes = await fetch(proxyUrl);

    if (rangeRes.status === 206 || rangeRes.ok) {
      videoData = new Uint8Array(await rangeRes.arrayBuffer());
    } else {
      const fullProxyUrl = `/api/clips/proxy-stream?url=${encodeURIComponent(streamUrl)}`;
      const fullRes = await fetch(fullProxyUrl);
      videoData = new Uint8Array(await fullRes.arrayBuffer());
    }
  } else {
    const fullProxyUrl = `/api/clips/proxy-stream?url=${encodeURIComponent(streamUrl)}`;
    const fullRes = await fetch(fullProxyUrl);
    videoData = new Uint8Array(await fullRes.arrayBuffer());
  }

  onProgress?.(50, "Processing clip...");

  const ff = await getFFmpeg();
  await ff.writeFile("input.mp4", videoData);

  const seekOffset = startSec - paddedStart;
  const outName = "clip.mp4";

  await ff.exec([
    "-ss", String(Math.max(0, seekOffset)),
    "-i", "input.mp4",
    "-t", String(clipDuration),
    "-c:v", "libx264",
    "-preset", "fast",
    "-c:a", "aac",
    "-movflags", "+faststart",
    "-y", outName,
  ]);

  onProgress?.(90, "Finalizing...");

  const output = await ff.readFile(outName);
  const blob = new Blob([output as Uint8Array], { type: "video/mp4" });

  await ff.deleteFile("input.mp4").catch(() => {});
  await ff.deleteFile(outName).catch(() => {});

  onProgress?.(100, "Done");
  return blob;
}

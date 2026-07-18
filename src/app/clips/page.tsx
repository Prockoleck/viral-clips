"use client";

import { useState, useRef } from "react";
import { getFFmpeg, extractAudio, chunkAudio, cutClips } from "@/lib/ffmpeg";
import { transcribeAudio, scoreTranscript } from "@/lib/groq";
import { extractVideoId, buildYouTubeEmbedUrl, fetchYouTubeTranscript } from "@/lib/youtube";
import type { ClipPick } from "@/lib/groq";
import type { ClipInfo } from "@/lib/ffmpeg";

type Mode = "youtube" | "upload";

type Step =
  | "idle"
  | "fetching-transcript"
  | "scoring"
  | "loading-ffmpeg"
  | "extracting"
  | "transcribing"
  | "cutting"
  | "done"
  | "error";

const MAX_FILE_SIZE = 500 * 1024 * 1024;

export default function ClipsPage() {
  const [mode, setMode] = useState<Mode>("youtube");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeVideoId, setYoutubeVideoId] = useState("");
  const [youtubeTitle, setYoutubeTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [topN, setTopN] = useState(5);
  const [step, setStep] = useState<Step>("idle");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [error, setError] = useState("");
  const [picks, setPicks] = useState<ClipPick[]>([]);
  const [clips, setClips] = useState<{ blob: Blob; filename: string; clip: ClipInfo }[]>([]);
  const [clipUrls, setClipUrls] = useState<string[]>([]);
  const [downloadingClip, setDownloadingClip] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_FILE_SIZE) {
      setError("File too large. Max 500MB.");
      return;
    }
    setFile(f);
    setError("");
    setClips([]);
    setClipUrls([]);
    setPicks([]);
    setStep("idle");
  }

  function handleProgress(pct: number, label: string) {
    setProgress(pct);
    setProgressLabel(label);
  }

  function resetState() {
    setError("");
    setPicks([]);
    setClips([]);
    setClipUrls([]);
    setYoutubeTitle("");
    setYoutubeVideoId("");
  }

  async function handleYouTubeProcess() {
    const videoId = extractVideoId(youtubeUrl);
    if (!videoId) {
      setError("Invalid YouTube URL");
      return;
    }

    resetState();
    setYoutubeVideoId(videoId);

    try {
      setStep("fetching-transcript");
      setProgressLabel("Fetching transcript...");
      setProgress(20);

      const transcriptData = await fetchYouTubeTranscript(videoId);
      setYoutubeTitle(transcriptData.title);

      setStep("scoring");
      setProgressLabel("Analyzing for viral moments...");
      setProgress(50);

      const picksResult = await scoreTranscript(
        transcriptData.segments.map((s: { text: string }) => s.text).join(" "),
        transcriptData.segments,
        transcriptData.duration,
        topN
      );

      if (!picksResult.length) {
        setError("No viral moments detected in this video.");
        setStep("error");
        return;
      }

      setPicks(picksResult);
      setStep("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      setStep("error");
    }
  }

  async function handleUploadProcess() {
    if (!file) return;

    resetState();

    try {
      setStep("loading-ffmpeg");
      setProgressLabel("Loading FFmpeg engine (~31 MB)...");
      setProgress(0);
      await getFFmpeg();

      setStep("extracting");
      setProgressLabel("Extracting audio...");
      const audioBlob = await extractAudio(file, handleProgress);

      const videoDuration = await getVideoDuration(file);

      setStep("transcribing");
      setProgressLabel("Transcribing audio with Groq Whisper...");
      setProgress(0);

      const chunks = await chunkAudio(audioBlob, videoDuration, handleProgress);
      let allSegments: { start: number; end: number; text: string }[] = [];

      for (let i = 0; i < chunks.length; i++) {
        setProgressLabel(`Transcribing chunk ${i + 1}/${chunks.length}...`);
        const result = await transcribeAudio(chunks[i].chunk, chunks[i].offset);
        allSegments = allSegments.concat(result.segments);
      }

      const fullTranscript = allSegments.map((s) => s.text).join(" ");

      setStep("scoring");
      setProgressLabel("Analyzing for viral moments...");
      setProgress(30);
      const picksResult = await scoreTranscript(fullTranscript, allSegments, videoDuration, topN);

      if (!picksResult.length) {
        setError("No viral moments detected in this video.");
        setStep("error");
        return;
      }

      setPicks(picksResult);

      setStep("cutting");
      setProgressLabel("Cutting clips...");
      setProgress(0);
      const clipInfo: ClipInfo[] = picksResult.map((p) => ({
        start: p.start_seconds,
        end: p.end_seconds,
        score: p.score,
        reason: p.reason,
      }));
      const clipResults = await cutClips(file, clipInfo, handleProgress);

      setClips(clipResults);
      const urls = clipResults.map((r) => URL.createObjectURL(r.blob));
      setClipUrls(urls);
      setStep("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      setStep("error");
    }
  }

  async function handleProcess() {
    if (mode === "youtube") {
      await handleYouTubeProcess();
    } else {
      await handleUploadProcess();
    }
  }

  async function handleDownloadClip(clip: ClipPick, index: number) {
    setDownloadingClip(index);
    try {
      const res = await fetch("/api/clips/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
          start: clip.start_seconds,
          end: clip.end_seconds,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Download failed");
      }

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `clip_${index + 1}_score${clip.score}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Download failed";
      setError(msg);
    } finally {
      setDownloadingClip(null);
    }
  }

  function getVideoDuration(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(video.src);
        resolve(video.duration);
      };
      video.onerror = () => reject(new Error("Could not read video duration"));
      video.src = URL.createObjectURL(file);
    });
  }

  const barStyle = {
    height: 6,
    borderRadius: 3,
    background: "#e0e0e0",
    overflow: "hidden" as const,
    marginTop: 8,
  };

  const fillStyle = (pct: number) => ({
    height: "100%",
    width: `${pct}%`,
    background: "#f97316",
    borderRadius: 3,
    transition: "width 0.3s ease",
  });

  const isProcessing = step !== "idle" && step !== "done" && step !== "error";

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: 700, margin: 0, textAlign: "center" }}>Viral Clips</h1>
      <p style={{ color: "#666", textAlign: "center", marginTop: 4, marginBottom: 32 }}>
        Paste a YouTube link or upload a video. AI finds & cuts the best moments.
      </p>

      {/* Mode Toggle */}
      <div style={{ display: "flex", justifyContent: "center", gap: 4, marginBottom: 24 }}>
        {(["youtube", "upload"] as const).map((m) => (
          <button
            key={m}
            onClick={() => { if (!isProcessing) { setMode(m); resetState(); } }}
            disabled={isProcessing}
            style={{
              padding: "8px 24px",
              borderRadius: 8,
              border: "1px solid #e0e0e0",
              background: mode === m ? "#f97316" : "#fff",
              color: mode === m ? "#fff" : "#666",
              fontWeight: 600,
              fontSize: "0.85rem",
              cursor: isProcessing ? "not-allowed" : "pointer",
              opacity: isProcessing ? 0.6 : 1,
            }}
          >
            {m === "youtube" ? "YouTube URL" : "Upload Video"}
          </button>
        ))}
      </div>

      <div style={{
        background: "#fff",
        border: "1px solid #e0e0e0",
        borderRadius: 16,
        padding: 32,
        maxWidth: 500,
        margin: "0 auto",
      }}>
        {mode === "youtube" ? (
          <>
            <input
              type="url"
              placeholder="https://youtube.com/watch?v=..."
              value={youtubeUrl}
              onChange={(e) => { setYoutubeUrl(e.target.value); setError(""); }}
              disabled={isProcessing}
              style={{
                width: "100%",
                fontSize: "0.9rem",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #e0e0e0",
                boxSizing: "border-box",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && youtubeUrl && !isProcessing) handleProcess();
              }}
            />
            {youtubeTitle && (
              <div style={{ marginTop: 8, fontSize: "0.8rem", color: "#999" }}>
                {youtubeTitle}
              </div>
            )}
          </>
        ) : (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime,video/x-matroska,video/*"
              onChange={handleFileChange}
              style={{ width: "100%", fontSize: "0.9rem" }}
              disabled={isProcessing}
            />
            {file && (
              <div style={{ marginTop: 8, fontSize: "0.8rem", color: "#999" }}>
                {(file.size / 1024 / 1024).toFixed(1)} MB · {file.name}
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: 20 }}>
          <label style={{ display: "block", fontSize: "0.9rem", fontWeight: 600, marginBottom: 6 }}>
            Clips: {topN}
          </label>
          <input
            type="range"
            min={1}
            max={10}
            value={topN}
            onChange={(e) => setTopN(Number(e.target.value))}
            style={{ width: "100%" }}
            disabled={isProcessing}
          />
        </div>

        <button
          onClick={handleProcess}
          disabled={
            isProcessing ||
            (mode === "youtube" && !youtubeUrl) ||
            (mode === "upload" && !file)
          }
          style={{
            marginTop: 20,
            width: "100%",
            padding: "12px 24px",
            borderRadius: 10,
            border: 0,
            background:
              isProcessing ||
              (mode === "youtube" && !youtubeUrl) ||
              (mode === "upload" && !file)
                ? "#ccc"
                : "#f97316",
            color: "#fff",
            fontWeight: 600,
            fontSize: "1rem",
            cursor:
              isProcessing ||
              (mode === "youtube" && !youtubeUrl) ||
              (mode === "upload" && !file)
                ? "not-allowed"
                : "pointer",
          }}
        >
          {step === "idle" || step === "done" || step === "error"
            ? "Extract Clips"
            : "Processing..."}
        </button>
      </div>

      {/* Progress */}
      {isProcessing && (
        <div style={{ maxWidth: 500, margin: "24px auto 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.85rem", color: "#666" }}>
              {stepLabel(step)}
            </span>
            <span style={{ fontSize: "0.8rem", color: "#999" }}>{progress}%</span>
          </div>
          <div style={barStyle}>
            <div style={fillStyle(progress)} />
          </div>
          <p style={{ fontSize: "0.8rem", color: "#999", marginTop: 4 }}>{progressLabel}</p>
        </div>
      )}

      {step === "done" && picks.length > 0 && (
        <p style={{ textAlign: "center", fontSize: "0.85rem", color: "#666", marginTop: 12 }}>
          {picks.length} clips found
        </p>
      )}

      {/* Error */}
      {error && (
        <div style={{
          marginTop: 16,
          padding: 16,
          background: "#fef2f2",
          border: "1px solid #fecaca",
          borderRadius: 12,
          color: "#dc2626",
          textAlign: "center",
          maxWidth: 500,
          marginLeft: "auto",
          marginRight: "auto",
          fontSize: "0.9rem",
        }}>
          {error}
        </div>
      )}

      {/* YouTube Clips */}
      {mode === "youtube" && picks.length > 0 && youtubeVideoId && (
        <div style={{ marginTop: 32, display: "flex", flexDirection: "column", gap: 20, maxWidth: 500, marginLeft: "auto", marginRight: "auto" }}>
          {picks.map((clip, i) => (
            <div
              key={i}
              style={{
                background: "#fff",
                border: "1px solid #e0e0e0",
                borderRadius: 12,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Clip #{i + 1}</span>
                <span style={{
                  fontSize: "0.8rem",
                  color: "#f97316",
                  background: "#fff7ed",
                  padding: "2px 10px",
                  borderRadius: 20,
                }}>
                  Score: {clip.score}
                </span>
              </div>

              <div style={{ fontSize: "0.8rem", color: "#999" }}>
                {formatTime(clip.start_seconds)} → {formatTime(clip.end_seconds)}
                <span style={{ marginLeft: 8 }}>
                  ({Math.round(clip.end_seconds - clip.start_seconds)}s)
                </span>
              </div>

              {clip.reason && (
                <div style={{ fontSize: "0.85rem", color: "#666", fontStyle: "italic" }}>
                  {clip.reason}
                </div>
              )}

              <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, borderRadius: 8, overflow: "hidden", background: "#000" }}>
                <iframe
                  src={buildYouTubeEmbedUrl(youtubeVideoId, clip.start_seconds, clip.end_seconds)}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: 0 }}
                  allow="autoplay; encrypted-media"
                  allowFullScreen
                />
              </div>

              <button
                onClick={() => handleDownloadClip(clip, i)}
                disabled={downloadingClip === i}
                style={{
                  padding: "10px 16px",
                  borderRadius: 8,
                  border: 0,
                  background: downloadingClip === i ? "#ccc" : "#f97316",
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: "0.9rem",
                  cursor: downloadingClip === i ? "wait" : "pointer",
                }}
              >
                {downloadingClip === i ? "Downloading..." : "Download MP4"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Upload Clips */}
      {mode === "upload" && clips.length > 0 && (
        <div style={{ marginTop: 32, display: "flex", flexDirection: "column", gap: 20, maxWidth: 500, marginLeft: "auto", marginRight: "auto" }}>
          {clips.map((item, i) => (
            <div
              key={i}
              style={{
                background: "#fff",
                border: "1px solid #e0e0e0",
                borderRadius: 12,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Clip #{i + 1}</span>
                <span style={{
                  fontSize: "0.8rem",
                  color: "#f97316",
                  background: "#fff7ed",
                  padding: "2px 10px",
                  borderRadius: 20,
                }}>
                  Score: {item.clip.score}
                </span>
              </div>

              <div style={{ fontSize: "0.8rem", color: "#999", display: "flex", gap: 16 }}>
                <span>{item.clip.start}s → {item.clip.end}s</span>
                <span>{(item.blob.size / 1024 / 1024).toFixed(1)} MB</span>
              </div>

              {item.clip.reason && (
                <div style={{ fontSize: "0.85rem", color: "#666", fontStyle: "italic" }}>
                  {item.clip.reason}
                </div>
              )}

              <video
                src={clipUrls[i]}
                controls
                preload="metadata"
                style={{ width: "100%", borderRadius: 8, background: "#000", maxHeight: 400 }}
              />

              <a
                href={clipUrls[i]}
                download={item.filename}
                style={{
                  display: "block",
                  textAlign: "center",
                  padding: "10px 16px",
                  borderRadius: 8,
                  background: "#f97316",
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: "0.9rem",
                  textDecoration: "none",
                }}
              >
                Download MP4
              </a>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function stepLabel(step: Step): string {
  switch (step) {
    case "fetching-transcript": return "Fetching transcript";
    case "loading-ffmpeg": return "Loading FFmpeg";
    case "extracting": return "Extracting audio";
    case "transcribing": return "Transcribing";
    case "scoring": return "Analyzing";
    case "cutting": return "Cutting clips";
    default: return "";
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

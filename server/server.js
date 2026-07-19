const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { execFile } = require("child_process");
const { v4: uuid } = require("uuid");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const TMP_DIR = "/tmp/viral-clips";

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: "1mb" }));

const limiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: "Too many requests" } });
app.use("/api/download", limiter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: "1.0.0" });
});

app.post("/api/download", (req, res) => {
  const { url, start, end } = req.body;

  if (!url || typeof url !== "string") return res.status(400).json({ error: "Missing url" });
  if (typeof start !== "number" || typeof end !== "number") return res.status(400).json({ error: "Missing start/end" });
  if (start >= end) return res.status(400).json({ error: "start must be less than end" });
  if (end - start > 120) return res.status(400).json({ error: "Max clip length is 120 seconds" });

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: "Invalid YouTube URL" });

  const clipId = uuid();
  const outFile = path.join(TMP_DIR, `${clipId}.mp4`);
  const timeRange = `${start}-${end}`;

  const args = [
    "--download-sections", `*${timeRange}`,
    "--force-keyframes-at-cuts",
    "--no-playlist",
    "-f", "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best",
    "--merge-output-format", "mp4",
    "-o", outFile,
    `https://www.youtube.com/watch?v=${videoId}`,
  ];

  console.log(`[download] ${videoId} ${timeRange}`);

  const proc = execFile("yt-dlp", args, { timeout: 120000 }, (err) => {
    if (err) {
      console.error("[download] yt-dlp error:", err.message);
      cleanup(outFile);
      if (!res.headersSent) return res.status(500).json({ error: "Download failed" });
      return;
    }

    if (!fs.existsSync(outFile)) {
      return res.status(500).json({ error: "Clip file not created" });
    }

    const stat = fs.statSync(outFile);
    if (stat.size > 100 * 1024 * 1024) {
      cleanup(outFile);
      return res.status(500).json({ error: "Clip too large" });
    }

    console.log(`[download] done ${clipId} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="clip_${Math.round(start)}-${Math.round(end)}.mp4"`);
    res.setHeader("Content-Length", stat.size);

    const stream = fs.createReadStream(outFile);
    stream.pipe(res);
    stream.on("end", () => cleanup(outFile));
    stream.on("error", () => cleanup(outFile));
  });

  req.on("close", () => {
    if (proc && proc.pid) proc.kill();
    cleanup(outFile);
  });
});

function cleanup(filePath) {
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
}

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

app.listen(PORT, () => {
  console.log(`Download server running on port ${PORT}`);
});

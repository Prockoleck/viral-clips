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

const jobs = new Map();

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: "1.1.1" });
});

app.post("/api/download", (req, res) => {
  const { url, start, end } = req.body;

  if (!url || typeof url !== "string") return res.status(400).json({ error: "Missing url" });
  if (typeof start !== "number" || typeof end !== "number") return res.status(400).json({ error: "Missing start/end" });
  if (start >= end) return res.status(400).json({ error: "start must be less than end" });
  if (end - start > 120) return res.status(400).json({ error: "Max clip length is 120 seconds" });

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: "Invalid YouTube URL" });

  const jobId = uuid();
  const outFile = path.join(TMP_DIR, `${jobId}.mp4`);
  const timeRange = `${start}-${end}`;

  jobs.set(jobId, { status: "downloading", file: outFile, startedAt: Date.now() });

  const args = [
    "--download-sections", `*${timeRange}`,
    "--force-keyframes-at-cuts",
    "--no-playlist",
    "-f", "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best",
    "--merge-output-format", "mp4",
    "--http1.1",
    "-o", outFile,
    `https://www.youtube.com/watch?v=${videoId}`,
  ];

  console.log(`[download] starting ${jobId} ${videoId} ${timeRange}`);

  const proc = execFile("yt-dlp", args, { timeout: 120000 }, (err) => {
    if (err) {
      console.error(`[download] ${jobId} error:`, err.message);
      jobs.set(jobId, { status: "error", error: "Download failed" });
      cleanup(outFile);
      return;
    }

    if (!fs.existsSync(outFile)) {
      jobs.set(jobId, { status: "error", error: "Clip file not created" });
      return;
    }

    const stat = fs.statSync(outFile);
    if (stat.size > 100 * 1024 * 1024) {
      jobs.set(jobId, { status: "error", error: "Clip too large" });
      cleanup(outFile);
      return;
    }

    console.log(`[download] done ${jobId} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
    jobs.set(jobId, { status: "ready", file: outFile, size: stat.size });
  });

  req.on("close", () => {
    if (proc && proc.pid) proc.kill();
  });

  res.json({ jobId });
});

app.get("/api/download/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });

  if (job.status === "downloading") {
    const elapsed = Date.now() - job.startedAt;
    if (elapsed > 120000) {
      jobs.set(req.params.jobId, { status: "error", error: "Download timed out" });
      return res.json({ status: "error", error: "Download timed out" });
    }
    return res.json({ status: "downloading" });
  }

  if (job.status === "error") {
    return res.json({ status: "error", error: job.error });
  }

  if (job.status === "ready") {
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="clip.mp4"`);
    res.setHeader("Content-Length", job.size);

    const stream = fs.createReadStream(job.file);
    stream.pipe(res);
    stream.on("end", () => {
      cleanup(job.file);
      jobs.delete(req.params.jobId);
    });
    stream.on("error", () => {
      cleanup(job.file);
      jobs.delete(req.params.jobId);
    });
  }
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

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.startedAt > 300000) {
      cleanup(job.file);
      jobs.delete(id);
    }
  }
}, 60000);

app.listen(PORT, () => {
  console.log(`Download server running on port ${PORT}`);
});

import express from "express";
import helmet from "helmet";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { renderVideo } from "./video.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(express.json({ limit: "2mb" }));

const PORT = Number(process.env.PORT || 8080);
const SECRET = process.env.RENDER_WORKER_SECRET;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.resolve("outputs");
const jobs = new Map();

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
app.use("/outputs", express.static(OUTPUT_DIR, { fallthrough: false, maxAge: "1h" }));

function auth(req, res, next) {
  const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!SECRET || !supplied || supplied.length !== SECRET.length ||
      !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(SECRET))) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

const RenderSchema = z.object({
  scenes: z.array(z.string().url()).min(1).max(12),
  voiceoverUrl: z.string().url().optional(),
  musicUrl: z.string().url().optional(),
  subtitlesSrt: z.string().max(200000).optional(),
  durationSeconds: z.number().int().min(5).max(180).default(60),
  title: z.string().max(120).optional()
});

app.get("/health", (_req, res) => res.json({ ok: true, service: "sheru-render-worker" }));

app.post("/render", auth, async (req, res) => {
  const parsed = RenderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid render request", details: parsed.error.flatten() });

  const id = crypto.randomUUID();
  const job = { id, status: "queued", progress: 0, createdAt: new Date().toISOString() };
  jobs.set(id, job);
  res.status(202).json({ jobId: id, status: "queued", statusUrl: `/jobs/${id}` });

  // This starter stores job state in memory. Use a persistent queue/database for multi-instance production deployments.
  setImmediate(async () => {
    try {
      Object.assign(job, { status: "processing", progress: 5 });
      const result = await renderVideo({
        ...parsed.data,
        jobId: id,
        outputDir: OUTPUT_DIR,
        onProgress: (progress) => { job.progress = progress; }
      });
      const relative = `/outputs/${path.basename(result.filePath)}`;
      job.status = "completed";
      job.progress = 100;
      job.videoUrl = PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL.replace(/\/$/, "")}${relative}` : relative;
      job.completedAt = new Date().toISOString();
    } catch (err) {
      console.error(`[${id}] render failed`, err);
      job.status = "failed";
      job.error = String(err?.message || "Render failed").slice(0, 1000);
    }
  });
});

app.get("/jobs/:id", auth, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

app.listen(PORT, () => console.log(`Sheru render worker listening on ${PORT}`));

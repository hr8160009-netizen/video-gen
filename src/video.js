import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", d => { stderr += d.toString(); if (stderr.length > 12000) stderr = stderr.slice(-12000); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${stderr}`)));
  });
}

async function download(url, dest) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only HTTP(S) media URLs are allowed");
  const response = await fetch(url, { signal: AbortSignal.timeout(120000), redirect: "error" });
  if (!response.ok) throw new Error(`Media download failed (${response.status})`);
  const type = response.headers.get("content-type") || "";
  if (type.includes("text/html")) throw new Error("Media URL returned HTML, not a media file");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 250 * 1024 * 1024) throw new Error("Media file exceeds 250 MB limit");
  await fs.promises.writeFile(dest, buffer);
}

export async function renderVideo({ scenes, voiceoverUrl, musicUrl, subtitlesSrt, durationSeconds, jobId, outputDir, onProgress }) {
  const work = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sheru-"));
  const downloaded = [];
  try {
    for (let i = 0; i < scenes.length; i++) {
      const file = path.join(work, `scene-${i}.mp4`);
      await download(scenes[i], file);
      downloaded.push(file);
      onProgress?.(5 + Math.round((i + 1) / (scenes.length + 3) * 35));
    }

    let voicePath, musicPath, subtitlePath;
    if (voiceoverUrl) {
      voicePath = path.join(work, "voice.mp3");
      await download(voiceoverUrl, voicePath);
    }
    if (musicUrl) {
      musicPath = path.join(work, "music.mp3");
      await download(musicUrl, musicPath);
    }
    if (subtitlesSrt?.trim()) {
      subtitlePath = path.join(work, "captions.srt");
      await fs.promises.writeFile(subtitlePath, subtitlesSrt, "utf8");
    }

    // Normalize each clip before concatenation. This avoids mismatched dimensions/codecs.
    const normalized = [];
    for (let i = 0; i < downloaded.length; i++) {
      const out = path.join(work, `normalized-${i}.mp4`);
      await run("ffmpeg", [
        "-y", "-i", downloaded[i],
        "-vf", "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=30,setsar=1",
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", out
      ]);
      normalized.push(out);
      onProgress?.(40 + Math.round((i + 1) / (downloaded.length + 2) * 25));
    }

    const concatList = path.join(work, "concat.txt");
    await fs.promises.writeFile(concatList, normalized.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
    const joined = path.join(work, "joined.mp4");
    await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", concatList, "-c", "copy", joined]);

    const outputName = `${jobId}.mp4`;
    const outputPath = path.join(outputDir, outputName);
    const args = ["-y", "-i", joined];
    if (voicePath) args.push("-i", voicePath);
    if (musicPath) args.push("-stream_loop", "-1", "-i", musicPath);

    let filter = "";
    const audioInputs = [];
    if (voicePath) audioInputs.push("[1:a]");
    if (musicPath) audioInputs.push(`[${voicePath ? 2 : 1}:a]`);
    if (audioInputs.length === 2) {
      filter = "[1:a]volume=1.0[voice];[2:a]volume=0.16[music];[voice][music]amix=inputs=2:duration=longest:dropout_transition=2[aout]";
    } else if (audioInputs.length === 1) {
      filter = `${audioInputs[0]}volume=${voicePath ? "1.0" : "0.16"}[aout]`;
    }

    if (subtitlePath) {
      const escaped = subtitlePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
      args.push("-vf", `subtitles='${escaped}':force_style='FontSize=22,Outline=2,Shadow=1,Alignment=2,MarginV=65'`);
    }
    if (filter) args.push("-filter_complex", filter, "-map", "0:v:0", "-map", "[aout]");
    else args.push("-map", "0:v:0", "-map", "0:a?");
    args.push("-t", String(durationSeconds), "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
      "-movflags", "+faststart", outputPath);
    await run("ffmpeg", args);
    onProgress?.(95);

    const stat = await fs.promises.stat(outputPath);
    if (!stat.size) throw new Error("FFmpeg produced an empty output file");
    return { filePath: outputPath };
  } finally {
    await fs.promises.rm(work, { recursive: true, force: true });
  }
}

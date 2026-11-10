# Sheru AI Studio — Rendering Worker

A small Node.js + FFmpeg service that accepts scene video URLs, optional Urdu voiceover/audio, and optional SRT subtitles, then renders a vertical MP4.

## Important limitations

- This is the rendering component only. It does not generate stories, images, videos, or Urdu speech. Those are created by the Lovable backend/provider integrations.
- The starter stores jobs in memory. Restarting the service loses job status. For production/multiple replicas, move jobs to a persistent database/queue (for example Supabase + a queue worker).
- Output files are stored on disk. Deploy with a persistent disk/volume, or change the worker to upload results to Supabase Storage/S3.
- The public output URL must be reachable by Lovable. Do not expose private source media.
- Use only media URLs you own or are authorized to process.
- Exact 60 seconds is enforced with FFmpeg `-t 60`; scenes may be cut at the end to fit.

## Run locally

Requires Docker.

```bash
cp .env.example .env
# Set RENDER_WORKER_SECRET to a long random value.
docker build -t sheru-render-worker .
docker run --env-file .env -p 8080:8080 -v sheru-output:/app/outputs sheru-render-worker
```

Health check:
`GET http://localhost:8080/health`

## API

All render/job endpoints require:
`Authorization: Bearer YOUR_RENDER_WORKER_SECRET`

### Start render

`POST /render`

```json
{
  "scenes": [
    "https://your-storage.example.com/scene-1.mp4",
    "https://your-storage.example.com/scene-2.mp4"
  ],
  "voiceoverUrl": "https://your-storage.example.com/urdu-voice.mp3",
  "musicUrl": "https://your-storage.example.com/music.mp3",
  "subtitlesSrt": "1\n00:00:00,000 --> 00:00:03,000\nالسلام علیکم!\n",
  "durationSeconds": 60,
  "title": "Sheru Bhai Auction"
}
```

Response (HTTP 202):
```json
{ "jobId": "uuid", "status": "queued", "statusUrl": "/jobs/uuid" }
```

### Poll status

`GET /jobs/{jobId}`

Completed response includes `videoUrl`; failed response includes `error`.

## Lovable secrets

After deploying, set:

- `RENDER_WORKER_URL` = the deployed base URL, e.g. `https://your-service.example.com` (no trailing slash)
- `RENDER_WORKER_SECRET` = exactly the same secret configured on the worker

Lovable backend should:
1. POST to `${RENDER_WORKER_URL}/render`.
2. Send `Authorization: Bearer ${RENDER_WORKER_SECRET}`.
3. Save returned `jobId`.
4. Poll `${RENDER_WORKER_URL}/jobs/${jobId}` with the same authorization header.
5. When status is `completed`, save `videoUrl` to the user's video record.
6. When status is `failed`, display the returned error and allow retry.

Never call this worker directly from browser code. Call it from a server-side Edge Function.

## Deployment

Deploy this Dockerfile to a container host that supports Docker and persistent disks. Configure the environment variables above, expose port 8080, and set `PUBLIC_BASE_URL` to the public HTTPS service URL. Availability and pricing of hosting free tiers change; check the host's current limits before choosing a plan.

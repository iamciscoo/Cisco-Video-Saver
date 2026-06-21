const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");

const root = __dirname;
const downloadsDir = path.join(root, "downloads");
const defaultPython = process.platform === "win32"
  ? path.join(root, "yt-session-generator-source", ".venv", "Scripts", "python.exe")
  : "python3";
const defaultNodeRuntime = process.platform === "win32"
  ? "C:\\Users\\Administrator\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin\\node.exe"
  : "node";
const defaultFfmpegDir = process.platform === "win32"
  ? path.join(root, "cobalt-source", "node_modules", ".pnpm", "ffmpeg-static@5.3.0", "node_modules", "ffmpeg-static")
  : "/usr/bin";
const python = process.env.YT_DLP_PYTHON || defaultPython;
const nodeRuntime = process.env.YT_DLP_NODE || defaultNodeRuntime;
const ffmpegDir = process.env.YT_DLP_FFMPEG_LOCATION || defaultFfmpegDir;
const port = Number(process.env.YT_DLP_WEB_PORT || 8787);
const host = process.env.YT_DLP_WEB_HOST || "127.0.0.1";
const jobsFile = process.env.YT_DLP_JOBS_FILE || path.join(root, "youtube-downloader-jobs.json");

const jobs = new Map();

fs.mkdirSync(downloadsDir, { recursive: true });

function loadJobs() {
  try {
    const saved = JSON.parse(fs.readFileSync(jobsFile, "utf8"));
    if (!Array.isArray(saved)) return;

    for (const job of saved) {
      if (!job?.id) continue;
      jobs.set(job.id, {
        ...job,
        status: job.status === "running" ? "error" : job.status,
        message: job.status === "running" ? "interrupted by server restart" : job.message,
        logs: [],
        clients: new Set(),
        child: null,
      });
    }
  } catch {}
}

function saveJobs() {
  const serializable = [...jobs.values()]
    .filter(job => job.status !== "running")
    .slice(-100)
    .map(job => {
      const { child, clients, logs, ...rest } = job;
      return rest;
    });

  try {
    fs.writeFileSync(jobsFile, JSON.stringify(serializable, null, 2));
  } catch {}
}

loadJobs();

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "access-control-allow-origin": "*",
    "cross-origin-resource-policy": "cross-origin",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function runYtDlp(args, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, {
      cwd: root,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("yt-dlp timed out while reading video info"));
    }, timeoutMs);

    child.stdout.on("data", chunk => stdout += chunk.toString("utf8"));
    child.stderr.on("data", chunk => stderr += chunk.toString("utf8"));
    child.on("error", error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", code => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
      }
    });
  });
}

async function getFormats(videoUrl) {
  const args = [
    "-m", "yt_dlp",
    "--js-runtimes", `node:${nodeRuntime}`,
    "--ffmpeg-location", ffmpegDir,
    "--dump-single-json",
    "--skip-download",
    videoUrl,
  ];

  const { stdout } = await runYtDlp(args);
  const info = JSON.parse(stdout);
  const formats = Array.isArray(info.formats) ? info.formats : [];

  const qualities = [...new Set(
    formats
      .filter(format => format.vcodec && format.vcodec !== "none" && Number(format.height) > 0)
      .map(format => Number(format.height))
  )].sort((a, b) => b - a);

  const sizeOf = format => Number(format?.filesize || format?.filesize_approx || 0);
  const scoreOf = format => Number(format?.tbr || format?.vbr || format?.abr || 0) || sizeOf(format);
  const audioCandidates = formats
    .filter(format => format.acodec && format.acodec !== "none" && (!format.vcodec || format.vcodec === "none"));
  const preferredAudio = audioCandidates
    .filter(format => format.ext === "m4a")
    .sort((a, b) => scoreOf(b) - scoreOf(a))[0];
  const bestAudio = preferredAudio || audioCandidates.sort((a, b) => scoreOf(b) - scoreOf(a))[0];

  const qualityDetails = qualities.map(height => {
    const videoCandidates = formats
      .filter(format => (
        format.vcodec
        && format.vcodec !== "none"
        && Number(format.height) === height
        && (!format.acodec || format.acodec === "none")
      ));
    const preferredVideo = videoCandidates
      .filter(format => format.ext === "mp4")
      .sort((a, b) => scoreOf(b) - scoreOf(a))[0];
    const bestVideo = preferredVideo || videoCandidates.sort((a, b) => scoreOf(b) - scoreOf(a))[0];
    const estimatedSize = sizeOf(bestVideo) + sizeOf(bestAudio);

    return {
      quality: height,
      ext: bestVideo?.ext || "mp4",
      fps: bestVideo?.fps || null,
      formatId: bestVideo?.format_id ? String(bestVideo.format_id) : null,
      audioFormatId: bestAudio?.format_id ? String(bestAudio.format_id) : null,
      estimatedSize: estimatedSize || null,
      videoSize: sizeOf(bestVideo) || null,
      audioSize: sizeOf(bestAudio) || null,
    };
  });

  const audioFormats = formats
    .filter(format => format.acodec && format.acodec !== "none" && (!format.vcodec || format.vcodec === "none"))
    .map(format => ({
      id: String(format.format_id || ""),
      ext: format.ext || "",
      abr: format.abr || null,
      filesize: format.filesize || format.filesize_approx || null,
    }));

  return {
    title: info.title || "",
    duration: info.duration || null,
    thumbnail: info.thumbnail || "",
    qualities: qualities.length ? qualities : [1080, 720, 480, 360],
    qualityDetails,
    audioFormats,
  };
}

function fileSizeForJob(job) {
  if (Number(job.fileSize) > 0) return Number(job.fileSize);
  if (!job.file) return null;

  const direct = path.resolve(job.file);
  const file = fs.existsSync(direct) ? direct : resolveDownloadFile(path.basename(job.file));
  if (!file) return null;

  try {
    const stat = fs.statSync(file);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    title: job.title,
    mode: job.mode,
    quality: job.quality,
    progress: job.progress,
    message: job.message,
    file: job.file ? path.basename(job.file) : null,
    fileUrl: job.file ? `/api/jobs/${job.id}/file` : null,
    fileSize: fileSizeForJob(job),
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function emit(job) {
  job.updatedAt = new Date().toISOString();
  if (job.status !== "running") {
    saveJobs();
  }
  const payload = `data: ${JSON.stringify(publicJob(job))}\n\n`;
  for (const client of job.clients) {
    client.write(payload);
  }
}

function parseProgress(job, text) {
  for (const rawLine of text.replace(/\r/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const destination = line.match(/^\[download\] Destination: (.+)$/);
    if (destination) {
      job.file = path.resolve(root, destination[1]);
    }

    const merged = line.match(/^\[Merger\] Merging formats into "(.+)"$/);
    if (merged) {
      job.file = path.resolve(root, merged[1]);
      job.message = "merging video and audio";
    }

    const deleting = line.match(/^Deleting original file (.+) \(pass/);
    if (deleting) {
      job.message = "cleaning temporary files";
    }

    const progress = line.match(/^\[download\]\s+([0-9.]+)%\s+of\s+(.+?)(?:\s+at\s+(.+?))?(?:\s+ETA\s+(.+))?$/);
    if (progress) {
      job.progress = {
        percent: Number(progress[1]),
        total: progress[2],
        speed: progress[3] || "",
        eta: progress[4] || "",
      };
      job.message = `downloading ${job.progress.percent}%`;
    } else if (line.includes("has already been downloaded")) {
      const existing = line.match(/^\[download\]\s+(.+?)\s+has already been downloaded$/);
      if (existing) {
        job.file = path.resolve(root, existing[1]);
      }
      job.progress = { percent: 100, total: "", speed: "", eta: "" };
      job.message = "already downloaded";
    } else if (line.startsWith("[ExtractAudio]")) {
      job.message = "extracting audio";
    } else if (line.startsWith("[VideoConvertor]")) {
      job.message = "converting video";
    } else if (line.startsWith("ERROR:")) {
      job.error = line;
    }

    job.logs.push(line);
    if (job.logs.length > 200) job.logs.shift();
  }
}

async function resolveDownloadFormat({ url, mode, quality }) {
  if (mode === "audio") {
    const info = await getFormats(url);
    const bestAudio = info.audioFormats
      .filter(format => format.id)
      .sort((a, b) => Number(b.abr || 0) - Number(a.abr || 0))[0];
    return bestAudio?.id || "ba";
  }

  const info = await getFormats(url);
  const target = Number(quality || 1080);
  const details = [...(info.qualityDetails || [])]
    .filter(item => item.formatId && Number(item.quality) <= target)
    .sort((a, b) => Number(b.quality) - Number(a.quality));
  const selected = details[0];

  if (selected?.formatId && selected?.audioFormatId) {
    return `${selected.formatId}+${selected.audioFormatId}`;
  }

  if (selected?.formatId) {
    return selected.formatId;
  }

  return `bv*[height<=${quality}][ext=mp4]+ba[ext=m4a]/bv*[height<=${quality}]+ba/b[height<=${quality}]/best`;
}

async function startDownload({ url, mode, quality }) {
  const format = await resolveDownloadFormat({ url, mode, quality });
  const id = randomUUID();
  const job = {
    id,
    url,
    mode,
    quality,
    title: url,
    status: "running",
    progress: { percent: 0, total: "", speed: "", eta: "" },
    message: "starting",
    file: null,
    error: null,
    logs: [],
    clients: new Set(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  jobs.set(id, job);

  const outputSuffix = `${mode}-${mode === "audio" ? "best" : (quality || "best")}-${id.slice(0, 8)}`;
  const template = path.join(downloadsDir, `%(title).100s.${outputSuffix}.%(ext)s`);
  const args = [
    "-m", "yt_dlp",
    "--newline",
    "--no-continue",
    "--js-runtimes", `node:${nodeRuntime}`,
    "--ffmpeg-location", ffmpegDir,
    "--merge-output-format", "mp4",
    "-f", format,
    "-o", template,
    url,
  ];

  const child = spawn(python, args, {
    cwd: root,
    windowsHide: true,
  });

  job.child = child;

  const onOutput = chunk => {
    parseProgress(job, chunk.toString("utf8"));
    emit(job);
  };

  child.stdout.on("data", onOutput);
  child.stderr.on("data", onOutput);

  child.on("error", error => {
    job.status = "error";
    job.error = error.message;
    job.message = "failed to start downloader";
    emit(job);
  });

  child.on("close", code => {
    if (job.status === "cancelled") {
      job.message = "cancelled";
    } else if (code === 0) {
      job.status = "complete";
      job.progress.percent = 100;
      job.message = "complete";
      job.fileSize = fileSizeForJob(job);
    } else {
      job.status = "error";
      job.error ||= `yt-dlp exited with code ${code}`;
      job.message = "failed";
    }
    saveJobs();
    emit(job);
    for (const client of job.clients) client.end();
  });

  return job;
}

function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;

  if (job.status === "running") {
    job.status = "cancelled";
    job.message = "cancelled";
    job.error = null;
    try {
      job.child?.kill("SIGTERM");
    } catch {}
    saveJobs();
    emit(job);
    for (const client of job.clients) client.end();
  }

  return job;
}

function removeJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return false;

  if (job.status === "running") {
    try {
      job.child?.kill("SIGTERM");
    } catch {}
  }

  jobs.delete(jobId);
  saveJobs();
  return true;
}

function serveStatic(res) {
  sendJson(res, 200, {
    ok: true,
    service: "cobalt-youtube-downloader",
    message: "Use the merged YouTube controls in Cobalt at http://localhost:5173/.",
    endpoints: ["/api/formats", "/api/download", "/api/jobs"],
  });
}

function sendNoContent(res) {
  res.writeHead(204, {
    "access-control-allow-origin": "*",
    "cross-origin-resource-policy": "cross-origin",
  });
  res.end();
}

function serveFile(req, res, fileName) {
  const safeName = path.basename(decodeURIComponent(fileName));
  const file = resolveDownloadFile(safeName);

  if (!file) {
    res.writeHead(404);
    res.end("not found");
    return;
  }

  sendFile(req, res, file);
}

function normalizeName(name) {
  return name
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .trim()
    .toLowerCase();
}

function resolveDownloadFile(name) {
  const safeName = path.basename(name);
  const direct = path.join(downloadsDir, safeName);

  if (direct.startsWith(downloadsDir) && fs.existsSync(direct)) {
    return direct;
  }

  const requested = normalizeName(safeName);
  const files = fs.readdirSync(downloadsDir);
  const match = files.find(file => normalizeName(file) === requested)
    || files.find(file => normalizeName(file).includes(requested) || requested.includes(normalizeName(file)));

  if (!match) return null;

  const matchedFile = path.join(downloadsDir, match);
  if (!matchedFile.startsWith(downloadsDir) || !fs.existsSync(matchedFile)) {
    return null;
  }

  return matchedFile;
}

function getNewestDownloadFile() {
  const files = fs.readdirSync(downloadsDir)
    .map(name => {
      const file = path.join(downloadsDir, name);
      const stat = fs.statSync(file);
      return stat.isFile() ? { file, mtime: stat.mtimeMs } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);

  return files[0]?.file || null;
}

function contentDispositionFor(filename) {
  const fallback = filename
    .replace(/[^\x20-\x7E]+/g, "_")
    .replace(/["\\]/g, "")
    || "download";

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function sendFile(req, res, file) {
  const safeName = path.basename(file);
  const stat = fs.statSync(file);
  res.writeHead(200, {
    "content-type": "application/octet-stream",
    "content-length": stat.size,
    "content-disposition": contentDispositionFor(safeName),
    "access-control-allow-origin": "*",
    "cross-origin-resource-policy": "cross-origin",
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  fs.createReadStream(file).pipe(res);
}

function serveJobFile(req, res, jobId) {
  const job = jobs.get(jobId);
  if (!job?.file) {
    res.writeHead(404);
    res.end("not found");
    return;
  }

  const file = resolveDownloadFile(path.basename(job.file));
  if (!file) {
    res.writeHead(404);
    res.end("not found");
    return;
  }

  sendFile(req, res, file);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400",
        "cross-origin-resource-policy": "cross-origin",
      });
      res.end();
      return;
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return serveStatic(res);
    }

    if (req.method === "HEAD" && (url.pathname === "/" || url.pathname === "/health")) {
      return sendNoContent(res);
    }

    if (req.method === "POST" && url.pathname === "/api/download") {
      const body = JSON.parse(await readBody(req));
      const videoUrl = String(body.url || "").trim();
      const mode = body.mode === "audio" ? "audio" : "video";
      const quality = String(body.quality || "1080").replace(/[^\d]/g, "") || "1080";

      if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(videoUrl)) {
        return sendJson(res, 400, { error: "Please enter a YouTube URL." });
      }

      const job = await startDownload({ url: videoUrl, mode, quality });
      return sendJson(res, 200, publicJob(job));
    }

    if (req.method === "POST" && url.pathname === "/api/formats") {
      const body = JSON.parse(await readBody(req));
      const videoUrl = String(body.url || "").trim();

      if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(videoUrl)) {
        return sendJson(res, 400, { error: "Please enter a YouTube URL." });
      }

      return sendJson(res, 200, await getFormats(videoUrl));
    }

    if (req.method === "GET" && url.pathname === "/api/jobs") {
      return sendJson(res, 200, [...jobs.values()].map(publicJob).reverse());
    }

    const cancelMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
    if (req.method === "POST" && cancelMatch) {
      const job = cancelJob(cancelMatch[1]);
      if (!job) return sendJson(res, 404, { error: "job not found" });
      return sendJson(res, 200, publicJob(job));
    }

    const deleteJobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (req.method === "DELETE" && deleteJobMatch) {
      if (!removeJob(deleteJobMatch[1])) {
        return sendJson(res, 404, { error: "job not found" });
      }
      return sendJson(res, 200, { ok: true });
    }

    const eventsMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/events$/);
    if (req.method === "GET" && eventsMatch) {
      const job = jobs.get(eventsMatch[1]);
      if (!job) return sendJson(res, 404, { error: "job not found" });

      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "connection": "keep-alive",
        "access-control-allow-origin": "*",
        "cross-origin-resource-policy": "cross-origin",
      });
      job.clients.add(res);
      res.write(`data: ${JSON.stringify(publicJob(job))}\n\n`);
      req.on("close", () => job.clients.delete(res));
      return;
    }

    const jobFileMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/file$/);
    if ((req.method === "GET" || req.method === "HEAD") && jobFileMatch) {
      return serveJobFile(req, res, jobFileMatch[1]);
    }

    const fileMatch = url.pathname.match(/^\/files\/(.+)$/);
    if ((req.method === "GET" || req.method === "HEAD") && fileMatch) {
      return serveFile(req, res, fileMatch[1]);
    }

    res.writeHead(404);
    res.end("not found");
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`YouTube downloader running at http://${host}:${port}/`);
  console.log(`Downloads folder: ${downloadsDir}`);
});

(function () {
  const API = "http://localhost:8787";
  const YOUTUBE_RE = /^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|music\.youtube\.com)\//i;
  const DEFAULT_QUALITIES = [1080, 720, 480, 360];

  const SERVICES = {
    bilibili: "https://www.bilibili.com/",
    bluesky: "https://bsky.app/",
    dailymotion: "https://www.dailymotion.com/",
    facebook: "https://www.facebook.com/watch/",
    instagram: "https://www.instagram.com/",
    loom: "https://www.loom.com/",
    ok: "https://ok.ru/video",
    pinterest: "https://www.pinterest.com/",
    newgrounds: "https://www.newgrounds.com/",
    reddit: "https://www.reddit.com/",
    rutube: "https://rutube.ru/",
    snapchat: "https://www.snapchat.com/spotlight",
    soundcloud: "https://soundcloud.com/",
    streamable: "https://streamable.com/",
    tiktok: "https://www.tiktok.com/",
    tumblr: "https://www.tumblr.com/",
    "twitch clips": "https://www.twitch.tv/directory/following/clips",
    twitter: "https://x.com/",
    vimeo: "https://vimeo.com/",
    vk: "https://vk.com/video",
    youtube: "https://www.youtube.com/",
  };

  let formatAbort;
  let lastFormatUrl = "";
  let activeDownloads = 0;
  let selectedQuality = String(DEFAULT_QUALITIES[0]);
  let selectedMode = "video";
  let qualityInfo = new Map();

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else node.setAttribute(key, value);
    }
    for (const child of children) node.append(child);
    return node;
  }

  function getCobaltInput() {
    return document.querySelector("#link-area");
  }

  function getCobaltUrl() {
    return getCobaltInput()?.value?.trim() || "";
  }

  function isYouTubeUrl(url) {
    return YOUTUBE_RE.test(url);
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!value) return "";
    const units = ["B", "KB", "MB", "GB"];
    let size = value;
    let unit = 0;
    while (size >= 1000 && unit < units.length - 1) {
      size /= 1000;
      unit += 1;
    }
    return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)}${units[unit]}`;
  }

  function normalizeSizeText(text) {
    return String(text || "").replace(/([0-9]+(?:\.[0-9]+)?)(KiB|MiB|GiB)(\/s)?/g, (_, value, unit, suffix = "") => {
      const multipliers = { KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 };
      return `${formatBytes(Number(value) * multipliers[unit])}${suffix}`;
    });
  }

  function qualitySizeSummary(info) {
    const streamSize = formatBytes(info?.videoSize || info?.estimatedSize);
    const finalSize = formatBytes(info?.estimatedSize);
    if (streamSize && finalSize && streamSize !== finalSize) {
      return { chip: streamSize, detail: `video ${streamSize}, final est. ${finalSize}` };
    }
    if (finalSize) {
      return { chip: finalSize, detail: `final est. ${finalSize}` };
    }
    return { chip: "", detail: "" };
  }

  function getMode() {
    const cobaltAudio = document.querySelector("#setting-button-save-downloadMode-audio[aria-pressed='true']");
    return cobaltAudio ? "audio" : selectedMode;
  }

  function setStatus(text, type = "") {
    statusLine.textContent = text;
    inline.classList.toggle("ready", type === "ready");
    inline.classList.toggle("warn", type === "warn");
    inline.classList.toggle("error", type === "error");
  }

  function setIndicator(text, state = "") {
    indicatorText.textContent = text;
    indicator.title = text;
    indicator.className = state ? `local-yt-indicator ${state}` : "local-yt-indicator";
  }

  function setBusy(isBusy, text = "working") {
    indicator.classList.toggle("busy", isBusy);
    if (isBusy) setIndicator(text, "busy");
  }

  function describeSelectedQuality() {
    return `${selectedQuality}p`;
  }

  function setQualities(qualities, details = []) {
    const cleanQualities = (qualities?.length ? qualities : DEFAULT_QUALITIES)
      .map(quality => Number(quality))
      .filter(Boolean)
      .sort((a, b) => b - a);

    qualityInfo = new Map(
      details
        .filter(item => item?.quality)
        .map(item => [String(item.quality), item])
    );

    if (!cleanQualities.map(String).includes(selectedQuality)) {
      selectedQuality = String(cleanQualities[0]);
    }

    qualityList.textContent = "";
    for (const quality of cleanQualities) {
      const value = String(quality);
      const info = qualityInfo.get(value);
      const sizes = qualitySizeSummary(info);
      const button = el("button", {
        type: "button",
        class: value === selectedQuality ? "quality-chip selected" : "quality-chip",
        "data-quality": value,
        title: sizes.detail ? `${quality}p: ${sizes.detail}` : `${quality}p`,
      }, [
        el("span", { text: `${quality}p` }),
        sizes.chip ? el("small", { text: sizes.chip }) : document.createTextNode(""),
      ]);

      button.addEventListener("click", () => {
        selectedQuality = value;
        for (const chip of qualityList.querySelectorAll(".quality-chip")) {
          chip.classList.toggle("selected", chip.dataset.quality === selectedQuality);
        }
        setStatus(`Selected ${describeSelectedQuality()}`, "ready");
      });

      qualityList.append(button);
    }
  }

  function setMode(mode) {
    selectedMode = mode === "audio" ? "audio" : "video";
    videoModeButton.classList.toggle("selected", selectedMode === "video");
    audioModeButton.classList.toggle("selected", selectedMode === "audio");
    qualityList.hidden = selectedMode === "audio";
    setStatus(selectedMode === "audio" ? "Audio mode selected" : `Selected ${describeSelectedQuality()}`, "ready");
  }

  function showInline() {
    installInlineUi();
    inline.hidden = false;
    clearLinkButton.hidden = false;
    document.body.classList.add("local-yt-active");
  }

  function hideInline() {
    if (activeDownloads > 0) return;
    inline.hidden = true;
    clearLinkButton.hidden = true;
    document.body.classList.remove("local-yt-active");
    setIndicator("", "");
  }

  function clearCurrentLink() {
    formatAbort?.abort();
    lastFormatUrl = "";
    const input = getCobaltInput();
    if (input) {
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    }
    document.querySelector("#clear-button")?.click?.();
    hideInline();
  }

  function setThumbnail(src, title = "YouTube thumbnail") {
    if (!src) {
      thumbImage.removeAttribute("src");
      thumbWrap.hidden = true;
      inline.classList.remove("has-thumb");
      return;
    }

    thumbImage.src = src;
    thumbImage.alt = title;
    thumbWrap.hidden = false;
    inline.classList.add("has-thumb");
  }

  async function detectFormats(url) {
    if (!isYouTubeUrl(url)) {
      hideInline();
      return;
    }

    showInline();
    if (url === lastFormatUrl) return;
    lastFormatUrl = url;
    formatAbort?.abort();
    formatAbort = new AbortController();

    setQualities(DEFAULT_QUALITIES);
    setThumbnail("");
    titleLine.textContent = "Reading video options...";
    setStatus("Checking available qualities", "");
    setBusy(true, "checking");

    try {
      const response = await fetch(`${API}/api/formats`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
        signal: formatAbort.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not read video formats");

      setQualities(body.qualities || DEFAULT_QUALITIES, body.qualityDetails || []);
      titleLine.textContent = body.title || "YouTube video";
      setThumbnail(body.thumbnail || "", body.title || "YouTube thumbnail");
      setStatus(`Ready: ${describeSelectedQuality()}`, "ready");
      setIndicator("ready", "ready");
    } catch (error) {
      if (error.name === "AbortError") return;
      titleLine.textContent = "YouTube video";
      setThumbnail("");
      setStatus("Using default quality choices", "warn");
      setIndicator("ready", "ready");
    } finally {
      indicator.classList.remove("busy");
    }
  }

  async function cancelJob(jobId) {
    const response = await fetch(`${API}/api/jobs/${jobId}/cancel`, { method: "POST" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not cancel download");
    activeDownloads = Math.max(0, activeDownloads - 1);
    renderJob(body);
  }

  async function removeJob(jobId) {
    const response = await fetch(`${API}/api/jobs/${jobId}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not remove download");
    document.querySelector(`[data-local-yt-job="${jobId}"]`)?.remove();
    if (!getCobaltUrl() && !document.querySelector(".local-yt-job")) hideInline();
  }

  function renderJob(job) {
    showInline();

    let row = document.querySelector(`[data-local-yt-job="${job.id}"]`);
    if (!row) {
      const action = el("button", { type: "button", class: "job-action", title: "Cancel download", "aria-label": "Cancel download" });
      row = el("article", { class: "local-yt-job", "data-local-yt-job": job.id }, [
        el("div", { class: "job-top" }, [
          el("div", { class: "job-title" }),
          el("div", { class: "job-actions" }, [
            el("span", { class: "job-state" }),
            action,
          ]),
        ]),
        el("div", { class: "job-bar" }, [el("div", { class: "job-fill" })]),
        el("div", { class: "job-meta" }),
      ]);
      jobList.prepend(row);
    }

    const percent = Math.max(0, Math.min(100, Number(job.progress?.percent || 0)));
    row.querySelector(".job-title").textContent = job.file || titleLine.textContent || job.title || "YouTube download";
    row.querySelector(".job-state").textContent = job.status;
    row.querySelector(".job-fill").style.width = `${percent}%`;
    row.classList.toggle("complete", job.status === "complete");
    row.classList.toggle("failed", job.status === "error");
    row.classList.toggle("cancelled", job.status === "cancelled");

    const action = row.querySelector(".job-action");
    action.title = job.status === "running" ? "Cancel download" : "Remove from list";
    action.setAttribute("aria-label", action.title);
    action.onclick = async () => {
      action.disabled = true;
      try {
        if (job.status === "running") await cancelJob(job.id);
        else await removeJob(job.id);
      } catch (error) {
        setStatus(error.message || "Could not update download", "error");
      } finally {
        action.disabled = false;
      }
    };

    const meta = row.querySelector(".job-meta");
    meta.textContent = "";

    const pieces = job.status === "complete"
      ? [
        "100%",
        job.fileSize ? `${formatBytes(job.fileSize)} saved` : normalizeSizeText(job.progress?.total || ""),
        job.message || "",
      ].filter(Boolean)
      : [
        `${percent.toFixed(percent % 1 ? 1 : 0)}%`,
        normalizeSizeText(job.progress?.total || ""),
        normalizeSizeText(job.progress?.speed || ""),
        job.progress?.eta ? `ETA ${job.progress.eta}` : "",
        job.message || "",
      ].filter(Boolean);

    meta.append(document.createTextNode(pieces.join(" | ")));

    if (job.status === "complete" && job.file) {
      meta.append(document.createTextNode(" | "));
      meta.append(el("a", {
        href: `${API}${job.fileUrl || `/files/${encodeURIComponent(job.file)}`}`,
        text: "save file",
      }));
      setStatus("Download complete", "ready");
      setIndicator("done", "ready");
    }

    if (job.status === "cancelled") {
      setStatus("Download cancelled", "warn");
      setIndicator("cancelled", "warn");
    }

    if (job.status === "error") {
      meta.append(el("div", { class: "local-yt-error", text: job.error || "download failed" }));
      setStatus("Download failed", "error");
      setIndicator("failed", "error");
    }
  }

  function watch(jobId) {
    const events = new EventSource(`${API}/api/jobs/${jobId}/events`);
    events.onmessage = event => {
      const job = JSON.parse(event.data);
      renderJob(job);
      if (["complete", "error", "cancelled"].includes(job.status)) {
        activeDownloads = Math.max(0, activeDownloads - 1);
        events.close();
      }
    };
    events.onerror = () => {
      activeDownloads = Math.max(0, activeDownloads - 1);
      events.close();
      setStatus("Lost connection to the local YouTube backend", "error");
      setIndicator("failed", "error");
    };
  }

  async function startDownload(url, options = {}) {
    if (!isYouTubeUrl(url)) return false;

    showInline();
    downloadButton.disabled = true;
    activeDownloads += 1;
    setStatus("Starting download", "");
    setBusy(true, "downloading");

    try {
      const response = await fetch(`${API}/api/download`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          mode: options.mode || getMode(),
          quality: options.quality || selectedQuality,
        }),
      });

      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "local YouTube downloader failed");

      renderJob(body);
      watch(body.id);
      return true;
    } catch (error) {
      activeDownloads = Math.max(0, activeDownloads - 1);
      setStatus(error.message || "Failed to fetch", "error");
      setIndicator("failed", "error");
      return false;
    } finally {
      downloadButton.disabled = false;
      indicator.classList.remove("busy");
    }
  }

  function makeSupportedServicesLinks() {
    for (const node of document.querySelectorAll("#services-popover *")) {
      if (node.dataset?.localServiceLinked) continue;
      const key = node.textContent?.trim().toLowerCase();
      const href = SERVICES[key];
      if (!href) continue;

      node.dataset.localServiceLinked = "1";
      node.setAttribute("role", "link");
      node.setAttribute("tabindex", "0");
      node.setAttribute("title", `Open ${node.textContent.trim()}`);
      node.classList.add("local-service-link");
      node.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        window.open(href, "_blank", "noopener,noreferrer");
      });
      node.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        window.open(href, "_blank", "noopener,noreferrer");
      });
    }
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #input-container {
        position: relative;
      }
      .local-yt-active #link-area {
        padding-right: 132px !important;
      }
      .local-yt-clear,
      .local-yt-indicator {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        box-sizing: border-box;
        z-index: 4;
      }
      .local-yt-clear {
        right: 88px;
        display: none;
        width: 24px;
        height: 24px;
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: #eef0f4;
        color: #3f4653;
        cursor: pointer;
      }
      .local-yt-clear::before,
      .local-yt-clear::after,
      .job-action::before,
      .job-action::after {
        content: "";
        position: absolute;
        left: 50%;
        top: 50%;
        width: 10px;
        height: 2px;
        border-radius: 999px;
        background: currentColor;
        transform-origin: center;
      }
      .local-yt-clear::before,
      .job-action::before {
        transform: translate(-50%, -50%) rotate(45deg);
      }
      .local-yt-clear::after,
      .job-action::after {
        transform: translate(-50%, -50%) rotate(-45deg);
      }
      .local-yt-clear:hover {
        background: #dfe3ea;
      }
      .local-yt-active .local-yt-clear {
        display: grid;
        place-items: center;
      }
      .local-yt-indicator {
        right: 54px;
        display: none;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        padding: 0;
        border-radius: 999px;
        background: #eef2ff;
        color: #1d4ed8;
        font-size: 12px;
        pointer-events: none;
      }
      .local-yt-indicator span {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      .local-yt-active .local-yt-indicator {
        display: inline-flex;
      }
      .local-yt-indicator::before {
        content: "";
        flex: 0 0 auto;
        width: 10px;
        height: 10px;
        border-radius: 999px;
        border: 2px solid currentColor;
        border-right-color: transparent;
      }
      .local-yt-indicator.busy::before {
        animation: local-yt-spin .75s linear infinite;
      }
      .local-yt-indicator.ready {
        background: #ecfdf3;
        color: #166534;
      }
      .local-yt-indicator.ready::before {
        width: 14px;
        height: 10px;
        border-radius: 0;
        border: 0;
        background: currentColor;
        clip-path: polygon(14% 44%, 0 58%, 38% 100%, 100% 16%, 86% 0, 37% 65%);
        -webkit-clip-path: polygon(14% 44%, 0 58%, 38% 100%, 100% 16%, 86% 0, 37% 65%);
      }
      .local-yt-indicator.warn {
        background: #fff7ed;
        color: #9a3412;
      }
      .local-yt-indicator.error {
        background: #fef2f2;
        color: #b91c1c;
      }
      @keyframes local-yt-spin {
        to { transform: rotate(360deg); }
      }
      #local-yt-inline {
        width: min(680px, calc(100vw - 32px));
        box-sizing: border-box;
        margin-top: 10px;
        padding: 12px;
        border: 1px solid rgba(15, 23, 42, .12);
        border-radius: 8px;
        background: rgba(255, 255, 255, .98);
        color: #16181d;
        box-shadow: 0 10px 28px rgba(15, 23, 42, .08);
      }
      #local-yt-inline[hidden] {
        display: none;
      }
      .local-yt-top {
        display: grid;
        grid-template-columns: 128px minmax(0, 1fr);
        gap: 12px;
        align-items: start;
      }
      #local-yt-inline:not(.has-thumb) .local-yt-top {
        grid-template-columns: 1fr;
      }
      .local-yt-thumb {
        width: 128px;
        aspect-ratio: 16 / 9;
        overflow: hidden;
        border-radius: 7px;
        background: #f1f3f6;
        border: 1px solid #e4e8ef;
      }
      .local-yt-thumb[hidden] {
        display: none;
      }
      .local-yt-thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .local-yt-detail {
        min-width: 0;
      }
      .local-yt-header {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
        align-items: start;
      }
      #local-yt-title {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: normal;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        color: #2f3745;
        font-weight: 800;
        line-height: 1.35;
        font-size: 13px;
      }
      .local-yt-main-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .local-yt-mode {
        display: inline-grid;
        grid-template-columns: 1fr 1fr;
        padding: 2px;
        border: 1px solid #d7dce5;
        border-radius: 7px;
        background: #f6f7f9;
      }
      .mode-chip,
      .quality-chip,
      #local-yt-download,
      .job-action {
        font: inherit;
      }
      .mode-chip {
        height: 30px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: #4b5563;
        padding: 0 10px;
        cursor: pointer;
      }
      .mode-chip.selected {
        background: #111;
        color: #fff;
      }
      #local-yt-download {
        height: 34px;
        border: 0;
        border-radius: 7px;
        background: #111;
        color: #fff;
        padding: 0 13px;
        font-weight: 800;
        cursor: pointer;
      }
      #local-yt-download:disabled {
        opacity: .55;
        cursor: wait;
      }
      #local-yt-status {
        min-height: 18px;
        margin-top: 7px;
        color: #687080;
        font-size: 12px;
      }
      #local-yt-inline.ready #local-yt-status {
        color: #166534;
      }
      #local-yt-inline.warn #local-yt-status {
        color: #9a5b00;
      }
      #local-yt-inline.error #local-yt-status,
      .local-yt-error {
        color: #c0262d;
      }
      #local-yt-quality-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid #edf0f4;
      }
      #local-yt-quality-list[hidden] {
        display: none;
      }
      .quality-chip {
        display: inline-flex;
        align-items: baseline;
        gap: 5px;
        min-height: 30px;
        border: 1px solid #d7dce5;
        border-radius: 7px;
        background: #fff;
        color: #263040;
        padding: 4px 8px;
        max-width: 130px;
        cursor: pointer;
      }
      .quality-chip small {
        color: #687080;
        font-size: 10px;
      }
      .quality-chip.selected {
        border-color: #2563eb;
        background: #eff6ff;
        color: #174ea6;
      }
      #local-yt-jobs {
        display: grid;
        gap: 8px;
        max-height: 190px;
        margin-top: 8px;
        overflow: auto;
      }
      .local-yt-job {
        border-top: 1px solid #e3e7ee;
        padding-top: 8px;
      }
      .job-top {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
      }
      .job-title {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 800;
      }
      .job-actions {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .job-state,
      .job-meta {
        color: #687080;
        font-size: 12px;
      }
      .job-action {
        display: grid;
        place-items: center;
        position: relative;
        width: 24px;
        height: 24px;
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: #f1f3f6;
        color: #555f6f;
        cursor: pointer;
      }
      .job-action:hover {
        background: #fee2e2;
        color: #b91c1c;
      }
      .job-action:disabled {
        opacity: .5;
        cursor: wait;
      }
      .job-bar {
        height: 7px;
        margin: 7px 0;
        border-radius: 999px;
        overflow: hidden;
        background: #e7ebf2;
      }
      .job-fill {
        height: 100%;
        width: 0;
        background: #2563eb;
        transition: width .2s ease;
      }
      .local-yt-job.complete .job-fill {
        background: #16a34a;
      }
      .local-yt-job.failed .job-fill,
      .local-yt-job.cancelled .job-fill {
        background: #c0262d;
      }
      .job-meta a {
        color: #174ea6;
        font-weight: 800;
      }
      .local-service-link {
        cursor: pointer !important;
        text-decoration: none;
      }
      .local-service-link:hover {
        filter: brightness(.94);
        text-decoration: underline;
      }
      @media (max-width: 720px) {
        .local-yt-active #link-area {
          padding-right: 112px !important;
        }
        .local-yt-clear {
          right: 76px;
        }
        .local-yt-indicator {
          right: 44px;
        }
        .local-yt-top {
          grid-template-columns: 1fr;
        }
        .local-yt-thumb {
          width: 100%;
          max-width: 220px;
        }
        .local-yt-header {
          grid-template-columns: 1fr;
        }
        .local-yt-main-actions {
          justify-content: space-between;
        }
      }
    `;
    document.head.append(style);
  }

  injectStyles();

  const indicatorText = el("span");
  const indicator = el("div", { class: "local-yt-indicator" }, [indicatorText]);
  const clearLinkButton = el("button", { type: "button", class: "local-yt-clear", title: "Clear link", "aria-label": "Clear link", hidden: "" });
  const videoModeButton = el("button", { type: "button", class: "mode-chip selected", text: "video" });
  const audioModeButton = el("button", { type: "button", class: "mode-chip", text: "audio" });
  const qualityList = el("div", { id: "local-yt-quality-list", "aria-label": "YouTube quality choices" });
  const downloadButton = el("button", { type: "button", id: "local-yt-download", text: "Download" });
  const thumbImage = el("img", { alt: "YouTube thumbnail" });
  const thumbWrap = el("div", { class: "local-yt-thumb", hidden: "" }, [thumbImage]);
  const titleLine = el("div", { id: "local-yt-title", text: "YouTube local downloader" });
  const statusLine = el("div", { id: "local-yt-status", text: "Paste a YouTube link to detect qualities." });
  const jobList = el("div", { id: "local-yt-jobs" });
  const inline = el("section", { id: "local-yt-inline", hidden: "" }, [
    el("div", { class: "local-yt-top" }, [
      thumbWrap,
      el("div", { class: "local-yt-detail" }, [
        el("div", { class: "local-yt-header" }, [
          titleLine,
          el("div", { class: "local-yt-main-actions" }, [
            el("div", { class: "local-yt-mode", role: "group", "aria-label": "Download mode" }, [
              videoModeButton,
              audioModeButton,
            ]),
            downloadButton,
          ]),
        ]),
        statusLine,
        qualityList,
      ]),
    ]),
    jobList,
  ]);

  setQualities(DEFAULT_QUALITIES);

  function installInlineUi() {
    const inputContainer = document.querySelector("#input-container");
    const omnibox = document.querySelector("#omnibox");
    if (!inputContainer || !omnibox) return false;

    if (indicator.parentElement !== inputContainer) {
      inputContainer.append(indicator);
    }

    if (clearLinkButton.parentElement !== inputContainer) {
      inputContainer.append(clearLinkButton);
    }

    if (inline.parentElement !== omnibox.parentElement) {
      omnibox.insertAdjacentElement("afterend", inline);
    }

    return true;
  }

  function syncCurrentUrl() {
    if (!installInlineUi()) {
      document.body.classList.remove("local-yt-active");
      return false;
    }

    const url = getCobaltUrl();
    if (isYouTubeUrl(url)) {
      showInline();
      detectFormats(url);
    } else {
      hideInline();
    }

    return true;
  }

  const installTimer = setInterval(syncCurrentUrl, 250);
  setTimeout(() => clearInterval(installTimer), 10000);
  syncCurrentUrl();

  clearLinkButton.addEventListener("click", clearCurrentLink);
  videoModeButton.addEventListener("click", () => setMode("video"));
  audioModeButton.addEventListener("click", () => setMode("audio"));

  downloadButton.addEventListener("click", async () => {
    await startDownload(getCobaltUrl(), {
      mode: selectedMode,
      quality: selectedQuality,
    });
  });

  document.addEventListener("input", event => {
    if (event.target?.id !== "link-area") return;
    installInlineUi();
    const url = event.target.value.trim();
    if (isYouTubeUrl(url)) {
      showInline();
      setStatus("Processing link", "");
      setBusy(true, "checking");
      detectFormats(url);
    } else {
      hideInline();
    }
  }, true);

  document.addEventListener("click", event => {
    const pasteButton = event.target?.closest?.("#button-paste");
    if (pasteButton) {
      setTimeout(syncCurrentUrl, 80);
      setTimeout(syncCurrentUrl, 350);
      setTimeout(syncCurrentUrl, 900);
      return;
    }

    const button = event.target?.closest?.("#download-button");
    if (!button) return;

    installInlineUi();
    const url = getCobaltUrl();
    if (!isYouTubeUrl(url)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    startDownload(url).catch(error => {
      setStatus(error.message || "Failed to fetch", "error");
      setIndicator("failed", "error");
    });
  }, true);

  document.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.target?.id !== "link-area") return;

    installInlineUi();
    const url = getCobaltUrl();
    if (!isYouTubeUrl(url)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    startDownload(url).catch(error => {
      setStatus(error.message || "Failed to fetch", "error");
      setIndicator("failed", "error");
    });
  }, true);

  new MutationObserver(() => {
    makeSupportedServicesLinks();
    syncCurrentUrl();
  })
    .observe(document.body, { childList: true, subtree: true });
  makeSupportedServicesLinks();
  window.addEventListener("popstate", () => setTimeout(syncCurrentUrl, 0));
  window.addEventListener("hashchange", () => setTimeout(syncCurrentUrl, 0));
  window.addEventListener("pageshow", () => setTimeout(syncCurrentUrl, 0));
  window.addEventListener("focus", () => setTimeout(syncCurrentUrl, 0));

  fetch(`${API}/api/jobs`)
    .then(response => response.json())
    .then(items => items.forEach(renderJob))
    .catch(() => setStatus("Start the local YouTube downloader server to enable YouTube fallback.", "error"));
})();

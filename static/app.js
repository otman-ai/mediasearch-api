const API = "/api";

// ------------------------------------------------------------------ helpers
function mediaUrl(path) {
  return `${API}/media?path=${encodeURIComponent(path)}`;
}

function filenameOf(path) {
  return path.split(/[\\/]/).pop();
}

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function setStatus(el, message, kind) {
  el.textContent = message || "";
  el.className = "status" + (kind ? ` ${kind}` : "");
}

async function api(path, options) {
  const res = await fetch(`${API}${path}`, options);
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* no body */
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

// ---------------------------------------------------------------------- tabs
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

// -------------------------------------------------------------------- videos
const videoList = document.getElementById("video-list");
const videoSearchResults = document.getElementById("video-search-results");
const videoSearchStatus = document.getElementById("video-search-status");
const videoUploadStatus = document.getElementById("video-upload-status");

function renderEmpty(container, message) {
  container.innerHTML = `<div class="empty">${message}</div>`;
}

async function loadVideos() {
  videoList.innerHTML = `<div class="empty">Loading…</div>`;
  try {
    const { videos } = await api("/videos");
    if (!videos.length) {
      renderEmpty(videoList, "No videos indexed yet.");
      return;
    }
    videoList.innerHTML = "";
    videos.forEach((v) => {
      const card = document.createElement("div");
      card.className = "video-card";
      card.innerHTML = `
        <video controls preload="metadata" src="${mediaUrl(v.path)}"></video>
        <div class="meta">${filenameOf(v.path)} &middot; ${formatTime(v.duration)}</div>
      `;
      videoList.appendChild(card);
    });
  } catch (err) {
    renderEmpty(videoList, `Failed to load videos: ${err.message}`);
  }
}

document.getElementById("video-refresh-btn").addEventListener("click", loadVideos);

document.getElementById("video-upload-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("video-upload-input");
  if (!input.files.length) return;

  const form = new FormData();
  for (const f of input.files) form.append("videos", f);

  setStatus(videoUploadStatus, "Uploading and indexing… this can take a while for the first request.", null);
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  try {
    const data = await api("/videos/insert", { method: "POST", body: form });
    setStatus(videoUploadStatus, `Indexed ${data.inserted.length} video(s).`, "success");
    input.value = "";
    loadVideos();
  } catch (err) {
    setStatus(videoUploadStatus, err.message, "error");
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("video-search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = document.getElementById("video-search-query").value.trim();
  if (!query) return;

  setStatus(videoSearchStatus, "Searching…", null);
  videoSearchResults.innerHTML = "";
  try {
    const { results } = await api("/videos/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, united: true }),
    });
    const entries = Object.entries(results || {});
    if (!entries.length) {
      setStatus(videoSearchStatus, "No matches.", null);
      return;
    }
    setStatus(videoSearchStatus, `${entries.length} video(s) matched.`, "success");
    entries.forEach(([path, clips]) => {
      const card = document.createElement("div");
      card.className = "result-card";
      const videoId = `res-${Math.random().toString(36).slice(2)}`;
      const clipButtons = clips
        .map(
          ([start, end, score]) =>
            `<button type="button" class="clip-btn" data-start="${start}">
              ${formatTime(start)}–${formatTime(end)} (${score.toFixed(2)})
            </button>`
        )
        .join("");
      card.innerHTML = `
        <div class="filename">${filenameOf(path)}</div>
        <video id="${videoId}" controls preload="metadata" src="${mediaUrl(path)}"></video>
        <div class="clip-list">${clipButtons}</div>
      `;
      card.querySelectorAll(".clip-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const video = document.getElementById(videoId);
          video.currentTime = parseFloat(btn.dataset.start);
          video.play();
        });
      });
      videoSearchResults.appendChild(card);
    });
  } catch (err) {
    setStatus(videoSearchStatus, err.message, "error");
  }
});

// -------------------------------------------------------------------- images
const imageList = document.getElementById("image-list");
const imageSearchResults = document.getElementById("image-search-results");
const imageSearchStatus = document.getElementById("image-search-status");
const imageUploadStatus = document.getElementById("image-upload-status");

async function loadImages() {
  imageList.innerHTML = `<div class="empty">Loading…</div>`;
  try {
    const { images } = await api("/images");
    if (!images.length) {
      renderEmpty(imageList, "No images indexed yet.");
      return;
    }
    imageList.innerHTML = "";
    images.forEach((img) => {
      const card = document.createElement("div");
      card.className = "image-card";
      card.innerHTML = `
        <img src="${mediaUrl(img.path)}" alt="${filenameOf(img.path)}">
        <div class="meta">${filenameOf(img.path)}</div>
      `;
      imageList.appendChild(card);
    });
  } catch (err) {
    renderEmpty(imageList, `Failed to load images: ${err.message}`);
  }
}

document.getElementById("image-refresh-btn").addEventListener("click", loadImages);

document.getElementById("image-upload-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("image-upload-input");
  if (!input.files.length) return;

  const form = new FormData();
  for (const f of input.files) form.append("images", f);

  setStatus(imageUploadStatus, "Uploading and indexing…", null);
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  try {
    const data = await api("/images/insert", { method: "POST", body: form });
    setStatus(imageUploadStatus, `Indexed ${data.inserted.length} image(s).`, "success");
    input.value = "";
    loadImages();
  } catch (err) {
    setStatus(imageUploadStatus, err.message, "error");
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("image-search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = document.getElementById("image-search-query").value.trim();
  if (!query) return;

  setStatus(imageSearchStatus, "Searching…", null);
  imageSearchResults.innerHTML = "";
  try {
    const { results } = await api("/images/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const entries = Object.entries(results || {}).sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
      setStatus(imageSearchStatus, "No matches.", null);
      return;
    }
    setStatus(imageSearchStatus, `${entries.length} image(s) matched.`, "success");
    entries.forEach(([path, score]) => {
      const card = document.createElement("div");
      card.className = "image-card";
      card.innerHTML = `
        <img src="${mediaUrl(path)}" alt="${filenameOf(path)}">
        <div class="meta">${filenameOf(path)} &middot; ${score.toFixed(2)}</div>
      `;
      imageSearchResults.appendChild(card);
    });
  } catch (err) {
    setStatus(imageSearchStatus, err.message, "error");
  }
});

// ------------------------------------------------------------------- initial
loadVideos();
loadImages();

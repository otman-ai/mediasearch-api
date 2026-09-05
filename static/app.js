const API = "/api";
const VIDEO_PAGE_SIZE = 24;
const IMAGE_PAGE_SIZE = 30;

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

function renderEmpty(container, message) {
  container.innerHTML = `<div class="empty">${message}</div>`;
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

// Renders Prev/Next controls into `container` for a paginated {page, page_size,
// total} response and wires them to call `onChange(newPage)`.
function renderPagination(container, { page, page_size, total }, onChange) {
  if (!total) {
    container.innerHTML = "";
    return;
  }
  const totalPages = Math.max(1, Math.ceil(total / page_size));
  container.innerHTML = `
    <button type="button" class="secondary" data-dir="prev" aria-label="Previous page" title="Previous page" ${page <= 1 ? "disabled" : ""}>←</button>
    <span>Page ${page} of ${totalPages} (${total} total)</span>
    <button type="button" class="secondary" data-dir="next" aria-label="Next page" title="Next page" ${page >= totalPages ? "disabled" : ""}>→</button>
  `;
  container.querySelector('[data-dir="prev"]').addEventListener("click", () => onChange(page - 1));
  container.querySelector('[data-dir="next"]').addEventListener("click", () => onChange(page + 1));
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
const videoPagination = document.getElementById("video-pagination");
const videoSearchResults = document.getElementById("video-search-results");
const videoSearchStatus = document.getElementById("video-search-status");
const videoUploadStatus = document.getElementById("video-upload-status");

async function loadVideos(page = 1) {
  videoList.innerHTML = `<div class="empty">Loading…</div>`;
  videoPagination.innerHTML = "";
  try {
    const data = await api(`/videos?page=${page}&page_size=${VIDEO_PAGE_SIZE}`);
    if (!data.videos.length) {
      renderEmpty(videoList, page > 1 ? "No more videos." : "No videos indexed yet.");
      return;
    }
    videoList.innerHTML = "";
    data.videos.forEach((v) => {
      const card = document.createElement("div");
      card.className = "video-card";
      // preload="none": with a large index only the current page's cards
      // exist in the DOM at once, but each <video> would otherwise still
      // fetch metadata as soon as it's inserted.
      card.innerHTML = `
        <video controls preload="none" src="${mediaUrl(v.path)}"></video>
        <div class="meta">${filenameOf(v.path)} &middot; ${formatTime(v.duration)}</div>
      `;
      videoList.appendChild(card);
    });
    renderPagination(videoPagination, data, loadVideos);
  } catch (err) {
    renderEmpty(videoList, `Failed to load videos: ${err.message}`);
  }
}

// New uploads are appended to the end of the index, so jump to the last page
// (instead of page 1) to show the videos that were just inserted.
async function loadLastVideoPage() {
  try {
    const probe = await api(`/videos?page=1&page_size=1`);
    loadVideos(Math.max(1, Math.ceil(probe.total / VIDEO_PAGE_SIZE)));
  } catch (err) {
    loadVideos(1);
  }
}

document.getElementById("video-refresh-btn").addEventListener("click", () => loadVideos(1));

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
    loadLastVideoPage();
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
    const entries = Object.entries(results || {})
      // sort clips within each video, and the videos themselves, by score desc
      .map(([path, clips]) => [path, [...clips].sort((a, b) => b[2] - a[2])])
      .sort((a, b) => b[1][0][2] - a[1][0][2]);
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
const imagePagination = document.getElementById("image-pagination");
const imageSearchResults = document.getElementById("image-search-results");
const imageSearchStatus = document.getElementById("image-search-status");
const imageUploadStatus = document.getElementById("image-upload-status");

async function loadImages(page = 1) {
  imageList.innerHTML = `<div class="empty">Loading…</div>`;
  imagePagination.innerHTML = "";
  try {
    const data = await api(`/images?page=${page}&page_size=${IMAGE_PAGE_SIZE}`);
    if (!data.images.length) {
      renderEmpty(imageList, page > 1 ? "No more images." : "No images indexed yet.");
      return;
    }
    imageList.innerHTML = "";
    data.images.forEach((img) => {
      const card = document.createElement("div");
      card.className = "image-card";
      card.innerHTML = `
        <img src="${mediaUrl(img.path)}" alt="${filenameOf(img.path)}" loading="lazy">
        <div class="meta">${filenameOf(img.path)}</div>
      `;
      imageList.appendChild(card);
    });
    renderPagination(imagePagination, data, loadImages);
  } catch (err) {
    renderEmpty(imageList, `Failed to load images: ${err.message}`);
  }
}

async function loadLastImagePage() {
  try {
    const probe = await api(`/images?page=1&page_size=1`);
    loadImages(Math.max(1, Math.ceil(probe.total / IMAGE_PAGE_SIZE)));
  } catch (err) {
    loadImages(1);
  }
}

document.getElementById("image-refresh-btn").addEventListener("click", () => loadImages(1));

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
    loadLastImagePage();
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
        <img src="${mediaUrl(path)}" alt="${filenameOf(path)}" loading="lazy">
        <div class="meta">${filenameOf(path)} &middot; ${score.toFixed(2)}</div>
      `;
      imageSearchResults.appendChild(card);
    });
  } catch (err) {
    setStatus(imageSearchStatus, err.message, "error");
  }
});

// ------------------------------------------------------------------- initial
loadVideos(1);
loadImages(1);

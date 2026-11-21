/* ============================================================
   AeroDrop — client
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const el = (tag, cls, html) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html !== undefined) node.innerHTML = html;
  return node;
};

const esc = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const icon = (name) => `<svg class="ic"><use href="#i-${name}"/></svg>`;

/* ------------------------------------------------------------ state */

const state = {
  info: null,
  path: "",
  entries: [],
  results: null,
  query: "",
  view: localStorage.getItem("ad-view") || "grid",
  sort: localStorage.getItem("ad-sort") || "name",
  transfers: new Map(),
  own: new Set(),
  clients: 1,
  peers: [],
  locked: false,
  readonly: false,
  lastLoad: 0,
};

const $grid = $("#grid");
const $empty = $("#empty");
const $crumbs = $("#crumbs");
const $search = $("#search");
const $modal = $("#modalRoot");
const $toasts = $("#toasts");
const $transfers = $("#transfers");
const $transferList = $("#transferList");
const $overlay = $("#dropOverlay");
const $lock = $("#lock");

/* ------------------------------------------------------------ utils */

const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const dateFmtFull = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

function fmtSize(bytes) {
  if (bytes === 0) return "0 o";
  if (!bytes && bytes !== 0) return "—";
  const units = ["o", "Ko", "Mo", "Go", "To"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  const digits = value >= 100 || i === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: digits })} ${units[i]}`;
}

function fmtSpeed(bytes) {
  if (!bytes) return "";
  return `${fmtSize(bytes)}/s`;
}

function fmtDate(ts) {
  const d = new Date(ts * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return timeFmt.format(d);
  if (d.getFullYear() === now.getFullYear()) return dateFmt.format(d);
  return dateFmtFull.format(d);
}

function fmtPct(value) {
  if (!isFinite(value)) return "0 %";
  return `${Math.round(value).toLocaleString("fr-FR")} %`;
}

const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/* ------------------------------------------------------------ icons / types */

const EXT_GROUPS = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp", "heic", "tif", "tiff", "ico", "raw"],
  video: ["mp4", "mkv", "mov", "webm", "avi", "m4v", "wmv", "flv", "mpg", "mpeg"],
  audio: ["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus", "wma", "aiff"],
  archive: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "dmg", "tgz"],
  code: ["js", "mjs", "ts", "tsx", "jsx", "py", "json", "html", "css", "scss", "sh", "c", "h", "cpp", "rs", "go", "java", "php", "rb", "yml", "yaml", "toml", "xml", "sql", "lua", "swift", "kt", "dart", "vue", "ini", "conf"],
  pdf: ["pdf"],
  doc: ["doc", "docx", "odt", "rtf", "txt", "md", "tex", "epub", "pages"],
  sheet: ["xls", "xlsx", "ods", "csv", "numbers"],
  slide: ["ppt", "pptx", "odp", "key"],
};

const TYPE_META = {
  folder: { icon: "folder", fg: "#c9b6ff", bg: "rgba(139,92,255,.16)", stroke: "rgba(139,92,255,.28)" },
  image: { icon: "image", fg: "#c4a7ff", bg: "rgba(139,92,255,.15)", stroke: "rgba(139,92,255,.26)" },
  video: { icon: "video", fg: "#ff9ec4", bg: "rgba(255,93,158,.14)", stroke: "rgba(255,93,158,.26)" },
  audio: { icon: "audio", fg: "#7ee8f7", bg: "rgba(34,211,238,.13)", stroke: "rgba(34,211,238,.26)" },
  archive: { icon: "archive", fg: "#fcd34d", bg: "rgba(251,191,36,.13)", stroke: "rgba(251,191,36,.26)" },
  code: { icon: "code", fg: "#9dbcff", bg: "rgba(96,140,255,.14)", stroke: "rgba(96,140,255,.26)" },
  pdf: { icon: "pdf", fg: "#ff9aa8", bg: "rgba(251,113,133,.14)", stroke: "rgba(251,113,133,.26)" },
  doc: { icon: "doc", fg: "#93c5fd", bg: "rgba(59,130,246,.14)", stroke: "rgba(59,130,246,.26)" },
  sheet: { icon: "sheet", fg: "#86efac", bg: "rgba(52,211,153,.13)", stroke: "rgba(52,211,153,.26)" },
  slide: { icon: "slide", fg: "#fdba74", bg: "rgba(251,146,60,.13)", stroke: "rgba(251,146,60,.26)" },
  file: { icon: "file", fg: "#b9c2db", bg: "rgba(185,194,219,.1)", stroke: "rgba(185,194,219,.2)" },
};

function typeOf(entry) {
  if (entry.is_dir) return "folder";
  const ext = entry.name.split(".").pop().toLowerCase();
  if (!entry.name.includes(".")) return "file";
  for (const [group, list] of Object.entries(EXT_GROUPS)) {
    if (list.includes(ext)) return group;
  }
  return "file";
}

function iconStyle(type) {
  const meta = TYPE_META[type] || TYPE_META.file;
  return `--tile-bg:${meta.bg};--tile-fg:${meta.fg};--tile-stroke:${meta.stroke}`;
}

function iconFor(entry, small = false) {
  const type = typeOf(entry);
  const meta = TYPE_META[type];
  return `<div class="file-icon" style="${iconStyle(type)}">${icon(meta.icon)}</div>`;
}

/* ------------------------------------------------------------ api */

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (response.status === 401) {
    showLock();
    throw new Error("locked");
  }
  if (!response.ok) {
    let detail = `Erreur ${response.status}`;
    try {
      const data = await response.json();
      detail = data.detail || detail;
    } catch {}
    throw new Error(detail);
  }
  if (response.status === 204) return null;
  return response.json();
}

/* ------------------------------------------------------------ toasts */

function toast(text, kind = "ok") {
  const node = el(
    "div",
    `toast ${kind}`,
    `${icon(kind === "error" ? "alert" : kind === "info" ? "check" : "check")}<span>${esc(text)}</span>`
  );
  $toasts.appendChild(node);
  setTimeout(() => {
    node.classList.add("out");
    setTimeout(() => node.remove(), 260);
  }, 3400);
}

/* ------------------------------------------------------------ theme */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("ad-theme", theme);
  const dark = theme === "dark";
  const use = $("#themeIcon use");
  if (use) use.setAttribute("href", dark ? "#i-moon" : "#i-sun");
  const label = $("#themeLabel");
  if (label) label.textContent = dark ? "Thème sombre" : "Thème clair";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#07080f" : "#eef1f9";
}

applyTheme(localStorage.getItem("ad-theme") || "dark");

/* ------------------------------------------------------------ info / storage */

async function loadInfo() {
  const info = await api("/api/info");
  state.info = info;
  state.locked = info.locked && !info.authorized;
  state.readonly = info.readonly;
  $("#deviceName").textContent = info.name;
  $("#rootPath").textContent = info.root_path;
  $("#rootPath").title = `Copier ${info.root_path}`;
  $("#versionText").textContent = `AeroDrop v${info.version}`;
  $("#clients").textContent = info.clients ?? 1;
  state.clients = info.clients ?? 1;
  renderStorage(info.disk);
  if (state.locked) showLock();
  else hideLock();
  applyReadonly();
}

async function loadPeers() {
  try {
    const data = await api("/api/peers");
    state.peers = data.peers || [];
    $("#peerCount").textContent = String(state.peers.length);
    return state.peers;
  } catch {
    return state.peers;
  }
}

function renderStorage(disk) {
  if (!disk || !disk.total) return;
  const used = disk.total - disk.free;
  const ratio = used / disk.total;
  const deg = Math.max(0, Math.min(360, ratio * 360));
  $("#storageRing").style.background =
    `conic-gradient(var(--accent) 0deg, var(--accent-2) ${deg}deg, var(--stroke) ${deg}deg)`;
  $("#storagePct").textContent = fmtPct(ratio * 100);
  $("#storageFree").textContent = `${fmtSize(disk.free)} libres`;
  $("#storageTotal").textContent = `sur ${fmtSize(disk.total)}`;
}

function applyReadonly() {
  const disabled = state.readonly;
  for (const sel of ["#uploadBtn", "#newFolderBtn", "#emptyUpload"]) {
    const btn = $(sel);
    if (btn) btn.classList.toggle("hidden", disabled);
  }
  if (disabled) {
    $overlay.dataset.disabled = "1";
  }
}

/* ------------------------------------------------------------ rendering */

function sortEntries(entries) {
  const list = [...entries];
  const dir = state.sort;
  list.sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    if (dir === "size") return (b.size || 0) - (a.size || 0);
    if (dir === "date") return (b.mtime || 0) - (a.mtime || 0);
    return a.name.localeCompare(b.name, "fr", { numeric: true, sensitivity: "base" });
  });
  return list;
}

function cardHtml(entry, showPath) {
  const type = typeOf(entry);
  const meta = TYPE_META[type];
  const isDir = entry.is_dir;
  const parts = [];
  if (isDir) parts.push(entry.count != null ? `${entry.count} élément${entry.count > 1 ? "s" : ""}` : "Dossier");
  else parts.push(fmtSize(entry.size));
  parts.push(fmtDate(entry.mtime));
  const subline = showPath ? esc(entry.path) : "";

  return `<article class="card-file" data-path="${esc(entry.path)}" data-dir="${isDir ? 1 : 0}" tabindex="0" role="button">
    <div class="file-icon" style="${iconStyle(type)}">${icon(meta.icon)}</div>
    <div class="file-name" title="${esc(entry.name)}">${esc(entry.name)}</div>
    ${subline ? `<div class="file-path">${subline}</div>` : ""}
    <div class="file-meta"><span>${parts[0]}</span><i class="sep"></i><span>${parts[1]}</span></div>
    <div class="file-actions">
      <button class="icon-btn" data-act="download" title="${isDir ? "Télécharger (.zip)" : "Télécharger"}">${icon(isDir ? "zip" : "download")}</button>
      <button class="icon-btn" data-act="link" title="Copier le lien">${icon("link")}</button>
      <button class="icon-btn" data-act="more" title="Plus">${icon("chevron")}</button>
    </div>
  </article>`;
}

function renderCrumbs() {
  const parts = state.path ? state.path.split("/") : [];
  let html = `<button class="crumb ${parts.length === 0 ? "current" : ""}" data-crumb="">
    ${icon("home")}<span>${esc(state.info?.root || "Racine")}</span></button>`;
  let acc = "";
  parts.forEach((part, i) => {
    acc = acc ? `${acc}/${part}` : part;
    const isLast = i === parts.length - 1;
    html += `<span class="crumb-sep">/</span>
      <button class="crumb ${isLast ? "current" : ""}" data-crumb="${esc(acc)}" title="${esc(acc)}">${esc(part)}</button>`;
  });
  $crumbs.innerHTML = html;
}

function render() {
  const searching = Boolean(state.query);
  const entries = searching ? state.results || [] : state.entries;
  const list = sortEntries(entries);

  renderCrumbs();
  $grid.classList.toggle("is-list", state.view === "list");

  const title = searching ? "Résultats" : state.path ? state.path.split("/").pop() : state.info?.root || "Fichiers";
  $("#sectionTitle").textContent = title;
  const totalSize = list.reduce((sum, e) => sum + (e.size || 0), 0);
  $("#sectionMeta").textContent = searching
    ? `${list.length} résultat${list.length > 1 ? "s" : ""} pour « ${state.query} »`
    : `${list.length} élément${list.length > 1 ? "s" : ""} · ${fmtSize(totalSize)}`;

  $grid.innerHTML = list.map((entry) => cardHtml(entry, searching)).join("");

  const isEmpty = list.length === 0;
  $grid.classList.toggle("hidden", isEmpty);
  $empty.classList.toggle("hidden", !isEmpty);
  if (isEmpty) {
    $("#emptyTitle").textContent = searching ? "Aucun résultat" : "Ce dossier est vide";
    $("#emptyText").textContent = searching
      ? `Rien ne correspond à « ${state.query} ».`
      : "Glisse-dépose des fichiers n'importe où, ou utilise le bouton Envoyer.";
    $("#emptyUpload").classList.toggle("hidden", searching || state.readonly);
  }

  $("#statusText").textContent = searching
    ? `${list.length} résultat(s)`
    : `${list.length} élément(s) · ${fmtSize(totalSize)}`;
}

/* ------------------------------------------------------------ navigation */

async function load(path = state.path, { silent = false } = {}) {
  if (state.locked) return;
  try {
    const data = await api(`/api/list?path=${encodeURIComponent(path)}`);
    state.path = data.path;
    state.entries = data.entries;
    state.results = null;
    state.lastLoad = Date.now();
    render();
    if (!silent) $("#statusText").textContent = `${data.entries.length} élément(s)`;
  } catch (error) {
    if (error.message !== "locked") toast(error.message, "error");
  }
}

function navigate(path, { push = true } = {}) {
  state.path = path;
  if (state.query) clearSearch();
  if (push) {
    const hash = path ? `#/${path.split("/").map(encodeURIComponent).join("/")}` : "";
    if (location.hash !== hash) history.pushState(null, "", hash || location.pathname + location.search);
  }
  load(path);
}

function pathFromHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  if (!raw) return "";
  try {
    return raw.split("/").map(decodeURIComponent).join("/");
  } catch {
    return "";
  }
}

window.addEventListener("popstate", () => load(pathFromHash(), { silent: true }));

/* ------------------------------------------------------------ search */

let searchTimer = null;

function clearSearch() {
  state.query = "";
  state.results = null;
  $search.value = "";
  $("#searchBox").classList.remove("has-value");
  render();
}

$search.addEventListener("input", () => {
  const value = $search.value.trim();
  $("#searchBox").classList.toggle("has-value", Boolean(value));
  clearTimeout(searchTimer);
  if (!value) {
    clearSearch();
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      const data = await api(`/api/search?q=${encodeURIComponent(value)}`);
      state.query = value;
      state.results = data.entries;
      render();
    } catch (error) {
      if (error.message !== "locked") toast(error.message, "error");
    }
  }, 230);
});

$("#searchClear").addEventListener("click", () => {
  clearSearch();
  $search.focus();
});

/* ------------------------------------------------------------ grid interactions */

$grid.addEventListener("click", (event) => {
  const card = event.target.closest(".card-file");
  if (!card) return;
  const actionBtn = event.target.closest("[data-act]");
  const path = card.dataset.path;
  const isDir = card.dataset.dir === "1";
  const entry = findEntry(path);

  if (actionBtn) {
    event.stopPropagation();
    const act = actionBtn.dataset.act;
    if (act === "download") {
      if (isDir) downloadZip(path, entry?.name || path);
      else download(path, entry?.name || path);
    } else if (act === "link") {
      copyLink(path);
    } else if (act === "more") {
      openMenu(actionBtn, entry);
    }
    return;
  }

  if (isDir) navigate(path);
  else preview(entry || { path, name: path.split("/").pop(), size: 0, mtime: 0 });
});

$grid.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest(".card-file");
  if (!card) return;
  event.preventDefault();
  card.click();
});

$grid.addEventListener("pointermove", (event) => {
  const card = event.target.closest(".card-file");
  if (!card) return;
  const rect = card.getBoundingClientRect();
  card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
  card.style.setProperty("--my", `${event.clientY - rect.top}px`);
});

function findEntry(path) {
  return (
    state.entries.find((e) => e.path === path) ||
    (state.results || []).find((e) => e.path === path) ||
    null
  );
}

/* ------------------------------------------------------------ downloads */

function transferUrl(path, tid) {
  return `/api/download?path=${encodeURIComponent(path)}&tid=${encodeURIComponent(tid)}`;
}

function download(path, name) {
  const id = uid();
  addTransfer({
    id,
    name,
    path,
    direction: "down",
    size: 0,
    received: 0,
    status: "active",
  });
  state.own.add(id);
  const link = document.createElement("a");
  link.href = transferUrl(path, id);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => {
    const t = state.transfers.get(id);
    if (t && t.status === "active") {
      t.status = "done";
      updateTransferRow(t);
    }
  }, 1500);
}

function downloadZip(path, name) {
  const id = uid();
  addTransfer({ id, name: `${name}.zip`, path, direction: "down", size: 0, received: 0, status: "active", zip: true });
  state.own.add(id);
  const link = document.createElement("a");
  link.href = `/api/zip?path=${encodeURIComponent(path)}&tid=${encodeURIComponent(id)}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => {
    const t = state.transfers.get(id);
    if (t && t.status === "active") {
      t.status = "done";
      updateTransferRow(t);
    }
  }, 2500);
}

async function copyLink(path) {
  const base = `${location.origin}/api/download?path=${encodeURIComponent(path)}`;
  const pin = sessionStorage.getItem("ad-pin");
  const url = pin ? `${base}&pin=${encodeURIComponent(pin)}` : base;
  try {
    await navigator.clipboard.writeText(url);
    toast("Lien copié dans le presse-papiers", "info");
  } catch {
    promptModal({ title: "Lien du fichier", label: "Copie ce lien", value: url, confirmText: "Fermer" });
  }
}

/* ------------------------------------------------------------ menu */

let openPopover = null;

function closePopover() {
  if (openPopover) {
    openPopover.remove();
    openPopover = null;
  }
}

function openMenu(anchor, entry) {
  closePopover();
  if (!entry) return;
  const pop = el("div", "popover");
  const items = [];
  if (!entry.is_dir) {
    items.push({ act: "preview", label: "Aperçu", icon: "eye" });
    items.push({ act: "download", label: "Télécharger", icon: "download" });
  } else {
    items.push({ act: "open", label: "Ouvrir", icon: "folder" });
    items.push({ act: "zip", label: "Télécharger (.zip)", icon: "zip" });
  }
  items.push({ act: "link", label: "Copier le lien", icon: "link" });
  if (!state.readonly) {
    items.push({ act: "rename", label: "Renommer", icon: "pencil" });
    items.push({ act: "delete", label: "Supprimer", icon: "trash", danger: true });
  }

  pop.innerHTML = items
    .map(
      (item) =>
        `<button data-menu="${item.act}" class="${item.danger ? "danger" : ""}">${icon(item.icon)}<span>${item.label}</span></button>`
    )
    .join("");
  document.body.appendChild(pop);

  const rect = anchor.getBoundingClientRect();
  const width = pop.offsetWidth;
  const height = pop.offsetHeight;
  let left = Math.min(rect.right - width, window.innerWidth - width - 10);
  let top = rect.bottom + 8;
  if (top + height > window.innerHeight - 10) top = rect.top - height - 8;
  pop.style.left = `${Math.max(10, left)}px`;
  pop.style.top = `${Math.max(10, top)}px`;

  pop.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-menu]");
    if (!btn) return;
    const act = btn.dataset.menu;
    closePopover();
    if (act === "open") navigate(entry.path);
    if (act === "preview") preview(entry);
    if (act === "download") download(entry.path, entry.name);
    if (act === "zip") downloadZip(entry.path, entry.name);
    if (act === "link") copyLink(entry.path);
    if (act === "rename") renameEntry(entry);
    if (act === "delete") deleteEntry(entry);
  });

  openPopover = pop;
  setTimeout(() => document.addEventListener("click", onDocClick), 0);
}

function onDocClick(event) {
  if (openPopover && !openPopover.contains(event.target)) {
    closePopover();
    document.removeEventListener("click", onDocClick);
  }
}

/* ------------------------------------------------------------ preview */

const $lightbox = $("#lightbox");
const $lbBody = $("#lbBody");

function preview(entry) {
  const type = typeOf(entry);
  const url = `/api/download?path=${encodeURIComponent(entry.path)}&inline=1`;
  const downloadUrl = `/api/download?path=${encodeURIComponent(entry.path)}`;
  $("#lbName").textContent = `${entry.name} · ${fmtSize(entry.size)}`;
  $("#lbDownload").href = downloadUrl;
  $("#lbDownload").setAttribute("download", entry.name);
  $lbBody.innerHTML = "";

  if (type === "image") {
    $lbBody.innerHTML = `<img src="${url}" alt="${esc(entry.name)}">`;
  } else if (type === "video") {
    $lbBody.innerHTML = `<video src="${url}" controls autoplay playsinline></video>`;
  } else if (type === "audio") {
    $lbBody.innerHTML = `<audio src="${url}" controls autoplay></audio>`;
  } else if (type === "pdf") {
    $lbBody.innerHTML = `<iframe src="${url}" title="${esc(entry.name)}"></iframe>`;
  } else if (["code", "doc", "sheet", "file"].includes(type) && entry.size < 2 * 1024 * 1024) {
    $lbBody.innerHTML = `<pre>chargement…</pre>`;
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error("lecture impossible"))))
      .then((text) => {
        $lbBody.innerHTML = `<pre>${esc(text.slice(0, 200000))}</pre>`;
      })
      .catch(() => {
        $lbBody.innerHTML = `<p style="color:#9aa3bb">Aperçu indisponible — télécharge le fichier.</p>`;
      });
  } else {
    $lbBody.innerHTML = `<p style="color:#9aa3bb">Pas d'aperçu pour ce format.</p>`;
  }

  $lightbox.classList.remove("hidden");
}

$("#lbClose").addEventListener("click", () => {
  $lbBody.innerHTML = "";
  $lightbox.classList.add("hidden");
});

$lightbox.addEventListener("click", (event) => {
  if (event.target === $lightbox) $("#lbClose").click();
});

/* ------------------------------------------------------------ modals */

function closeModal() {
  $modal.classList.add("hidden");
  $modal.innerHTML = "";
}

$modal.addEventListener("click", (event) => {
  if (event.target === $modal) closeModal();
});

function openModal(html, { wide = false, onMount } = {}) {
  $modal.innerHTML = `<div class="modal ${wide ? "wide" : ""}">${html}</div>`;
  $modal.classList.remove("hidden");
  const node = $(".modal", $modal);
  if (onMount) onMount(node);
  return node;
}

function promptModal({ title, desc, label = "Nom", value = "", confirmText = "Valider" }) {
  return new Promise((resolve) => {
    const node = openModal(
      `<h3>${esc(title)}</h3>
       ${desc ? `<p>${esc(desc)}</p>` : ""}
       <div class="field"><label>${esc(label)}</label><input id="promptValue" value="${esc(value)}" autocomplete="off" spellcheck="false"></div>
       <div class="modal-actions">
         <button class="btn ghost" data-cancel>Annuler</button>
         <button class="btn primary" data-ok>${esc(confirmText)}</button>
       </div>`
    );
    const input = $("#promptValue", node);
    input.focus();
    input.select();

    const done = (result) => {
      closeModal();
      resolve(result);
    };
    $("[data-ok]", node).addEventListener("click", () => done(input.value.trim() || null));
    $("[data-cancel]", node).addEventListener("click", () => done(null));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") done(input.value.trim() || null);
    });
  });
}

function confirmModal({ title, desc, confirmText = "Supprimer", danger = true }) {
  return new Promise((resolve) => {
    const node = openModal(
      `<h3>${esc(title)}</h3>
       <p>${esc(desc)}</p>
       <div class="modal-actions">
         <button class="btn ghost" data-cancel>Annuler</button>
         <button class="btn ${danger ? "danger" : "primary"}" data-ok>${esc(confirmText)}</button>
       </div>`
    );
    const done = (result) => {
      closeModal();
      resolve(result);
    };
    $("[data-ok]", node).addEventListener("click", () => done(true));
    $("[data-cancel]", node).addEventListener("click", () => done(false));
  });
}

/* ------------------------------------------------------------ file actions */

async function newFolder() {
  const name = await promptModal({
    title: "Nouveau dossier",
    desc: state.path ? `Dans « ${state.path} »` : "À la racine du partage",
    label: "Nom du dossier",
    confirmText: "Créer",
  });
  if (!name) return;
  try {
    await api("/api/mkdir", {
      method: "POST",
      body: JSON.stringify({ path: state.path, name }),
    });
    toast(`Dossier « ${name} » créé`);
    load(state.path, { silent: true });
  } catch (error) {
    toast(error.message, "error");
  }
}

async function renameEntry(entry) {
  const name = await promptModal({
    title: "Renommer",
    desc: entry.name,
    label: "Nouveau nom",
    value: entry.name,
    confirmText: "Renommer",
  });
  if (!name || name === entry.name) return;
  try {
    await api("/api/rename", {
      method: "POST",
      body: JSON.stringify({ path: entry.path, name }),
    });
    toast("Renommé");
    load(state.path, { silent: true });
  } catch (error) {
    toast(error.message, "error");
  }
}

async function deleteEntry(entry) {
  const ok = await confirmModal({
    title: `Supprimer « ${entry.name} » ?`,
    desc: entry.is_dir ? "Le dossier et tout son contenu seront supprimés définitivement." : "Le fichier sera supprimé définitivement.",
    confirmText: "Supprimer",
  });
  if (!ok) return;
  try {
    await api("/api/delete", {
      method: "POST",
      body: JSON.stringify({ path: entry.path }),
    });
    toast("Supprimé");
    load(state.path, { silent: true });
  } catch (error) {
    toast(error.message, "error");
  }
}

/* ------------------------------------------------------------ uploads */

const uploadQueue = [];
let activeUploads = 0;
const MAX_PARALLEL = 3;

function addTransfer(data) {
  state.transfers.set(data.id, data);
  // On garde l'historique raisonnable : au-delà de 20, on retire les plus anciens terminés.
  if (state.transfers.size > 20) {
    for (const [id, item] of state.transfers) {
      if (item.status === "done" || item.status === "error") {
        state.transfers.delete(id);
        if (state.transfers.size <= 20) break;
      }
    }
  }
  $transfers.classList.remove("hidden");
  renderTransfers();
  return data;
}

function queueUploads(items, basePath = state.path) {
  if (state.readonly) {
    toast("Partage en lecture seule", "error");
    return;
  }
  if (!items.length) return;
  items.forEach(({ file, relPath }) => {
    const id = uid();
    const transfer = {
      id,
      name: relPath || file.name,
      size: file.size,
      received: 0,
      status: "queued",
      direction: "up",
      speed: 0,
    };
    state.own.add(id);
    addTransfer(transfer);
    uploadQueue.push({ id, file, relPath: relPath || file.name, basePath });
  });
  pumpQueue();
  toast(`${items.length} fichier${items.length > 1 ? "s" : ""} en envoi`, "info");
}

function pumpQueue() {
  while (activeUploads < MAX_PARALLEL && uploadQueue.length) {
    const job = uploadQueue.shift();
    activeUploads += 1;
    uploadOne(job).finally(() => {
      activeUploads -= 1;
      pumpQueue();
      if (activeUploads === 0 && uploadQueue.length === 0) {
        load(state.path, { silent: true });
        loadInfo().catch(() => {});
      }
    });
  }
}

function uploadOne({ id, file, relPath, basePath }) {
  return new Promise((resolve) => {
    const transfer = state.transfers.get(id);
    const xhr = new XMLHttpRequest();
    const url = `/api/upload?path=${encodeURIComponent(basePath)}&tid=${encodeURIComponent(id)}`;
    xhr.open("PUT", url);
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(relPath));
    xhr.setRequestHeader("Content-Type", "application/octet-stream");

    transfer.status = "active";
    updateTransferRow(transfer);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      transfer.received = event.loaded;
      transfer.size = event.total;
      transfer.status = "active";
      updateTransferRow(transfer);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        transfer.status = "done";
        transfer.received = transfer.size;
      } else {
        transfer.status = "error";
        transfer.error = xhr.status === 403 ? "lecture seule" : `erreur ${xhr.status}`;
      }
      updateTransferRow(transfer);
      resolve();
    };

    xhr.onerror = () => {
      transfer.status = "error";
      transfer.error = "connexion perdue";
      updateTransferRow(transfer);
      resolve();
    };

    xhr.send(file);
  });
}

function renderTransfers() {
  const list = [...state.transfers.values()];
  if (!list.length) {
    $transfers.classList.add("hidden");
    $("#transferCount").textContent = "0";
    return;
  }
  $transfers.classList.remove("hidden");
  const active = list.filter((t) => t.status === "active" || t.status === "queued").length;
  const done = list.filter((t) => t.status === "done").length;
  $("#transfersSummary").textContent =
    `${active ? `${active} en cours` : "aucun en cours"}${done ? ` · ${done} terminé${done > 1 ? "s" : ""}` : ""}`;
  $("#transferCount").textContent = String(active || done);

  $transferList.innerHTML = list
    .slice()
    .reverse()
    .map((t) => {
      const entry = { name: t.name, is_dir: false };
      const pct = t.size ? Math.min(100, (t.received / t.size) * 100) : t.status === "done" ? 100 : 0;
      const stateIcon =
        t.status === "done"
          ? icon("check")
          : t.status === "error"
          ? icon("alert")
          : `<span class="pct">${t.size ? Math.round(pct) : ""}</span>`;
      const sub =
        t.status === "error"
          ? `<span>${esc(t.error || "échec")}</span><span>${fmtSize(t.received || 0)}</span>`
          : t.status === "done"
          ? `<span>${fmtSize(t.size || t.received)}</span><span>terminé</span>`
          : `<span>${fmtSize(t.received)} / ${fmtSize(t.size)}</span><span>${fmtSpeed(t.speed)}</span>`;
      return `<div class="transfer is-${t.status}" data-tid="${t.id}">
        ${iconFor(entry)}
        <div class="transfer-main">
          <div class="transfer-name" title="${esc(t.name)}">${esc(t.name.split("/").pop())}</div>
          <div class="transfer-bar"><i style="width:${pct}%"></i></div>
          <div class="transfer-sub">${sub}</div>
        </div>
        <div class="transfer-state">${stateIcon}</div>
      </div>`;
    })
    .join("");
}

function updateTransferRow(transfer) {
  const row = $transferList.querySelector(`[data-tid="${CSS.escape(transfer.id)}"]`);
  if (!row) {
    renderTransfers();
    return;
  }
  const pct = transfer.size ? Math.min(100, (transfer.received / transfer.size) * 100) : transfer.status === "done" ? 100 : 0;
  row.className = `transfer is-${transfer.status}`;
  const bar = $(".transfer-bar > i", row);
  if (bar) bar.style.width = `${pct}%`;
  const sub = $(".transfer-sub", row);
  if (sub) {
    sub.innerHTML =
      transfer.status === "error"
        ? `<span>${esc(transfer.error || "échec")}</span><span>${fmtSize(transfer.received || 0)}</span>`
        : transfer.status === "done"
        ? `<span>${fmtSize(transfer.size || transfer.received)}</span><span>terminé</span>`
        : `<span>${fmtSize(transfer.received)} / ${fmtSize(transfer.size)}</span><span>${fmtSpeed(transfer.speed)}</span>`;
  }
  const stateBox = $(".transfer-state", row);
  if (stateBox) {
    stateBox.innerHTML =
      transfer.status === "done"
        ? icon("check")
        : transfer.status === "error"
        ? icon("alert")
        : `<span class="pct">${transfer.size ? Math.round(pct) : ""}</span>`;
  }
  const summary = [...state.transfers.values()].filter((t) => t.status === "active" || t.status === "queued").length;
  $("#transfersSummary").textContent = summary ? `${summary} en cours` : "aucun en cours";
  $("#transferCount").textContent = String(
    [...state.transfers.values()].filter((t) => t.status === "active" || t.status === "queued").length
  );
}

$("#clearTransfers").addEventListener("click", () => {
  for (const [id, t] of state.transfers) {
    if (t.status === "done" || t.status === "error") state.transfers.delete(id);
  }
  renderTransfers();
});

$("#collapseTransfers").addEventListener("click", () => {
  $transferList.classList.toggle("hidden");
});

/* ------------------------------------------------------------ websocket */

let socket = null;
let reconnectDelay = 800;

function connectSocket() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${location.host}/ws`);

  socket.addEventListener("open", () => {
    reconnectDelay = 800;
    $("#liveDot").style.background = "var(--ok)";
  });

  socket.addEventListener("message", (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    handleEvent(data);
  });

  socket.addEventListener("close", (event) => {
    $("#liveDot").style.background = "var(--danger)";
    if (event.code === 4401) {
      showLock();
      return;
    }
    setTimeout(connectSocket, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.7, 8000);
  });
}

let refreshTimer = null;

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (!state.query) load(state.path, { silent: true });
    loadInfo().catch(() => {});
  }, 350);
}

function handleEvent(data) {
  if (data.type === "clients") {
    state.clients = data.count;
    $("#clients").textContent = data.count;
    return;
  }

  if (data.type === "fs") {
    scheduleRefresh();
    return;
  }

  if (data.type === "upload" || data.type === "download") {
    const id = data.id || `${data.type}:${data.name || ""}:${data.path || ""}`;
    const isOwnUpload = data.type === "upload" && state.own.has(id);
    if (isOwnUpload) return;

    let transfer = state.transfers.get(id);
    if (!transfer) {
      transfer = addTransfer({
        id: id || uid(),
        name: data.name || "fichier",
        path: data.path || "",
        direction: data.type === "upload" ? "up" : "down",
        size: data.size || 0,
        received: 0,
        status: "active",
        speed: 0,
        remote: !state.own.has(id),
      });
    }
    if (data.size) transfer.size = data.size;
    if (typeof data.received === "number") transfer.received = data.received;
    if (data.speed) transfer.speed = data.speed;

    if (data.status === "start") {
      transfer.status = "active";
    } else if (data.status === "progress") {
      transfer.status = "active";
    } else if (data.status === "done") {
      transfer.status = "done";
      if (data.size) transfer.size = data.size;
      transfer.received = transfer.size || transfer.received;
      if (data.type === "upload" && !state.own.has(id)) {
        toast(`${data.name} reçu`, "info");
      }
      scheduleRefresh();
      setTimeout(() => {
        const current = state.transfers.get(id);
        if (current && current.status === "done") {
          current.status = "done";
          updateTransferRow(current);
        }
      }, 500);
    } else if (data.status === "error") {
      transfer.status = "error";
    }
    updateTransferRow(transfer);
    return;
  }
}

/* ------------------------------------------------------------ drop */

let dragDepth = 0;

window.addEventListener("dragenter", (event) => {
  if (state.readonly || state.locked) return;
  if (![...(event.dataTransfer?.types || [])].includes("Files")) return;
  dragDepth += 1;
  $("#dropTarget").textContent = state.path ? `dans « ${state.path} »` : "à la racine du partage";
  $overlay.classList.add("is-visible");
});

window.addEventListener("dragover", (event) => {
  if ($overlay.classList.contains("is-visible")) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }
});

window.addEventListener("dragleave", (event) => {
  if (![...(event.dataTransfer?.types || [])].includes("Files")) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) $overlay.classList.remove("is-visible");
});

window.addEventListener("drop", async (event) => {
  if (![...(event.dataTransfer?.types || [])].includes("Files")) return;
  event.preventDefault();
  dragDepth = 0;
  $overlay.classList.remove("is-visible");
  if (state.readonly || state.locked) return;
  const items = await collectFiles(event.dataTransfer);
  queueUploads(items);
});

async function collectFiles(dataTransfer) {
  const entries = [...(dataTransfer.items || [])]
    .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
    .filter(Boolean);

  if (!entries.length) {
    return [...dataTransfer.files].map((file) => ({ file, relPath: file.name }));
  }

  const out = [];

  async function walk(entry, prefix) {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      out.push({ file, relPath: prefix ? `${prefix}/${entry.name}` : entry.name });
      return;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const children = await new Promise((resolve, reject) => {
        const all = [];
        const read = () =>
          reader.readEntries((batch) => {
            if (!batch.length) resolve(all);
            else {
              all.push(...batch);
              read();
            }
          }, reject);
        read();
      });
      const dirPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
      for (const child of children) await walk(child, dirPrefix);
    }
  }

  for (const entry of entries) await walk(entry, "");
  return out;
}

/* ------------------------------------------------------------ file input */

function pickFiles() {
  const node = openModal(
    `<h3>Envoyer vers ce partage</h3>
     <p>${state.path ? `Destination : « ${esc(state.path)} »` : "Destination : la racine du partage"}</p>
     <div class="send-choices">
       <button class="send-choice" data-send="files">${icon("file")}<span><strong>Des fichiers</strong><small>Sélectionner un ou plusieurs fichiers</small></span></button>
       <button class="send-choice" data-send="folder">${icon("folder")}<span><strong>Un dossier</strong><small>Conserver toute son arborescence</small></span></button>
     </div>
     <div class="modal-actions"><button class="btn ghost" data-cancel>Annuler</button></div>`
  );
  node.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-send]");
    if (choice) {
      closeModal();
      $(choice.dataset.send === "folder" ? "#folderInput" : "#fileInput").click();
    }
    if (event.target.closest("[data-cancel]")) closeModal();
  });
}

function handlePickedFiles(event, isFolder = false) {
  const files = [...event.target.files];
  event.target.value = "";
  queueUploads(
    files.map((file) => ({
      file,
      relPath: isFolder && file.webkitRelativePath ? file.webkitRelativePath : file.name,
    }))
  );
}

$("#fileInput").addEventListener("change", (event) => handlePickedFiles(event));
$("#folderInput").addEventListener("change", (event) => handlePickedFiles(event, true));

/* ------------------------------------------------------------ QR modal */

async function showQr() {
  const urls = state.info?.urls?.length ? state.info.urls : [location.origin];
  const primary = urls[0];
  const node = openModal(
    `<h3>Ouvrir sur un autre appareil</h3>
     <p>Scanne le QR code ou tape l'adresse dans le navigateur. Les deux appareils doivent être sur le même Wi-Fi.</p>
     <div class="qr-wrap">
       <div class="qr-frame"><img alt="QR code" src="/api/qr?url=${encodeURIComponent(primary)}"></div>
       <div class="qr-links">
         ${urls
           .map(
             (url) =>
               `<button class="qr-link" data-copy="${esc(url)}">${icon("link")}<span>${esc(url)}</span></button>`
           )
           .join("")}
         <button class="qr-link" data-copy="${esc(location.origin)}">${icon("link")}<span>${esc(location.origin)} (local)</span></button>
       </div>
     </div>
     <div class="modal-actions"><button class="btn primary" data-close>Fermer</button></div>`,
    { wide: true }
  );
  node.addEventListener("click", async (event) => {
    const copyBtn = event.target.closest("[data-copy]");
    if (copyBtn) {
      try {
        await navigator.clipboard.writeText(copyBtn.dataset.copy);
        toast("Adresse copiée", "info");
      } catch {}
    }
    if (event.target.closest("[data-close]")) closeModal();
  });
}

/* ------------------------------------------------------------ appareils */

function peerMode(peer) {
  if (peer.locked) return "Code requis";
  if (peer.readonly) return "Lecture seule";
  return "Prêt à recevoir";
}

async function showDevices() {
  const node = openModal(
    `<h3>Appareils à proximité</h3>
     <p>Les AeroDrop ouverts sur le même Wi-Fi ou réseau Ethernet apparaissent automatiquement.</p>
     <div class="peer-list" id="peerList"><div class="peer-empty">Recherche des appareils…</div></div>
     <div class="modal-actions"><button class="btn ghost" data-refresh>${icon("refresh")}Actualiser</button><button class="btn primary" data-close>Fermer</button></div>`,
    { wide: true }
  );
  const list = $("#peerList", node);
  let peerError = "";

  const renderPeers = async () => {
    const peers = await loadPeers();
    const devices = peers.length
      ? peers.map((peer) => `<button class="peer" data-peer-id="${esc(peer.id)}">
          <span class="peer-icon">${icon("devices")}</span>
          <span class="peer-main"><strong>${esc(peer.name)}</strong><small>${esc(peerMode(peer))}</small></span>
          <span class="peer-open">Ouvrir ${icon("chevron")}</span>
        </button>`).join("")
      : `<div class="peer-empty">Aucun appareil détecté pour le moment.<br><small>Ouvre AeroDrop sur l’autre PC et vérifie qu’ils sont sur le même réseau.</small></div>`;
    const recovery = peerError
      ? `<div class="peer-error" role="alert"><span>${esc(peerError)}</span><button class="btn ghost" data-retry>Réessayer</button></div>`
      : "";
    list.innerHTML = recovery + devices;
  };
  await renderPeers();
  node.addEventListener("click", async (event) => {
    const peer = event.target.closest("[data-peer-id]");
    if (peer) {
      peer.disabled = true;
      try {
        const data = await api(`/api/peers/${encodeURIComponent(peer.dataset.peerId)}/connect`);
        location.assign(data.url);
      } catch (error) {
        peerError = error.message;
        await renderPeers();
      }
    }
    if (event.target.closest("[data-refresh]") || event.target.closest("[data-retry]")) {
      peerError = "";
      await renderPeers();
    }
    if (event.target.closest("[data-close]")) closeModal();
  });
}

/* ------------------------------------------------------------ lock */

function showLock() {
  state.locked = true;
  $lock.classList.remove("hidden");
  setTimeout(() => $("#pinInput")?.focus(), 60);
}

function hideLock() {
  state.locked = false;
  $lock.classList.add("hidden");
}

$("#lockForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const pin = $("#pinInput").value.trim();
  $("#lockError").textContent = "";
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ pin }) });
    sessionStorage.setItem("ad-pin", pin);
    hideLock();
    await loadInfo();
    load(state.path, { silent: true });
    connectSocket();
    toast("Accès autorisé", "ok");
  } catch (error) {
    $("#lockError").textContent = error.message === "locked" ? "PIN incorrect" : error.message;
    $("#pinInput").select();
  }
});

/* ------------------------------------------------------------ toolbar */

$("#uploadBtn").addEventListener("click", pickFiles);
$("#emptyUpload").addEventListener("click", pickFiles);
$("#newFolderBtn").addEventListener("click", newFolder);

$("#rootPath").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(state.info?.root_path || "");
    toast("Chemin copié", "info");
  } catch {}
});

$$("[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.view = btn.dataset.view;
    localStorage.setItem("ad-view", state.view);
    $$("[data-view]").forEach((b) => b.classList.toggle("is-active", b === btn));
    render();
  });
});

$("#sortSelect").addEventListener("change", (event) => {
  state.sort = event.target.value;
  localStorage.setItem("ad-sort", state.sort);
  render();
});

$crumbs.addEventListener("click", (event) => {
  const crumb = event.target.closest("[data-crumb]");
  if (crumb) navigate(crumb.dataset.crumb);
});

$("#transfers").addEventListener("click", (event) => {
  const row = event.target.closest("[data-tid]");
  if (!row) return;
  const transfer = state.transfers.get(row.dataset.tid);
  if (transfer && transfer.path && !transfer.zip) {
    const entry = findEntry(transfer.path);
    if (entry && !entry.is_dir) preview(entry);
  }
});

$$(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    const action = btn.dataset.action;
    if (action === "home") navigate("");
    if (action === "transfers") {
      $transfers.classList.remove("hidden");
      $transferList.classList.remove("hidden");
    }
    if (action === "qr") showQr();
    if (action === "devices") showDevices();
    if (action === "theme") {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(next);
    }
    if (action === "refresh") {
      load(state.path, { silent: true });
      loadInfo().catch(() => {});
      toast("Actualisé", "info");
    }
  });
});

/* ------------------------------------------------------------ shortcuts */

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!$lightbox.classList.contains("hidden")) return $("#lbClose").click();
    if (!$modal.classList.contains("hidden")) return closeModal();
    closePopover();
    return;
  }

  const typing =
    event.target instanceof HTMLElement &&
    ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName);

  if (typing) return;

  if (event.key === "/") {
    event.preventDefault();
    $search.focus();
  } else if (event.key.toLowerCase() === "n") {
    event.preventDefault();
    newFolder();
  } else if (event.key.toLowerCase() === "u") {
    event.preventDefault();
    pickFiles();
  }
});

/* ------------------------------------------------------------ init */

async function init() {
  state.path = pathFromHash();
  $$("[data-view]").forEach((b) => b.classList.toggle("is-active", b.dataset.view === state.view));
  $("#sortSelect").value = state.sort;

  try {
    await loadInfo();
    await loadPeers();
    if (state.locked) return;
    await load(state.path, { silent: true });
    connectSocket();
  } catch (error) {
    if (error.message !== "locked") {
      toast("Impossible de joindre le serveur", "error");
    }
  }
}

init();

setInterval(() => loadPeers(), 3000);

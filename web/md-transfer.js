// MiniDisc → PC transfer: download tracks from NetMD (netmd-js) or Hi-MD (himd-js) media,
// decode them to WAV, convert to MP3 with ffmpeg.wasm, write ID3 tags and save them to a folder.

const MD_LIB_URL = "/vendor/md-lib.js";
const FFMPEG_URL = "/vendor/ffmpeg/index.js";
const FFMPEG_CORE_BASE = globalThis.ALBUM_DECK_FFMPEG_CORE_BASE || "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
const OPTIONS_KEY = "albumdeck.md-transfer.options.v1";
// Only these NetMD devices implement the track upload (device → PC) command.
export const NETMD_DOWNLOAD_DEVICES = [
  { vendorId: 0x054c, productId: 0x0286, name: "Sony MZ-RH1 / MZ-M200" },
];
// A trimmed MP3 that would lose more than this much audio probably means the MD track is matched to the wrong song.
const TRIM_MISMATCH_LIMIT_MS = 45_000;
const NETMD_ENCODINGS = { 144: "SP", 146: "LP2", 147: "LP4" };
const HIMD_ENCODINGS = { "A3+": "ATRAC3+", AT3: "ATRAC3", PCM: "PCM", MP3: "MP3" };

let mdLibPromise = null;
let ffmpegPromise = null;
let ctx = null;
let source = null;
let mdTracks = [];
let outputDirectory = null;
let running = false;
let bound = false;
// Explorer-style selection: the anchor is where a Shift range starts, the cursor is the focused row.
let selectionAnchor = 0;
let selectionCursor = 0;

const $ = (selector) => document.querySelector(selector);
const el = {};

function loadMdLib() {
  mdLibPromise ||= import(MD_LIB_URL).catch((error) => {
    mdLibPromise = null;
    throw new Error(`MD 라이브러리를 불러오지 못했습니다: ${error.message}`);
  });
  return mdLibPromise;
}

export function loadFfmpeg() {
  ffmpegPromise ||= (async () => {
    const { FFmpeg } = await import(FFMPEG_URL);
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({ coreURL: `${FFMPEG_CORE_BASE}/ffmpeg-core.js`, wasmURL: `${FFMPEG_CORE_BASE}/ffmpeg-core.wasm` });
    return ffmpeg;
  })().catch((error) => {
    ffmpegPromise = null;
    throw new Error(`오디오 변환기(ffmpeg.wasm)를 불러오지 못했습니다. 인터넷 연결을 확인하세요. (${error.message})`);
  });
  return ffmpegPromise;
}

export function netmdDownloadSupport(vendorId, productId) {
  return NETMD_DOWNLOAD_DEVICES.find((device) => device.vendorId === vendorId && device.productId === productId) || null;
}

function hex(value) {
  return value.toString(16).padStart(4, "0");
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function timeLabel(milliseconds) {
  const seconds = Math.max(0, Math.round((milliseconds || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function readOptions() {
  try {
    return { trim: true, albumFolders: true, keepWav: false, bitrate: "320k", ...JSON.parse(localStorage.getItem(OPTIONS_KEY) || "{}") };
  } catch {
    return { trim: true, albumFolders: true, keepWav: false, bitrate: "320k" };
  }
}

function saveOptions() {
  try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(currentOptions())); } catch { /* Options are a convenience only. */ }
}

function currentOptions() {
  return {
    trim: el.trim.checked,
    albumFolders: el.albumFolders.checked,
    keepWav: el.keepWav.checked,
    bitrate: el.bitrate.value,
  };
}

// ---------------------------------------------------------------------------
// Sources

async function connectNetmd() {
  if (!navigator.usb) throw new Error("이 브라우저는 WebUSB를 지원하지 않습니다. Chrome 또는 Edge에서 Album Deck을 열어 주세요.");
  const md = await loadMdLib();
  const iface = await md.openNewDevice(navigator.usb);
  if (!iface) return null;
  const vendorId = iface.netMd.getVendor();
  const productId = iface.netMd.getProduct();
  const deviceName = iface.netMd.getDeviceName();
  const disc = await md.listContent(iface);
  const tracks = md.getTracks(disc).sort((a, b) => a.index - b.index).map((track) => ({
    index: track.index,
    title: track.title || track.fullWidthTitle || "",
    artist: "",
    album: "",
    durationMs: Math.round((track.duration / 512) * 1000),
    codec: `${NETMD_ENCODINGS[track.encoding] || "ATRAC"}${track.channel === 1 ? " mono" : ""}`,
  }));
  const supported = netmdDownloadSupport(vendorId, productId);
  return {
    kind: "netmd",
    label: "NetMD",
    deviceName: `${deviceName} (${hex(vendorId)}:${hex(productId)})`,
    discTitle: disc.title || disc.fullWidthTitle || "",
    canDownload: Boolean(supported),
    supportNote: supported
      ? "다운로드 지원 기기"
      : "이 NetMD 기기는 PC로 곡을 보내는 기능을 지원하지 않습니다. NetMD 다운로드는 Sony MZ-RH1 / MZ-M200에서만 가능합니다.",
    tracks,
    async dump(track, onProgress) {
      const [format, data] = await md.upload(iface, track.index, ({ readBytes, totalBytes }) => onProgress(totalBytes ? readBytes / totalBytes : 0));
      const atrac3 = format === md.DiscFormat.lp2 || format === md.DiscFormat.lp4;
      return { data, ext: atrac3 ? "wav" : "aea" };
    },
    async close() {
      try { await iface.netMd.finalize(); } catch { /* The device may already be unplugged. */ }
    },
  };
}

async function openHimd() {
  if (typeof window.showDirectoryPicker !== "function") throw new Error("이 브라우저는 폴더 접근(File System Access API)을 지원하지 않습니다. Chrome 또는 Edge를 사용하세요.");
  const md = await loadMdLib();
  let fs;
  try {
    fs = await md.FSAHiMDFilesystem.init(true, true);
  } catch (error) {
    if (error?.name === "AbortError") return null;
    throw new Error("선택한 폴더가 Hi-MD 디스크가 아닙니다. Hi-MD 기기의 드라이브 최상위(HMDHIFI 폴더가 있는 위치)를 선택하세요.");
  }
  const himd = await md.HiMD.init(fs);
  const tracks = md.getAllTracks(himd).map((track) => ({
    index: track.index,
    title: track.title || "",
    artist: track.artist || "",
    album: track.album || "",
    durationMs: Math.round(track.duration * 1000),
    codec: `${HIMD_ENCODINGS[track.encoding] || track.encoding}${track.bitrate ? ` ${track.bitrate}k` : ""}`,
  }));
  return {
    kind: "himd",
    label: "Hi-MD",
    deviceName: `드라이브 ${fs.getName?.() || "HMDHIFI"}`,
    discTitle: himd.getDiscTitle() || "",
    canDownload: true,
    supportNote: "다운로드 지원 (Hi-MD 모드)",
    tracks,
    async dump(track, onProgress) {
      const slot = himd.trackIndexToTrackSlot(track.index);
      const { format, data } = md.dumpTrack(himd, slot);
      const chunks = [];
      let received = 0;
      let length = 0;
      for await (const { data: chunk, total } of data) {
        chunks.push(chunk.slice());
        length += chunk.length;
        onProgress(total ? Math.min(1, received++ / total) : 0);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return { data: bytes, ext: { MP3: "mp3", WAV: "wav", OMA: "oma" }[format] };
    },
    async close() {},
  };
}

// ---------------------------------------------------------------------------
// Matching MD tracks to Spotify metadata

function normalizeTitle(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s*[([].*?(remaster|version|edit|mix|live|mono|stereo).*?[)\]]\s*/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function defaultMatches(mdList, spotifyTracks) {
  const used = new Set();
  const byTitle = mdList.map((track) => {
    const title = normalizeTitle(track.title);
    if (!title) return -1;
    const found = spotifyTracks.findIndex((candidate, index) => !used.has(index) && normalizeTitle(candidate.name) === title);
    if (found >= 0) used.add(found);
    return found;
  });
  return mdList.map((track, position) => {
    if (byTitle[position] >= 0) return byTitle[position];
    const index = track.index;
    return index < spotifyTracks.length && !used.has(index) ? index : -1;
  });
}

function metadataFor(track, spotifyIndex) {
  const spotify = spotifyIndex >= 0 ? ctx.tracks[spotifyIndex] : null;
  if (spotify) return { tag: spotify, index: spotifyIndex, total: ctx.tracks.length, targetMs: spotify.duration_ms || 0 };
  const album = track.album || source.discTitle || "MiniDisc";
  return {
    tag: {
      name: track.title || `Track ${String(track.index + 1).padStart(2, "0")}`,
      artist: track.artist || "",
      album,
      track_number: track.index + 1,
      track_total: source.tracks.length,
    },
    index: track.index,
    total: source.tracks.length,
    targetMs: 0,
  };
}

// ---------------------------------------------------------------------------
// Filenames and folders

const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function safeName(value, fallback = "Untitled") {
  let name = String(value || "")
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  if (!name) name = fallback;
  if (RESERVED_NAMES.test(name)) name = `_${name}`;
  return name.length > 120 ? name.slice(0, 120).trim() : name;
}

export function albumFolderName(tag) {
  const artist = String(tag.album_artist || tag.artist || "").split(",")[0].trim();
  const album = tag.album || "Unknown Album";
  return safeName(artist ? `${artist} - ${album}` : album, "Unknown Album");
}

export function trackFileBase(tag, fallbackNumber) {
  const number = Number(tag.track_number) || fallbackNumber;
  const disc = Number(tag.disc_total) > 1 && tag.disc_number ? `${tag.disc_number}-` : "";
  return safeName(`${disc}${String(number).padStart(2, "0")} ${tag.name || "Track"}`);
}

async function writeFile(directory, name, blob) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

// ---------------------------------------------------------------------------
// Conversion

function mp3QualityArgs(bitrate) {
  return bitrate === "v0" ? ["-q:a", "0"] : ["-b:a", bitrate];
}

// Decodes the dumped MD data to 16-bit PCM WAV and encodes the MP3. Trimming (when targetMs > 0)
// is applied to the MP3 only, so a kept WAV remains the untouched copy of the MD track.
export async function convertTrack(ffmpeg, { data, ext }, { targetMs = 0, bitrate = "320k", keepWav = false, onStage = () => {} } = {}) {
  const input = `input.${ext}`;
  const wav = "decoded.wav";
  const mp3 = "output.mp3";
  const trim = targetMs > 0 ? ["-t", (targetMs / 1000).toFixed(3)] : [];
  const cleanup = async () => {
    for (const name of [input, wav, mp3]) { try { await ffmpeg.deleteFile(name); } catch { /* Not created. */ } }
  };
  const run = async (args, stage) => {
    const code = await ffmpeg.exec(args);
    if (code !== 0) throw new Error(`${stage} 실패 (ffmpeg ${code})`);
  };
  try {
    await ffmpeg.writeFile(input, data);
    let wavData = null;
    if (ext !== "mp3" || keepWav) {
      onStage("WAV 변환");
      await run(["-hide_banner", "-y", "-i", input, "-vn", "-map_metadata", "-1", "-c:a", "pcm_s16le", wav], "WAV 변환");
      if (keepWav) wavData = await ffmpeg.readFile(wav);
    }
    onStage("MP3 변환");
    if (ext === "mp3") {
      // Hi-MD MP3 tracks are already MP3; copy the frames instead of re-encoding.
      await run(["-hide_banner", "-y", "-i", input, ...trim, "-vn", "-map_metadata", "-1", "-c:a", "copy", "-id3v2_version", "0", "-write_id3v1", "0", mp3], "MP3 변환");
    } else {
      await run(["-hide_banner", "-y", "-i", wav, ...trim, "-c:a", "libmp3lame", ...mp3QualityArgs(bitrate), "-id3v2_version", "0", "-write_id3v1", "0", mp3], "MP3 변환");
    }
    const mp3Data = await ffmpeg.readFile(mp3);
    return { mp3: mp3Data, wav: wavData };
  } finally {
    await cleanup();
  }
}

// ---------------------------------------------------------------------------
// UI

function bind() {
  if (bound) return;
  bound = true;
  Object.assign(el, {
    dialog: $("#mdDialog"), connectNetmd: $("#mdConnectNetmd"), openHimd: $("#mdOpenHimd"),
    device: $("#mdDevice"), deviceName: $("#mdDeviceName"), deviceSupport: $("#mdDeviceSupport"), discInfo: $("#mdDiscInfo"),
    contextNote: $("#mdContextNote"), toolbar: $("#mdTrackToolbar"), selectAll: $("#mdSelectAll"), selectionCount: $("#mdSelectionCount"),
    trackList: $("#mdTrackList"), trim: $("#mdTrimOption"), albumFolders: $("#mdAlbumFolderOption"), keepWav: $("#mdKeepWavOption"),
    bitrate: $("#mdBitrate"), chooseFolder: $("#mdChooseFolder"), folderSummary: $("#mdFolderSummary"),
    progress: $("#mdProgress"), close: $("#mdClose"), start: $("#mdStart"),
  });
  const options = readOptions();
  el.trim.checked = Boolean(options.trim);
  el.albumFolders.checked = Boolean(options.albumFolders);
  el.keepWav.checked = Boolean(options.keepWav);
  if ([...el.bitrate.options].some((option) => option.value === options.bitrate)) el.bitrate.value = options.bitrate;
  for (const input of [el.trim, el.albumFolders, el.keepWav, el.bitrate]) input.addEventListener("change", saveOptions);

  el.connectNetmd.addEventListener("click", () => useSource(connectNetmd));
  el.openHimd.addEventListener("click", () => useSource(openHimd));
  el.selectAll.addEventListener("change", () => {
    trackBoxes().forEach((box) => { box.checked = el.selectAll.checked; });
    updateSelection();
  });
  el.trackList.addEventListener("click", onTrackListClick);
  el.trackList.addEventListener("keydown", onTrackListKeydown);
  // Keep Shift+click from selecting row text.
  el.trackList.addEventListener("mousedown", (event) => { if (event.shiftKey && !event.target.closest("select")) event.preventDefault(); });
  el.chooseFolder.addEventListener("click", () => chooseOutputDirectory().catch((error) => {
    if (error?.name !== "AbortError") ctx.showToast(error.message, "error", 7000);
  }));
  el.start.addEventListener("click", () => runTransfer().catch((error) => {
    ctx.showToast(error.message, "error", 9000);
    log(`오류 · ${error.message}`);
  }).finally(() => { running = false; updateSelection(); }));
  el.close.addEventListener("click", () => el.dialog.close());
  el.dialog.addEventListener("cancel", (event) => { if (running) event.preventDefault(); });
}

export function openMdTransferDialog(context) {
  ctx = context;
  bind();
  el.progress.hidden = true;
  el.progress.textContent = "";
  el.contextNote.textContent = ctx.tracks.length
    ? `태그 정보: ${ctx.contextLabel} (${ctx.tracks.length}곡). 곡마다 매칭할 Spotify 곡을 바꿀 수 있습니다.`
    : "Spotify 앨범/플레이리스트를 선택하지 않아 MD에 기록된 제목으로 태그를 기록합니다. 원곡 길이 맞춤은 Spotify 곡과 매칭된 곡에만 적용됩니다.";
  if (source) renderTracks();
  updateSelection();
  el.dialog.showModal();
}

async function useSource(factory) {
  if (running) return;
  el.connectNetmd.disabled = true;
  el.openHimd.disabled = true;
  try {
    // Release the current device first so the same NetMD device can be claimed again.
    if (source) {
      await source.close();
      source = null;
      mdTracks = [];
      el.device.hidden = true;
      el.toolbar.hidden = true;
      el.trackList.replaceChildren();
    }
    const next = await factory();
    if (!next) return;
    source = next;
    mdTracks = source.tracks;
    renderTracks();
    if (!source.canDownload) ctx.showToast(source.supportNote, "warning", 9000);
  } catch (error) {
    ctx.showToast(error.message, "error", 9000);
  } finally {
    el.connectNetmd.disabled = false;
    el.openHimd.disabled = false;
    updateSelection();
  }
}

function renderTracks() {
  el.device.hidden = false;
  el.deviceName.textContent = `${source.label} · ${source.deviceName}`;
  el.deviceSupport.textContent = source.canDownload ? `✓ ${source.supportNote}` : `✕ ${source.supportNote}`;
  el.deviceSupport.classList.toggle("unsupported", !source.canDownload);
  el.discInfo.textContent = `${source.discTitle ? `“${source.discTitle}” · ` : ""}${mdTracks.length}곡`;
  el.toolbar.hidden = !mdTracks.length;
  el.selectAll.checked = source.canDownload;
  el.trackList.replaceChildren();
  selectionAnchor = 0;
  selectionCursor = 0;
  if (!mdTracks.length) {
    el.trackList.append(make("div", "md-empty", "디스크에 기록된 곡이 없습니다."));
    return;
  }
  const matches = defaultMatches(mdTracks, ctx.tracks);
  mdTracks.forEach((track, position) => {
    const row = make("div", "md-track");
    row.dataset.position = String(position);
    const box = make("input", "md-track-check");
    box.type = "checkbox";
    box.checked = source.canDownload;
    box.disabled = !source.canDownload;
    box.dataset.position = String(position);
    box.tabIndex = -1;
    box.setAttribute("aria-label", `${track.index + 1}번 곡 선택`);
    const copy = make("span", "md-track-copy");
    copy.append(
      make("strong", "", track.title || "(제목 없음)"),
      make("span", "", [track.artist, track.album].filter(Boolean).join(" · ")),
    );
    row.append(box, make("span", "md-track-number", String(track.index + 1).padStart(2, "0")), copy,
      make("span", "md-track-codec", track.codec), make("span", "md-track-duration", timeLabel(track.durationMs)));
    const select = make("select", "md-track-match");
    select.dataset.position = String(position);
    select.setAttribute("aria-label", `${track.index + 1}번 곡에 사용할 태그 정보`);
    select.append(new Option("MD 정보 사용", "-1"));
    ctx.tracks.forEach((candidate, index) => select.append(new Option(`${String(index + 1).padStart(2, "0")}. ${candidate.name} (${timeLabel(candidate.duration_ms)})`, String(index))));
    select.value = String(matches[position]);
    select.disabled = !ctx.tracks.length;
    row.append(select);
    el.trackList.append(row);
  });
}

function trackBoxes() {
  return [...el.trackList.querySelectorAll(".md-track-check")];
}

function setRange(boxes, from, to, checked) {
  for (let index = Math.min(from, to); index <= Math.max(from, to); index++) boxes[index].checked = checked;
}

function moveCursor(position) {
  selectionCursor = position;
  const row = el.trackList.querySelector(`.md-track[data-position="${position}"]`);
  row?.scrollIntoView({ block: "nearest" });
}

// Mouse selection as in Windows Explorer:
//   click = select only this row, Ctrl+click = toggle, Shift+click = select anchor..row,
//   Ctrl+Shift+click = add anchor..row. Clicking the checkbox itself toggles the row
//   (Shift+checkbox applies the new state to the whole range).
function onTrackListClick(event) {
  if (!source?.canDownload || running || event.target.closest("select")) return;
  const row = event.target.closest(".md-track");
  if (!row) return;
  const boxes = trackBoxes();
  const position = Number(row.dataset.position);
  const additive = event.ctrlKey || event.metaKey;
  if (event.target.classList.contains("md-track-check")) {
    if (event.shiftKey) setRange(boxes, selectionAnchor, position, boxes[position].checked);
    else selectionAnchor = position;
  } else if (event.shiftKey) {
    if (!additive) boxes.forEach((box) => { box.checked = false; });
    setRange(boxes, selectionAnchor, position, true);
  } else if (additive) {
    boxes[position].checked = !boxes[position].checked;
    selectionAnchor = position;
  } else {
    boxes.forEach((box, index) => { box.checked = index === position; });
    selectionAnchor = position;
  }
  moveCursor(position);
  el.trackList.focus({ preventScroll: true });
  updateSelection();
}

// Keyboard: ↑/↓/Home/End move (Shift extends the range from the anchor, Ctrl only moves the cursor),
// Space toggles the cursor row, Ctrl+A selects every track.
function onTrackListKeydown(event) {
  if (!source?.canDownload || running || event.target.closest("select")) return;
  const boxes = trackBoxes();
  if (!boxes.length) return;
  const additive = event.ctrlKey || event.metaKey;
  if (additive && event.key.toLowerCase() === "a") {
    event.preventDefault();
    boxes.forEach((box) => { box.checked = true; });
    updateSelection();
    return;
  }
  if (event.key === " ") {
    event.preventDefault();
    boxes[selectionCursor].checked = !boxes[selectionCursor].checked;
    selectionAnchor = selectionCursor;
    updateSelection();
    return;
  }
  const last = boxes.length - 1;
  const next = { ArrowUp: selectionCursor - 1, ArrowDown: selectionCursor + 1, Home: 0, End: last }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  const position = Math.max(0, Math.min(last, next));
  if (event.shiftKey) {
    if (!additive) boxes.forEach((box) => { box.checked = false; });
    setRange(boxes, selectionAnchor, position, true);
  } else if (!additive) {
    boxes.forEach((box, index) => { box.checked = index === position; });
    selectionAnchor = position;
  }
  moveCursor(position);
  updateSelection();
}

function selectedRows() {
  return [...el.trackList.querySelectorAll(".md-track-check")]
    .filter((box) => box.checked && !box.disabled)
    .map((box) => {
      const position = Number(box.dataset.position);
      const select = el.trackList.querySelector(`.md-track-match[data-position="${position}"]`);
      return { track: mdTracks[position], spotifyIndex: Number(select?.value ?? -1) };
    });
}

function updateSelection() {
  if (!bound) return;
  const count = source ? selectedRows().length : 0;
  el.selectionCount.textContent = source ? `${count}/${mdTracks.length}곡 선택` : "";
  if (source && mdTracks.length) {
    el.selectAll.checked = count === mdTracks.length;
    el.selectAll.indeterminate = count > 0 && count < mdTracks.length;
    el.trackList.querySelectorAll(".md-track").forEach((row) => {
      const position = Number(row.dataset.position);
      row.classList.toggle("selected", row.querySelector(".md-track-check").checked);
      row.classList.toggle("cursor", position === selectionCursor);
      row.setAttribute("aria-selected", String(row.querySelector(".md-track-check").checked));
    });
  }
  el.folderSummary.textContent = outputDirectory ? `저장 위치: ${outputDirectory.name}` : "선택된 폴더 없음";
  el.start.disabled = running || !count || !outputDirectory || !source?.canDownload;
  el.connectNetmd.disabled = running;
  el.openHimd.disabled = running;
  el.chooseFolder.disabled = running;
  el.close.disabled = running;
}

async function chooseOutputDirectory() {
  if (typeof window.showDirectoryPicker !== "function") throw new Error("이 브라우저는 저장 폴더 선택을 지원하지 않습니다. Chrome 또는 Edge를 사용하세요.");
  outputDirectory = await window.showDirectoryPicker({ mode: "readwrite", id: "album-deck-md-output", startIn: "music" });
  updateSelection();
}

function log(line) {
  el.progress.hidden = false;
  el.progress.textContent += `${el.progress.textContent ? "\n" : ""}${line}`;
  el.progress.scrollTop = el.progress.scrollHeight;
}

function setStatus(line) {
  el.progress.hidden = false;
  const lines = el.progress.textContent.split("\n");
  lines[lines.length - 1] = line;
  el.progress.textContent = lines.join("\n");
}

async function runTransfer() {
  const rows = selectedRows();
  if (!rows.length || !outputDirectory || !source?.canDownload) return;
  if (await outputDirectory.requestPermission?.({ mode: "readwrite" }) === "denied") throw new Error("저장 폴더에 쓸 권한이 없습니다.");
  running = true;
  updateSelection();
  const options = currentOptions();
  el.progress.textContent = "";
  log("오디오 변환기를 준비하는 중…");
  const ffmpeg = await loadFfmpeg();
  setStatus("오디오 변환기 준비 완료");
  let done = 0;
  for (const [position, { track, spotifyIndex }] of rows.entries()) {
    const label = `${position + 1}/${rows.length} · ${String(track.index + 1).padStart(2, "0")} ${track.title || "(제목 없음)"}`;
    log(`${label} · 다운로드 0%`);
    try {
      const meta = metadataFor(track, spotifyIndex);
      const dumped = await source.dump(track, (ratio) => setStatus(`${label} · 다운로드 ${Math.round(ratio * 100)}%`));
      let targetMs = 0;
      let trimNote = "";
      if (options.trim) {
        if (!meta.targetMs) trimNote = " · 길이 맞춤 건너뜀(Spotify 매칭 없음)";
        else if (track.durationMs - meta.targetMs > TRIM_MISMATCH_LIMIT_MS) trimNote = ` · 길이 맞춤 건너뜀(MD가 원곡보다 ${Math.round((track.durationMs - meta.targetMs) / 1000)}초 김, 매칭 확인 필요)`;
        else { targetMs = meta.targetMs; trimNote = ` · ${timeLabel(targetMs)}로 맞춤`; }
      }
      const { mp3, wav } = await convertTrack(ffmpeg, dumped, {
        targetMs,
        bitrate: options.bitrate,
        keepWav: options.keepWav,
        onStage: (stage) => setStatus(`${label} · ${stage}`),
      });
      setStatus(`${label} · 태그 기록`);
      const tag = ctx.id3TagFor(meta.tag, meta.index, meta.total);
      const directory = options.albumFolders
        ? await outputDirectory.getDirectoryHandle(albumFolderName(meta.tag), { create: true })
        : outputDirectory;
      const base = trackFileBase(meta.tag, track.index + 1);
      await writeFile(directory, `${base}.mp3`, new Blob([tag, mp3], { type: "audio/mpeg" }));
      if (wav) await writeFile(directory, `${base}.wav`, new Blob([wav], { type: "audio/wav" }));
      const where = options.albumFolders ? `${albumFolderName(meta.tag)}/` : "";
      setStatus(`완료 · ${where}${base}.mp3${wav ? " (+WAV)" : ""}${trimNote}`);
      done++;
    } catch (error) {
      setStatus(`실패 · ${label} (${error.message})`);
    }
  }
  log(`${done}/${rows.length}곡 저장 완료`);
  ctx.showToast(`${done}곡을 MP3로 저장했습니다.`, done === rows.length ? "success" : "warning", 7000);
}

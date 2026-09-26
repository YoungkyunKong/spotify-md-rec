const runtimeConfig = window.ALBUM_DECK_CONFIG || {};
const TOKEN_KEY = "albumdeck.spotify.session.v1";
const SPOTIFY_CONFIG_KEY = "albumdeck.spotify.config.v1";
const GAP_KEY = "albumdeck.playback.gap-seconds.v1";
const DEVICE_KEY = "albumdeck.playback.device.v1";
const BROWSER_KEY = "albumdeck.browser.preference.v1";
const DEFAULT_REDIRECT_URI = `${location.origin}/callback`;
const SCOPES = [
  "streaming",
  "user-read-private",
  "user-read-email",
  "user-read-playback-state",
  "user-modify-playback-state",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const dom = {
  connect: $("#connectButton"), dialog: $("#accountDialog"), dialogAction: $("#dialogAction"),
  dialogDisconnect: $("#dialogDisconnect"),
  dialogCancel: $("#dialogCancel"), dialogTitle: $("#dialogTitle"), dialogCopy: $("#dialogCopy"),
  searchForm: $("#searchForm"), searchInput: $("#searchInput"),
  albumGrid: $("#albumGrid"), resultCount: $("#resultCount"), resultsTitle: $("#resultsTitle"),
  playlistGrid: $("#playlistGrid"), playlistCount: $("#playlistCount"), shortcuts: $("#playlistShortcuts"),
  refreshPlaylists: $("#refreshPlaylists"), crumb: $("#crumbCurrent"), searchView: $("#searchView"),
  playlistsView: $("#playlistsView"), playerBar: $("#playerBar"), play: $("#playButton"),
  previous: $("#previousButton"), next: $("#nextButton"), seek: $("#seekSlider"),
  elapsed: $("#elapsedTime"), duration: $("#durationTime"), volume: $("#volumeSlider"),
  nowArt: $("#nowArt"), artLink: $("#artLink"), nowTitle: $("#nowTitle"), nowArtist: $("#nowArtist"),
  trackKind: $("#trackKind"), miniArt: $("#miniArt"), miniTitle: $("#miniTitle"),
  miniArtist: $("#miniArtist"), miniSpotify: $("#miniSpotifyLink"), status: $("#playerStatus"),
  streamFormat: $("#streamFormat"), streamBitrate: $("#streamBitrate"),
  streamQualityNote: $("#streamQualityNote"), miniStreamQuality: $("#miniStreamQuality"),
  output: $("#outputStatus"), equalizer: $("#equalizer"), heroDiscs: $$(".hero-disc"), attribution: $("#spotifyAttribution"),
  toast: $("#toastRegion"), settings: $("#settingsDialog"), settingsButton: $("#settingsButton"),
  help: $("#helpDialog"), helpButton: $("#helpButton"), helpClose: $("#helpClose"),
  settingsCancel: $("#settingsCancel"), settingsSave: $("#settingsSave"), gapInput: $("#gapInput"),
  gapValue: $("#gapValue"), gapBadge: $("#gapBadge"),
  clientIdInput: $("#clientIdInput"), redirectUriInput: $("#redirectUriInput"),
  browserSelect: $("#browserSelect"),
  deviceSelect: $("#deviceSelect"), refreshDevices: $("#refreshDevices"),
  localOutput: $("#localOutputSetting"), localOutputHelp: $("#localOutputHelp"), openSoundSettings: $("#openSoundSettings"),
  queueTitle: $("#contextQueueTitle"), queueCount: $("#contextQueueCount"), queueList: $("#contextTrackList"),
  tagEditor: $("#tagEditorButton"), tagDialog: $("#tagDialog"), chooseTagFiles: $("#chooseTagFiles"),
  tagFileInput: $("#tagFileInput"), tagFileSummary: $("#tagFileSummary"), tagProgress: $("#tagProgress"),
  tagCancel: $("#tagCancel"), applyTags: $("#applyTags"),
};

let token = readSession();
let spotifyConfig = readSpotifyConfig();
let player = null;
let deviceId = null;
let currentState = null;
let activeView = "search";
let busy = false;
let seeking = false;
let playlistCache = [];
let sdkPromise = null;
let currentArtwork = "";
let playbackQueue = [];
let queueTracks = [];
let tagTracks = [];
let queueContextLabel = "선택한 음악";
let tagFileHandles = [];
let tagFiles = [];
let queueIndex = -1;
let queueTrackStarted = false;
let queueMaxPosition = 0;
let queueAdvanceTimer = null;
let queueEndTimer = null;
let queueEndDeadline = 0;
let queueGeneration = 0;
let playbackErrorTimer = null;
let queueInGap = false;
let gapSeconds = readGapSeconds();
let targetDevice = readTargetDevice();
let browserPreference = readBrowserPreference();
let runtimePlatform = "web";
let availableDevices = [];
let volumeTimer = null;
let spotifyBackoffUntil = 0;
let spotifyBackoffReason = "rate";
let lastRemotePollAt = 0;
let remoteStateObservedAt = 0;

function readSpotifyConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(SPOTIFY_CONFIG_KEY) || "null");
    return {
      clientId: String(saved?.clientId || runtimeConfig.clientId || "").trim(),
      redirectUri: String(saved?.redirectUri || runtimeConfig.redirectUri || DEFAULT_REDIRECT_URI).trim(),
    };
  } catch {
    return {
      clientId: String(runtimeConfig.clientId || "").trim(),
      redirectUri: String(runtimeConfig.redirectUri || DEFAULT_REDIRECT_URI).trim(),
    };
  }
}

function validateSpotifyConfig(clientId, redirectUri) {
  const normalizedClientId = String(clientId || "").trim();
  if (!normalizedClientId) throw new Error("Spotify Client ID를 입력해 주세요.");
  if (!/^[A-Za-z0-9]{16,64}$/.test(normalizedClientId)) throw new Error("Spotify Client ID 형식을 확인해 주세요.");
  let url;
  try { url = new URL(String(redirectUri || "").trim()); }
  catch { throw new Error("Redirect URI를 올바른 주소로 입력해 주세요."); }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Redirect URI는 HTTPS 또는 로컬 주소를 사용해야 합니다.");
  }
  url.hash = "";
  return { clientId: normalizedClientId, redirectUri: url.href };
}

function updateSpotifySettingsUi() {
  dom.clientIdInput.value = spotifyConfig.clientId;
  dom.redirectUriInput.value = spotifyConfig.redirectUri || DEFAULT_REDIRECT_URI;
}

function readGapSeconds() {
  try {
    const stored = localStorage.getItem(GAP_KEY);
    if (stored === null) return 2;
    const value = Number(stored);
    return Number.isFinite(value) && value >= 0 && value <= 30 ? value : 2;
  } catch { return 2; }
}

function gapLabel(value) {
  return `${Number(value).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}초`;
}

function readTargetDevice() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEVICE_KEY) || "null");
    return saved?.mode === "spotify" && saved.id
      ? { mode: "spotify", id: saved.id, name: saved.name || "Spotify 장치", type: saved.type || "unknown", supports_volume: saved.supports_volume !== false }
      : { mode: "browser", name: "이 브라우저" };
  } catch { return { mode: "browser", name: "이 브라우저" }; }
}

function usesBrowserPlayer() {
  return targetDevice.mode === "browser";
}

function targetDeviceId() {
  const id = usesBrowserPlayer() ? deviceId : targetDevice.id;
  if (!id) throw new Error("선택한 재생 장치를 사용할 수 없습니다. 설정에서 장치를 새로고침해 주세요.");
  return id;
}

function updateOutputLabel() {
  dom.output.textContent = usesBrowserPlayer() ? "Album Deck · 이 브라우저" : `${targetDevice.name} · Spotify Connect`;
  dom.localOutput.hidden = dom.deviceSelect.value !== "browser";
  setTransportEnabled(Boolean(deviceId));
}

function updateGapUi(value = gapSeconds) {
  dom.gapInput.value = String(value);
  dom.gapValue.textContent = gapLabel(value);
  dom.gapBadge.textContent = gapLabel(value);
}

function deviceTypeLabel(type) {
  const normalized = String(type || "").toLowerCase();
  return ({ computer: "컴퓨터", smartphone: "휴대전화", speaker: "스피커", tv: "TV", game_console: "게임기" })[normalized] || type || "장치";
}

async function refreshDeviceOptions() {
  const preferred = targetDevice;
  dom.refreshDevices.disabled = true;
  dom.deviceSelect.disabled = true;
  try {
    const payload = token ? await spotifyApi("/me/player/devices") : { devices: [] };
    availableDevices = (payload.devices || []).filter((item) => item?.id && !item.is_restricted && item.id !== deviceId);
    dom.deviceSelect.replaceChildren();
    const browserOption = new Option("이 브라우저 · Album Deck", "browser");
    dom.deviceSelect.append(browserOption);
    for (const item of availableDevices) {
      dom.deviceSelect.append(new Option(`${item.name} · ${deviceTypeLabel(item.type)}`, `spotify:${item.id}`));
    }
    if (preferred.mode === "spotify") {
      const match = availableDevices.find((item) => item.id === preferred.id)
        || availableDevices.find((item) => item.name === preferred.name && item.type === preferred.type);
      if (match) {
        targetDevice = { mode: "spotify", id: match.id, name: match.name, type: match.type, supports_volume: match.supports_volume !== false };
        dom.deviceSelect.value = `spotify:${match.id}`;
      } else {
        dom.deviceSelect.append(new Option(`${preferred.name} · 현재 연결 안 됨`, `spotify:${preferred.id}`, false, true));
      }
    } else {
      dom.deviceSelect.value = "browser";
    }
  } catch (error) {
    showToast(`재생 장치를 불러오지 못했습니다: ${error.message}`, "error", 7000);
  } finally {
    dom.deviceSelect.disabled = false;
    dom.refreshDevices.disabled = false;
    dom.localOutput.hidden = dom.deviceSelect.value !== "browser";
  }
}

function selectedDeviceFromSettings() {
  if (dom.deviceSelect.value === "browser") return { mode: "browser", name: "이 브라우저" };
  const id = dom.deviceSelect.value.replace(/^spotify:/, "");
  const device = availableDevices.find((item) => item.id === id);
  if (!device && targetDevice.mode === "spotify" && targetDevice.id === id) return targetDevice;
  if (!device) throw new Error("선택한 Spotify 장치를 찾을 수 없습니다. 장치를 새로고침해 주세요.");
  return { mode: "spotify", id: device.id, name: device.name, type: device.type, supports_volume: device.supports_volume !== false };
}

function readSession() {
  try {
    const saved = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
    if (!saved) return null;
    localStorage.setItem(TOKEN_KEY, saved);
    sessionStorage.removeItem(TOKEN_KEY);
    return JSON.parse(saved);
  }
  catch { return null; }
}

function saveSession(value) {
  token = value;
  localStorage.setItem(TOKEN_KEY, JSON.stringify(value));
  sessionStorage.removeItem(TOKEN_KEY);
  updateConnection(true);
}

function clearSession({ preserveDevice = false } = {}) {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  token = null;
  deviceId = null;
  currentState = null;
  playbackQueue = [];
  queueTracks = [];
  tagTracks = [];
  queueContextLabel = "선택한 음악";
  dom.tagEditor.disabled = true;
  queueIndex = -1;
  if (queueAdvanceTimer) window.clearTimeout(queueAdvanceTimer);
  if (queueEndTimer) window.clearTimeout(queueEndTimer);
  queueAdvanceTimer = null;
  queueEndTimer = null;
  queueEndDeadline = 0;
  queueGeneration += 1;
  queueInGap = false;
  if (!preserveDevice) targetDevice = { mode: "browser", name: "이 브라우저" };
  availableDevices = [];
  if (!preserveDevice) {
    try { localStorage.removeItem(DEVICE_KEY); } catch { /* Ignore unavailable storage. */ }
  }
  if (player) { player.disconnect(); player = null; }
  updateConnection(false);
  renderState(null);
  setTransportEnabled(false);
  dom.status.textContent = "연결 대기 중";
  dom.shortcuts.replaceChildren(make("div", "sidebar-empty", "Spotify에 연결하면\n플레이리스트가 나타납니다."));
  dom.playlistGrid.replaceChildren(makeEmpty("Spotify에 연결해 주세요."));
  dom.albumGrid.replaceChildren(makeWelcome());
  dom.playlistCount.textContent = "";
  dom.resultCount.textContent = "";
  renderContextQueue();
}

function make(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function showToast(message, kind = "", duration = 4800) {
  const toast = make("div", `toast ${kind}`, message);
  dom.toast.append(toast);
  window.setTimeout(() => toast.remove(), duration);
}

function setBusy(value) {
  busy = value;
  dom.connect.disabled = value;
  if (value) dom.connect.textContent = "연결 중…";
  else updateConnection(Boolean(token));
}

function updateConnection(connected) {
  dom.connect.textContent = connected ? "Spotify 연결됨" : "Spotify 연결";
  dom.connect.classList.toggle("connected", connected);
  if (connected) dom.status.textContent = deviceId ? "준비 완료" : "플레이어 연결 중";
  else {
    dom.status.textContent = "연결 대기 중";
  }
}

function randomToken(bytes = 32) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return [...values].map((n) => n.toString(16).padStart(2, "0")).join("");
}

function base64Url(buffer) {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function createChallenge(verifier) {
  return base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

function processOAuthError() {
  const params = new URLSearchParams(location.search);
  const error = params.get("error");
  if (!error) return false;
  history.replaceState({}, "", "/");
  sessionStorage.removeItem("albumdeck.oauth.state");
  sessionStorage.removeItem("albumdeck.oauth.verifier");
  showToast(`Spotify 로그인이 취소되었습니다: ${error}`, "error");
  return true;
}

async function finishAuthorization() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  if (!code) return false;
  const state = params.get("state");
  const expectedState = sessionStorage.getItem("albumdeck.oauth.state");
  const verifier = sessionStorage.getItem("albumdeck.oauth.verifier");
  history.replaceState({}, "", "/");
  sessionStorage.removeItem("albumdeck.oauth.state");
  sessionStorage.removeItem("albumdeck.oauth.verifier");
  if (!state || state !== expectedState || !verifier) {
    showToast("로그인 state 확인에 실패했습니다. 다시 연결해 주세요.", "error");
    return true;
  }
  setBusy(true);
  try {
    const result = await tokenRequest({
      grant_type: "authorization_code", code, redirect_uri: spotifyConfig.redirectUri, code_verifier: verifier,
    });
    saveSession({ ...result, expires_at: Date.now() + result.expires_in * 1000 });
    showToast("Spotify에 연결했습니다.");
  } catch (error) {
    clearSession();
    showToast(`Spotify 로그인 실패: ${error.message}`, "error", 7000);
    setBusy(false);
    return true;
  }
  try {
    await initializeConnectedApp();
  } finally {
    setBusy(false);
  }
  return true;
}

async function initializeConnectedApp() {
  const steps = [
    ["계정 정보", loadProfile()],
    ["플레이리스트", loadPlaylists()],
    ["내장 플레이어", connectPlayer()],
  ];
  const results = await Promise.allSettled(steps.map(([, task]) => task));
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      showToast(`${steps[index][0]} 초기화 실패: ${message}`, "error", 9000);
    }
  });
}

async function startAuthorization() {
  const config = validateSpotifyConfig(spotifyConfig.clientId, spotifyConfig.redirectUri);
  const verifier = randomToken(48);
  const state = randomToken(24);
  sessionStorage.setItem("albumdeck.oauth.verifier", verifier);
  sessionStorage.setItem("albumdeck.oauth.state", state);
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    scope: SCOPES,
    state,
    show_dialog: "true",
    code_challenge_method: "S256",
    code_challenge: await createChallenge(verifier),
  });
  location.assign(`https://accounts.spotify.com/authorize?${params}`);
}

async function tokenRequest(fields) {
  const config = validateSpotifyConfig(spotifyConfig.clientId, spotifyConfig.redirectUri);
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, ...fields }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.error || `Spotify 로그인 오류 (${response.status})`);
  return data;
}

async function accessToken() {
  if (!token?.access_token) throw new Error("Spotify에 먼저 연결해 주세요.");
  if (token.expires_at > Date.now() + 60_000) return token.access_token;
  if (!token.refresh_token) throw new Error("인증이 만료되었습니다. Spotify에 다시 연결해 주세요.");
  const refreshed = await tokenRequest({ grant_type: "refresh_token", refresh_token: token.refresh_token });
  saveSession({ ...token, ...refreshed, refresh_token: refreshed.refresh_token || token.refresh_token,
    expires_at: Date.now() + refreshed.expires_in * 1000 });
  return token.access_token;
}

async function spotifyApi(path, options = {}) {
  const backoffSeconds = Math.ceil((spotifyBackoffUntil - Date.now()) / 1000);
  if (backoffSeconds > 0) {
    if (spotifyBackoffReason === "quota") {
      throw new Error(`Spotify 개발 모드 할당량에 도달했습니다. 리셋 시각은 공개되지 않았으며, 앱이 재요청을 ${backoffSeconds}초 동안 중지합니다.`);
    }
    throw new Error(`Spotify 요청 한도에 도달했습니다. ${backoffSeconds}초 후 다시 시도해 주세요.`);
  }
  const bearer = await accessToken();
  const url = path.startsWith("https://")
    ? new URL(path)
    : new URL(`https://api.spotify.com/v1${path.startsWith("/") ? path : `/${path}`}`);
  if (url.origin !== "https://api.spotify.com" || !url.pathname.startsWith("/v1/")) {
    throw new Error("허용되지 않은 Spotify API 주소입니다.");
  }
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${bearer}`, ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
    });
  } catch (error) {
    throw new Error(`Spotify API 네트워크 오류 (${url.pathname}): ${error.message}`);
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    token.expires_at = 0;
    const refreshed = await accessToken();
    const retry = await fetch(url, { ...options, headers: { Authorization: `Bearer ${refreshed}`, ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
    if (retry.status === 204) return null;
    const retryData = await retry.json().catch(() => ({}));
    if (!retry.ok) throw spotifyError(retry, retryData);
    return retryData;
  }
  if (!response.ok) throw spotifyError(response, data);
  return data;
}

function spotifyError(response, data) {
  const detail = data?.error?.message || data?.error_description || `HTTP ${response.status}`;
  if (response.status === 403) return new Error(`Spotify 재생 권한을 확인해 주세요. ${detail}`);
  if (response.status === 429) {
    const quotaExceeded = data?.error?.reason === "QUOTA_EXCEEDED";
    const headerSeconds = Number(response.headers.get("Retry-After"));
    const waitSeconds = Number.isFinite(headerSeconds) && headerSeconds > 0 ? headerSeconds : (quotaExceeded ? 300 : 30);
    spotifyBackoffUntil = Math.max(spotifyBackoffUntil, Date.now() + waitSeconds * 1000);
    spotifyBackoffReason = quotaExceeded ? "quota" : "rate";
    return new Error(quotaExceeded
      ? (Number.isFinite(headerSeconds) && headerSeconds > 0
        ? `Spotify 개발 모드 할당량에 도달했습니다. Spotify가 ${waitSeconds}초 후 재시도를 요청했습니다. (${detail})`
        : `Spotify 개발 모드 할당량에 도달했습니다. Spotify는 리셋 시각을 제공하지 않았으며, 앱이 5분 동안 재요청을 중지합니다. (${detail})`)
      : `Spotify 요청 한도에 도달했습니다. ${waitSeconds}초 후 다시 시도해 주세요. (${detail})`);
  }
  return new Error(`Spotify API 오류 (${response.status}): ${detail}`);
}

function readBrowserPreference() {
  try {
    const value = localStorage.getItem(BROWSER_KEY);
    return ["auto", "safari", "edge", "chrome"].includes(value) ? value : "auto";
  } catch { return "auto"; }
}

async function refreshBrowserOptions() {
  let config = null;
  try {
    const response = await fetch("/browser-config", { cache: "no-store" });
    if (response.ok) config = await response.json();
  } catch { /* Vercel and other static hosts use the browser-local fallback. */ }
  runtimePlatform = config?.platform || "web";
  const available = Array.isArray(config?.available) && config.available.length
    ? config.available
    : ["edge", "chrome"];
  const labels = { auto: "자동 선택", safari: "Safari", edge: "Microsoft Edge", chrome: "Google Chrome", system: "시스템 기본 브라우저" };
  const values = ["auto", ...available.filter((value) => ["safari", "edge", "chrome"].includes(value))];
  const selected = values.includes(config?.selected) ? config.selected : (values.includes(browserPreference) ? browserPreference : "auto");
  browserPreference = selected;
  dom.browserSelect.replaceChildren(...values.map((value) => new Option(labels[value], value, false, value === selected)));
  if (runtimePlatform === "darwin") {
    dom.localOutputHelp.textContent = "macOS 기본 출력 장치를 사용합니다. Safari만 별도 장치로 보내려면 앱별 오디오 라우팅 도구가 필요합니다.";
    dom.openSoundSettings.textContent = "macOS 출력 설정 안내";
  } else if (runtimePlatform === "win32") {
    dom.localOutputHelp.textContent = "Windows에서 사용 중인 브라우저의 출력 장치를 별도로 지정할 수 있습니다.";
    dom.openSoundSettings.textContent = "Windows 출력 설정 열기";
  }
}

async function loadProfile() {
  const profile = await spotifyApi("/me");
  token.profile = { display_name: profile.display_name, email: profile.email, id: profile.id };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  sessionStorage.removeItem(TOKEN_KEY);
  updateConnection(true);
}

function waitForSdk(timeout = 12_000) {
  if (window.Spotify?.Player) return Promise.resolve();
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = () => {
        if (window.Spotify?.Player && window.spotifySdkReady) resolve();
        else if (Date.now() - started > timeout) reject(new Error("Spotify 재생 SDK를 불러오지 못했습니다. 네트워크나 브라우저 확장 기능을 확인해 주세요."));
        else window.setTimeout(poll, 100);
      };
      poll();
    });
  }
  return sdkPromise;
}

async function connectPlayer() {
  await waitForSdk();
  if (player) return;
  player = new window.Spotify.Player({
    name: "Album Deck",
    volume: 1,
    getOAuthToken: (callback) => accessToken().then(callback).catch((error) => showToast(error.message, "error")),
  });
  player.addListener("ready", ({ device_id }) => {
    deviceId = device_id;
    updateOutputLabel();
    dom.status.textContent = "준비 완료";
    setPlaybackActivity(false);
    setTransportEnabled(true);
    showToast("내장 플레이어가 준비됐습니다.");
  });
  player.addListener("not_ready", () => {
    deviceId = null;
    setPlaybackActivity(false);
    if (usesBrowserPlayer()) {
      dom.status.textContent = "연결 끊김";
      setTransportEnabled(false);
      showToast("플레이어 연결이 끊겼습니다. 브라우저를 확인해 주세요.", "warning");
    }
  });
  player.addListener("player_state_changed", (state) => {
    if (!usesBrowserPlayer()) return;
    renderState(state);
    observeQueueState(state);
  });
  player.addListener("initialization_error", ({ message }) => showToast(`재생기를 시작하지 못했습니다: ${message}`, "error", 8000));
  player.addListener("authentication_error", ({ message }) => showToast(`Spotify 인증 오류: ${message}`, "error", 8000));
  player.addListener("account_error", ({ message }) => showToast(`Web Playback SDK에는 Premium이 필요합니다. ${message}`, "error", 8000));
  player.addListener("playback_error", ({ message }) => handlePlaybackError(message));
  player.addListener("autoplay_failed", () => showToast("브라우저가 자동 재생을 차단했습니다. 재생 버튼을 눌러 주세요.", "warning"));
  const connected = await player.connect();
  if (!connected) throw new Error("Spotify 내장 플레이어에 연결하지 못했습니다.");
}

async function pollPlayer() {
  if (!player) return;
  if (!usesBrowserPlayer()) {
    if (queueIndex >= 0 && (queueTrackStarted || queueInGap || queueEndTimer)) {
      renderEstimatedRemoteProgress();
      return;
    }
    const now = Date.now();
    if (now - lastRemotePollAt < 10_000 || now < spotifyBackoffUntil) return;
    lastRemotePollAt = now;
  }
  try {
    const state = await playbackState();
    if (state) {
      if (!document.hidden) renderState(state);
      observeQueueState(state);
    } else if (queueTrackStarted) {
      observeQueueState(null);
    }
  } catch { /* Keep the last known state during a transient device/API failure. */ }
}

function renderEstimatedRemoteProgress() {
  if (!currentState || currentState.paused || !remoteStateObservedAt || seeking) return;
  const duration = currentState.duration || 0;
  const position = Math.min(duration, (currentState.position || 0) + Date.now() - remoteStateObservedAt);
  dom.elapsed.textContent = timeLabel(position);
  dom.seek.max = String(Math.max(1, duration || 1));
  dom.seek.value = String(position);
}

async function playbackState() {
  if (usesBrowserPlayer()) return player?.getCurrentState();
  const remote = await spotifyApi("/me/player");
  if (!remote?.item || remote.device?.id !== targetDevice.id) return null;
  return {
    paused: !remote.is_playing,
    position: remote.progress_ms || 0,
    duration: remote.item.duration_ms || 0,
    track_window: { current_track: remote.item },
  };
}

async function pausePlayback() {
  if (usesBrowserPlayer()) return player?.pause();
  return spotifyApi(`/me/player/pause?device_id=${encodeURIComponent(targetDeviceId())}`, { method: "PUT" });
}

async function stopPlaybackAtEnd() {
  let failure = null;
  let paused = false;
  for (let attempt = 0; attempt < 3 && !paused; attempt++) {
    try { await pausePlayback(); } catch (error) { failure = error; }
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    try {
      const state = await playbackState();
      paused = !state || state.paused;
    } catch (error) { failure ||= error; }
  }
  if (paused) failure = null;
  if (!paused && !failure) failure = new Error("광출력 정지 상태를 확인하지 못했습니다.");
  try { await seekPlayback(0); } catch (error) { failure ||= error; }
  if (failure) throw failure;
  if (currentState) {
    currentState = { ...currentState, paused: true, position: 0 };
    renderState(currentState);
  }
  dom.status.textContent = "재생 종료 · 광출력 정지";
}

async function togglePlayback() {
  if (usesBrowserPlayer()) return player?.togglePlay();
  const state = await playbackState();
  if (!state) throw new Error("선택한 장치에서 재생 중인 곡이 없습니다.");
  const action = state.paused ? "play" : "pause";
  await spotifyApi(`/me/player/${action}?device_id=${encodeURIComponent(targetDeviceId())}`, { method: "PUT" });
  renderState({ ...state, paused: !state.paused });
}

async function seekPlayback(position) {
  if (usesBrowserPlayer()) return player?.seek(position);
  return spotifyApi(`/me/player/seek?${new URLSearchParams({ position_ms: String(Math.round(position)), device_id: targetDeviceId() })}`, { method: "PUT" });
}

async function setPlaybackVolume(percent) {
  if (usesBrowserPlayer()) return player?.setVolume(percent / 100);
  return spotifyApi(`/me/player/volume?${new URLSearchParams({ volume_percent: String(Math.round(percent)), device_id: targetDeviceId() })}`, { method: "PUT" });
}

function setTransportEnabled(enabled) {
  dom.play.disabled = !enabled;
  dom.previous.disabled = !enabled;
  dom.next.disabled = !enabled;
  dom.seek.disabled = !enabled || !currentState;
  dom.volume.disabled = !enabled || (!usesBrowserPlayer() && targetDevice.supports_volume === false);
}

function currentTrack(state) {
  return state?.track_window?.current_track || null;
}

function setPlaybackActivity(playing) {
  const active = Boolean(playing) && !queueInGap;
  dom.equalizer.classList.toggle("active", active);
  dom.heroDiscs.forEach((disc) => disc.classList.toggle("active", active));
}

function renderStreamQuality(track) {
  if (!track) {
    dom.streamFormat.textContent = "—";
    dom.streamBitrate.textContent = "—";
    dom.streamQualityNote.hidden = true;
    dom.miniStreamQuality.hidden = true;
    return;
  }
  if (usesBrowserPlayer() && track.type === "track") {
    dom.streamFormat.textContent = "AAC (웹 기준)";
    dom.streamBitrate.textContent = "256 kbps (웹 기준)";
    dom.streamQualityNote.textContent = "Spotify 웹 플레이어 안내값입니다. 현재 곡의 실제 전송값은 제공되지 않습니다.";
    dom.miniStreamQuality.textContent = "웹 기준 AAC · 256 kbps (실측 아님)";
  } else {
    dom.streamFormat.textContent = "확인 불가";
    dom.streamBitrate.textContent = "확인 불가";
    dom.streamQualityNote.textContent = usesBrowserPlayer()
      ? "이 콘텐츠의 실제 형식과 비트레이트는 제공되지 않습니다."
      : "Spotify Connect 장치의 실제 형식과 비트레이트는 제공되지 않습니다.";
    dom.miniStreamQuality.textContent = "형식 · 비트레이트 확인 불가";
  }
  dom.streamQualityNote.hidden = false;
  dom.miniStreamQuality.hidden = false;
}

function renderState(state) {
  currentState = state;
  if (!usesBrowserPlayer() && state) remoteStateObservedAt = Date.now();
  const track = currentTrack(state);
  renderStreamQuality(track);
  if (!track) {
    setPlaybackActivity(false);
    dom.playerBar.classList.remove("playing");
    setTransportEnabled(Boolean(usesBrowserPlayer() ? deviceId : targetDevice.id));
    return;
  }
  const playing = !state.paused;
  const artwork = track.album?.images?.[0]?.url || track.album?.image || "";
  const artist = (track.artists || []).map((item) => item.name).join(", ");
  dom.nowTitle.textContent = track.name || "Spotify 트랙";
  dom.nowArtist.textContent = artist || track.album?.name || "";
  dom.trackKind.textContent = track.album?.name || "SPOTIFY PLAYER";
  dom.miniTitle.textContent = track.name || "Spotify 트랙";
  dom.miniArtist.textContent = artist;
  dom.elapsed.textContent = timeLabel(state.position || 0);
  dom.duration.textContent = timeLabel(state.duration || 0);
  dom.seek.max = String(Math.max(1, state.duration || 1));
  if (!seeking) dom.seek.value = String(state.position || 0);
  setPlaybackActivity(playing);
  dom.play.classList.toggle("paused", playing);
  dom.play.setAttribute("aria-label", playing ? "일시정지" : "재생");
  dom.play.title = playing ? "일시정지" : "재생";
  dom.play.innerHTML = `<span class="play-triangle">${playing ? "Ⅱ" : "▶"}</span>`;
  dom.playerBar.classList.toggle("playing", playing);
  dom.status.textContent = queueInGap
    ? (gapSeconds > 0 ? `곡간 무음 · ${gapLabel(gapSeconds)}` : "다음 곡 준비 중")
    : (playing ? "재생 중" : "일시정지");
  dom.seek.disabled = !(usesBrowserPlayer() ? deviceId : targetDevice.id);
  const link = track.uri ? `https://open.spotify.com/track/${encodeURIComponent(track.uri.split(":").at(-1))}` : "https://open.spotify.com";
  dom.artLink.href = link;
  dom.miniSpotify.href = link;
  dom.miniSpotify.hidden = false;
  if (artwork && currentArtwork !== artwork) {
    currentArtwork = artwork;
    dom.nowArt.src = artwork;
    dom.nowArt.hidden = false;
    dom.nowArt.previousElementSibling?.setAttribute("hidden", "");
    const image = new Image();
    image.onload = () => {
      dom.miniArt.replaceChildren(image);
      image.className = "mini-art-image";
    };
    image.src = artwork;
  }
  setTransportEnabled(Boolean(usesBrowserPlayer() ? deviceId : targetDevice.id));
}

function timeLabel(milliseconds) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

async function playContext(uri, label = "재생") {
  if (!token) { openAccountDialog(); return; }
  if (usesBrowserPlayer() && (!deviceId || !player)) { showToast("내장 플레이어가 아직 준비되지 않았습니다.", "warning"); return; }
  try {
    const allTracks = await contextTracks(uri);
    const tracks = allTracks.filter((track) => track.playable);
    if (!tracks.length) throw new Error("재생 가능한 곡을 찾지 못했습니다.");
    if (usesBrowserPlayer()) await player.activateElement();
    queueTracks = tracks;
    tagTracks = allTracks;
    queueContextLabel = label;
    playbackQueue = tracks.map((track) => track.uri);
    queueIndex = 0;
    renderContextQueue(label);
    await playQueuedTrack();
    dom.status.textContent = "재생 요청 전송";
    showToast(`${label}을(를) ${usesBrowserPlayer() ? "Album Deck" : targetDevice.name}에서 재생합니다.`);
  } catch (error) {
    showToast(error.message, "error", 7000);
  }
}

async function playQueuedTrack(index = queueIndex) {
  if (!playbackQueue[index]) return;
  queueGeneration += 1;
  queueIndex = index;
  updateQueueHighlight();
  queueInGap = false;
  queueTrackStarted = false;
  queueMaxPosition = 0;
  if (queueAdvanceTimer) window.clearTimeout(queueAdvanceTimer);
  if (queueEndTimer) window.clearTimeout(queueEndTimer);
  queueAdvanceTimer = null;
  queueEndTimer = null;
  queueEndDeadline = 0;
  const selectedId = targetDeviceId();
  await spotifyApi(`/me/player/play?device_id=${encodeURIComponent(selectedId)}`, {
    method: "PUT", body: JSON.stringify({ uris: [playbackQueue[queueIndex]] }),
  });
  const loaded = await waitForQueuedTrack(playbackQueue[queueIndex], usesBrowserPlayer() ? 4000 : 7000);
  if (!loaded) throw new Error("요청한 곡을 플레이어에 불러오지 못했습니다.");
  if (!usesBrowserPlayer()) {
    renderState(loaded);
    observeQueueState(loaded);
  }
  await new Promise((resolve) => window.setTimeout(resolve, 700));
  const settled = await playbackState();
  if (!usesBrowserPlayer() && settled) renderState(settled);
  if (currentTrack(settled)?.uri === playbackQueue[queueIndex] && settled.paused) {
    await spotifyApi(`/me/player/play?device_id=${encodeURIComponent(selectedId)}`, { method: "PUT" });
  } else if (settled) {
    observeQueueState(settled);
  }
}

async function waitForQueuedTrack(expectedUri, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await playbackState();
    if (currentTrack(state)?.uri === expectedUri) return state;
    await new Promise((resolve) => window.setTimeout(resolve, usesBrowserPlayer() ? 100 : 1000));
  }
  return null;
}

function handlePlaybackError(message) {
  if (!usesBrowserPlayer()) return;
  if (message !== "Playback error" || queueIndex < 0 || !playbackQueue[queueIndex]) {
    showToast(`곡을 재생하지 못했습니다: ${message}`, "error", 8000);
    return;
  }
  if (playbackErrorTimer) window.clearTimeout(playbackErrorTimer);
  playbackErrorTimer = window.setTimeout(async () => {
    playbackErrorTimer = null;
    const state = await player?.getCurrentState().catch(() => null);
    if (currentTrack(state)?.uri !== playbackQueue[queueIndex]) {
      showToast("곡을 재생하지 못했습니다: Playback error", "error", 8000);
    }
  }, 1600);
}

function observeQueueState(state) {
  if (queueIndex < 0 || !playbackQueue.length) return;
  if (!state) return;
  const track = currentTrack(state);
  if (track?.uri !== playbackQueue[queueIndex]) {
    if (queueTrackStarted && queueEndDeadline && Date.now() >= queueEndDeadline - 1500) beginQueueAdvance(state);
    return;
  }
  const position = state.position || 0;
  const duration = state.duration || 0;
  queueMaxPosition = Math.max(queueMaxPosition, position);
  if (!state.paused && position > 0) queueTrackStarted = true;
  if (queueTrackStarted && !state.paused && duration > position) armQueueEndTimer(state);
  const ended = queueTrackStarted && duration > 0
    && (position >= duration
      || (state.paused && position < 1000 && queueMaxPosition >= duration - 2000));
  if (ended) beginQueueAdvance(state);
}

function armQueueEndTimer(state) {
  const remaining = Math.max(0, (state.duration || 0) - (state.position || 0));
  if (!remaining) return;
  const deadline = Date.now() + remaining + 900;
  if (queueEndTimer && Math.abs(deadline - queueEndDeadline) < 1200) return;
  if (queueEndTimer) window.clearTimeout(queueEndTimer);
  queueEndDeadline = deadline;
  const generation = queueGeneration;
  const expectedUri = playbackQueue[queueIndex];
  queueEndTimer = window.setTimeout(() => verifyQueueEnd(generation, expectedUri), Math.max(250, deadline - Date.now()));
}

async function verifyQueueEnd(generation, expectedUri) {
  queueEndTimer = null;
  queueEndDeadline = 0;
  if (generation !== queueGeneration || expectedUri !== playbackQueue[queueIndex] || queueAdvanceTimer) return;
  let state = null;
  try { state = await playbackState(); }
  catch { /* A missing end state is handled below after a track has started. */ }
  if (generation !== queueGeneration || expectedUri !== playbackQueue[queueIndex]) return;
  const track = currentTrack(state);
  if (track?.uri === expectedUri) {
    const remaining = Math.max(0, (state.duration || 0) - (state.position || 0));
    if (!state.paused && remaining > 500) {
      armQueueEndTimer(state);
      return;
    }
    if (state.paused && remaining > 1500 && (state.position || 0) > 1000) {
      queueTrackStarted = false;
      return;
    }
  }
  if (queueTrackStarted) beginQueueAdvance(state);
}

function beginQueueAdvance(state) {
  if (queueAdvanceTimer) return;
  if (queueIndex >= playbackQueue.length - 1) {
    queueTrackStarted = false;
    queueInGap = false;
    if (queueEndTimer) window.clearTimeout(queueEndTimer);
    queueEndTimer = null;
    queueEndDeadline = 0;
    setPlaybackActivity(false);
    dom.playerBar.classList.remove("playing");
    stopPlaybackAtEnd().catch(() => { dom.status.textContent = "재생 종료 · 광출력 정지 실패"; });
    return;
  }
  const generation = queueGeneration;
  const nextIndex = queueIndex + 1;
  queueTrackStarted = false;
  queueInGap = true;
  if (queueEndTimer) window.clearTimeout(queueEndTimer);
  queueEndTimer = null;
  queueEndDeadline = 0;
  if (state && !state.paused) pausePlayback().catch(() => {});
  dom.status.textContent = gapSeconds > 0 ? `곡간 무음 · ${gapLabel(gapSeconds)}` : "다음 곡 준비 중";
  setPlaybackActivity(false);
  dom.playerBar.classList.remove("playing");
  queueAdvanceTimer = window.setTimeout(() => {
    queueAdvanceTimer = null;
    if (generation !== queueGeneration || nextIndex !== queueIndex + 1) return;
    playQueuedTrack(nextIndex).catch((error) => showToast(error.message, "error", 7000));
  }, Math.round(gapSeconds * 1000));
}

async function playNext() {
  if (queueIndex >= 0) {
    if (queueIndex < playbackQueue.length - 1) return playQueuedTrack(queueIndex + 1);
    showToast("마지막 곡입니다.");
    return;
  }
  if (usesBrowserPlayer()) return player?.nextTrack();
  return spotifyApi(`/me/player/next?device_id=${encodeURIComponent(targetDeviceId())}`, { method: "POST" });
}

async function playPrevious() {
  if (queueIndex >= 0) {
    if ((currentState?.position || 0) > 3000 || queueIndex === 0) return playQueuedTrack(queueIndex);
    return playQueuedTrack(queueIndex - 1);
  }
  if (usesBrowserPlayer()) return player?.previousTrack();
  return spotifyApi(`/me/player/previous?device_id=${encodeURIComponent(targetDeviceId())}`, { method: "POST" });
}

function renderContextQueue(label = "선택한 음악") {
  queueContextLabel = label;
  dom.queueTitle.textContent = label;
  dom.queueCount.textContent = `${queueTracks.length}곡`;
  dom.tagEditor.disabled = !(tagTracks.length || queueTracks.length);
  dom.queueList.replaceChildren();
  if (!queueTracks.length) {
    dom.queueList.append(make("div", "context-queue-empty", "앨범이나 플레이리스트를 선택하면\n곡 목록이 표시됩니다."));
    return;
  }
  queueTracks.forEach((track, index) => {
    const row = make("button", "context-track");
    row.type = "button";
    row.dataset.queueIndex = String(index);
    row.setAttribute("aria-label", `${index + 1}. ${track.name} 재생`);
    row.append(make("span", "context-track-number", String(index + 1).padStart(2, "0")));
    const copy = make("span", "context-track-copy");
    copy.append(make("strong", "", track.name), make("span", "", track.artist || "아티스트 정보 없음"));
    row.append(copy, make("span", "context-track-duration", timeLabel(track.duration_ms)));
    row.addEventListener("click", () => playQueuedTrack(index).catch((error) => showToast(error.message, "error", 7000)));
    dom.queueList.append(row);
  });
  updateQueueHighlight(false);
}

function updateQueueHighlight(scroll = true) {
  let active = null;
  dom.queueList.querySelectorAll(".context-track").forEach((row) => {
    const selected = Number(row.dataset.queueIndex) === queueIndex;
    row.classList.toggle("active", selected);
    row.setAttribute("aria-current", selected ? "true" : "false");
    if (selected) active = row;
  });
  if (scroll) active?.scrollIntoView({ block: "nearest" });
}

async function contextTracks(contextUri) {
  const match = /^spotify:(album|playlist):([A-Za-z0-9]+)$/.exec(contextUri || "");
  if (!match) throw new Error("지원하지 않는 Spotify 재생 주소입니다.");
  const [, type, id] = match;
  const rows = type === "album"
    ? await pages(`/albums/${id}/tracks?limit=50`, "items")
    : await pages(`/playlists/${id}/items?limit=50&additional_types=track`, "items");
  return rows
    .map((row) => row?.item || row?.track || row)
    .filter((track) => track?.type === "track" && track.uri)
    .map((track) => ({
      uri: track.uri,
      name: track.name || "제목 없음",
      artist: (track.artists || []).map((artist) => artist.name).filter(Boolean).join(", "),
      duration_ms: track.duration_ms || 0,
      album: track.album?.name || "",
      release_date: track.album?.release_date || "",
      playable: !track.is_local && track.is_playable !== false,
    }));
}

async function searchAlbums(query) {
  if (!query.trim()) return;
  dom.resultsTitle.textContent = `“${query.trim()}” 검색 결과`;
  dom.resultCount.textContent = "검색 중";
  dom.albumGrid.replaceChildren(makeEmpty("Spotify 앨범을 검색하고 있습니다.", true));
  try {
    const data = await spotifyApi(`/search?${new URLSearchParams({ q: query.trim(), type: "album", limit: "10" })}`);
    const albums = data.albums?.items || [];
    dom.resultCount.textContent = `${albums.length} ALBUM${albums.length === 1 ? "" : "S"}`;
    dom.albumGrid.replaceChildren();
    if (!albums.length) dom.albumGrid.append(makeEmpty("검색 결과가 없습니다. 다른 검색어를 입력해 보세요."));
    for (const album of albums) dom.albumGrid.append(makeAlbumCard(album));
  } catch (error) {
    dom.resultCount.textContent = "";
    dom.albumGrid.replaceChildren(makeEmpty(error.message));
    showToast(error.message, "error");
  }
}

function makeAlbumCard(album) {
  const card = make("article", "album-card");
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `${album.name} 앨범 재생`);
  const coverWrap = make("div", "album-cover-wrap");
  const cover = make("img", "album-cover");
  cover.loading = "lazy";
  cover.alt = `${album.name} 앨범 표지`;
  cover.src = album.images?.[0]?.url || "";
  coverWrap.append(cover);
  const external = make("a", "album-open-link", "↗");
  external.href = album.external_urls?.spotify || "https://open.spotify.com";
  external.target = "_blank";
  external.rel = "noreferrer";
  external.title = "Spotify에서 앨범 보기";
  external.setAttribute("aria-label", `${album.name} Spotify에서 열기`);
  external.addEventListener("click", (event) => event.stopPropagation());
  coverWrap.append(external);
  const play = make("button", "card-play", "▶");
  play.type = "button";
  play.title = "앨범 재생";
  play.addEventListener("click", (event) => { event.stopPropagation(); playContext(album.uri, album.name); });
  coverWrap.append(play);
  const name = make("div", "album-name", album.name);
  const meta = make("div", "album-meta", `${(album.artists || []).map((a) => a.name).join(", ")} · ${(album.release_date || "").slice(0, 4)}`);
  card.append(coverWrap, name, meta);
  card.addEventListener("click", () => playContext(album.uri, album.name));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); playContext(album.uri, album.name); }
  });
  return card;
}

async function pages(path, key) {
  const items = [];
  let page = await spotifyApi(path);
  items.push(...(page[key] || []));
  while (page.next) {
    const next = new URL(page.next);
    if (next.origin !== "https://api.spotify.com") throw new Error("Spotify가 잘못된 페이지 주소를 반환했습니다.");
    page = await spotifyApi(next.href);
    items.push(...(page[key] || []));
  }
  return items;
}

async function loadPlaylists() {
  if (!token) return;
  dom.playlistGrid.replaceChildren(makeEmpty("플레이리스트를 불러오고 있습니다.", true));
  const lists = await pages("/me/playlists?limit=50", "items");
  playlistCache = lists.filter((playlist) => playlist?.uri);
  dom.playlistCount.textContent = `${playlistCache.length} LIST${playlistCache.length === 1 ? "" : "S"}`;
  dom.playlistGrid.replaceChildren();
  dom.shortcuts.replaceChildren();
  if (!playlistCache.length) dom.playlistGrid.append(makeEmpty("Spotify 계정에 플레이리스트가 없습니다."));
  for (const playlist of playlistCache) {
    dom.playlistGrid.append(makePlaylistCard(playlist));
    dom.shortcuts.append(makePlaylistShortcut(playlist));
  }
}

function makePlaylistCard(playlist) {
  const card = make("article", "playlist-card");
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `${playlist.name} 플레이리스트 재생`);
  const art = make("img", "playlist-art");
  art.loading = "lazy";
  art.alt = "";
  art.src = playlist.images?.[0]?.url || "";
  const copy = make("div", "playlist-copy");
  const trackTotal = playlist.items?.total ?? playlist.tracks?.total;
  copy.append(make("strong", "", playlist.name), make("span", "", `${trackTotal ?? "—"}곡 · PLAYLIST`));
  const button = make("button", "playlist-play");
  button.type = "button";
  button.title = "플레이리스트 재생";
  button.setAttribute("aria-label", `${playlist.name} 재생`);
  button.addEventListener("click", (event) => { event.stopPropagation(); playContext(playlist.uri, playlist.name); });
  const external = make("a", "playlist-open-link", "↗");
  external.href = playlist.external_urls?.spotify || "https://open.spotify.com";
  external.target = "_blank";
  external.rel = "noreferrer";
  external.title = "Spotify에서 플레이리스트 보기";
  external.setAttribute("aria-label", `${playlist.name} Spotify에서 열기`);
  external.addEventListener("click", (event) => event.stopPropagation());
  card.append(art, copy, external, button);
  card.addEventListener("click", () => playContext(playlist.uri, playlist.name));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); playContext(playlist.uri, playlist.name); }
  });
  return card;
}

function makePlaylistShortcut(playlist) {
  const button = make("button", "shortcut");
  button.type = "button";
  button.title = `${playlist.name} 재생`;
  const art = make("img", "shortcut-art");
  art.alt = "";
  art.loading = "lazy";
  art.src = playlist.images?.[0]?.url || "";
  button.append(art, make("span", "shortcut-name", playlist.name));
  button.addEventListener("click", () => playContext(playlist.uri, playlist.name));
  return button;
}

function makeEmpty(message, loading = false) {
  const node = make("div", "empty-state");
  if (loading) node.append(make("div", "loader"));
  node.append(make("span", "", message));
  return node;
}

function makeWelcome() {
  const node = make("div", "empty-state welcome-state");
  node.append(make("div", "empty-symbol", "◌"), make("strong", "", "검색으로 시작해 보세요"));
  node.append(make("span", "", "좋아하는 앨범이나 아티스트를 입력하면\nSpotify 앨범을 찾아드려요."));
  return node;
}

function openAccountDialog() {
  const connected = Boolean(token);
  dom.dialogTitle.textContent = connected ? "Spotify 연결 관리" : "Spotify 연결";
  dom.dialogCopy.textContent = connected
    ? `현재 ${token?.profile?.display_name || "Spotify 계정"}으로 연결되어 있습니다. 다른 계정을 선택하거나 이 탭의 연결을 해제할 수 있습니다.`
    : "Premium 계정으로 연결해 앨범과 플레이리스트를 이 브라우저에서 재생하세요.";
  dom.dialogDisconnect.hidden = !connected;
  dom.dialogAction.textContent = connected ? "다른 계정으로 연결" : "Spotify 연결";
  dom.dialogAction.dataset.action = connected ? "switch" : "login";
  dom.dialog.showModal();
}

async function openSettingsDialog() {
  updateGapUi();
  updateSpotifySettingsUi();
  dom.settings.showModal();
  await refreshBrowserOptions();
  await refreshDeviceOptions();
}

function setView(view) {
  activeView = view;
  const playlists = view === "playlists";
  dom.searchView.hidden = playlists;
  dom.playlistsView.hidden = !playlists;
  dom.crumb.textContent = playlists ? "내 플레이리스트" : "앨범 찾기";
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  if (playlists && token && playlistCache.length === 0) loadPlaylists().catch((error) => showToast(error.message, "error"));
}

dom.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!token) { openAccountDialog(); return; }
  searchAlbums(dom.searchInput.value);
});
dom.connect.addEventListener("click", () => {
  if (token) { openAccountDialog(); return; }
  if (!spotifyConfig.clientId) {
    openSettingsDialog().catch((error) => showToast(error.message, "error"));
    showToast("설정에서 Spotify Client ID를 먼저 입력해 주세요.", "warning");
    return;
  }
  startAuthorization().catch((error) => showToast(error.message, "error"));
});
dom.settingsButton.addEventListener("click", () => openSettingsDialog().catch((error) => showToast(error.message, "error")));
dom.helpButton.addEventListener("click", () => dom.help.showModal());
dom.helpClose.addEventListener("click", () => dom.help.close());
dom.refreshDevices.addEventListener("click", refreshDeviceOptions);
dom.deviceSelect.addEventListener("change", () => { dom.localOutput.hidden = dom.deviceSelect.value !== "browser"; });
dom.openSoundSettings.addEventListener("click", () => {
  if (runtimePlatform === "darwin") {
    showToast("시스템 설정 → 사운드 → 출력에서 장치를 선택하세요. macOS 기본 설정은 Safari가 아닌 시스템 전체 출력을 변경합니다.", "warning", 9000);
    return;
  }
  if (runtimePlatform === "win32") window.location.href = "ms-settings:apps-volume";
  showToast(runtimePlatform === "win32"
    ? "Windows 설정에서 사용 중인 브라우저의 출력 장치를 선택하세요."
    : "운영체제의 사운드 설정에서 출력 장치를 선택하세요.", "warning", 7000);
});
dom.gapInput.addEventListener("input", () => { dom.gapValue.textContent = gapLabel(dom.gapInput.value); });
dom.settingsCancel.addEventListener("click", () => {
  updateGapUi();
  updateSpotifySettingsUi();
  dom.settings.close();
});
dom.settingsSave.addEventListener("click", () => {
  try {
    const nextSpotifyConfig = validateSpotifyConfig(dom.clientIdInput.value, dom.redirectUriInput.value);
    const clientChanged = nextSpotifyConfig.clientId !== spotifyConfig.clientId;
    const value = Math.min(30, Math.max(0, Math.round(Number(dom.gapInput.value) * 2) / 2));
    gapSeconds = Number.isFinite(value) ? value : 2;
    targetDevice = selectedDeviceFromSettings();
    browserPreference = dom.browserSelect.value;
    spotifyConfig = nextSpotifyConfig;
    localStorage.setItem(SPOTIFY_CONFIG_KEY, JSON.stringify(spotifyConfig));
    localStorage.setItem(GAP_KEY, String(gapSeconds));
    localStorage.setItem(DEVICE_KEY, JSON.stringify(targetDevice));
    localStorage.setItem(BROWSER_KEY, browserPreference);
    fetch("/browser-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preference: browserPreference }),
    }).catch(() => {});
    if (clientChanged && token) clearSession({ preserveDevice: true });
    currentState = null;
    renderStreamQuality(null);
    updateGapUi();
    updateOutputLabel();
    dom.settings.close();
    showToast(clientChanged && !token
      ? "Spotify 앱 설정을 저장했습니다. Spotify에 다시 연결해 주세요."
      : `${targetDevice.name} · 곡간 무음 ${gapLabel(gapSeconds)}로 설정했습니다.`);
  } catch (error) {
    showToast(error.message, "error", 7000);
  }
});
dom.dialogCancel.addEventListener("click", () => dom.dialog.close());
dom.dialogDisconnect.addEventListener("click", () => {
  dom.dialog.close();
  clearSession();
  showToast("이 탭의 Spotify 연결 정보를 지웠습니다.");
});
dom.dialogAction.addEventListener("click", async () => {
  dom.dialog.close();
  if (dom.dialogAction.dataset.action === "switch") clearSession();
  if (!spotifyConfig.clientId) {
    await openSettingsDialog();
    showToast("Spotify Client ID를 입력한 뒤 저장해 주세요.", "warning");
    return;
  }
  startAuthorization().catch((error) => showToast(error.message, "error"));
});
dom.refreshPlaylists.addEventListener("click", () => loadPlaylists().catch((error) => showToast(error.message, "error")));
document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
dom.play.addEventListener("click", () => togglePlayback().catch((error) => showToast(error.message, "error")));
dom.previous.addEventListener("click", () => playPrevious().catch((error) => showToast(error.message, "error")));
dom.next.addEventListener("click", () => playNext().catch((error) => showToast(error.message, "error")));
dom.seek.addEventListener("input", () => { seeking = true; dom.elapsed.textContent = timeLabel(Number(dom.seek.value)); });
dom.seek.addEventListener("change", async () => {
  const position = Number(dom.seek.value);
  if (queueIndex >= 0 && currentState?.duration && position >= currentState.duration - 1000) {
    queueMaxPosition = position;
    queueTrackStarted = true;
  }
  try { await seekPlayback(position); }
  catch (error) { showToast(error.message, "error"); }
  finally { seeking = false; }
});
dom.volume.addEventListener("input", () => {
  if (volumeTimer) window.clearTimeout(volumeTimer);
  volumeTimer = window.setTimeout(() => setPlaybackVolume(Number(dom.volume.value)).catch((error) => showToast(error.message, "error")), usesBrowserPlayer() ? 0 : 220);
});
dom.tagEditor.addEventListener("click", () => openTagDialog());
dom.tagCancel.addEventListener("click", () => dom.tagDialog.close());
dom.chooseTagFiles.addEventListener("click", () => chooseTagFiles().catch((error) => showToast(error.message, "error", 7000)));
dom.tagFileInput.addEventListener("change", () => {
  tagFileHandles = [];
  tagFiles = [...(dom.tagFileInput.files || [])];
  updateTagFileSummary();
});
dom.applyTags.addEventListener("click", () => applyId3Tags().catch((error) => showToast(error.message, "error", 7000)));
dom.attribution.addEventListener("click", () => { if (currentState?.track_window?.current_track?.uri) window.open(`https://open.spotify.com/track/${currentState.track_window.current_track.uri.split(":").at(-1)}`, "_blank", "noopener,noreferrer"); });
window.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.target.matches("input, textarea, button")) return;
  if (event.code === "Space" && player) { event.preventDefault(); togglePlayback().catch(() => {}); }
});

async function boot() {
  if (processOAuthError()) return;
  if (location.search.includes("code=")) { await finishAuthorization(); return; }
  if (!token) { updateConnection(false); return; }
  updateConnection(true);
  try {
    await accessToken();
    await initializeConnectedApp();
  } catch (error) {
    showToast(error.message, "error", 7000);
    if (/401|인증이 만료|invalid_grant/i.test(error.message)) clearSession();
  }
}

function openTagDialog() {
  if (!(tagTracks.length || queueTracks.length)) {
    showToast("먼저 앨범 또는 플레이리스트를 선택하세요.", "warning");
    return;
  }
  tagFileHandles = [];
  tagFiles = [];
  dom.tagFileInput.value = "";
  dom.tagProgress.hidden = true;
  dom.tagProgress.textContent = "";
  updateTagFileSummary();
  dom.tagDialog.showModal();
}

async function chooseTagFiles() {
  if (typeof window.showDirectoryPicker === "function") {
    const directory = await window.showDirectoryPicker({ mode: "readwrite", id: "album-deck-tag-folder" });
    const pairs = [];
    for await (const [name, handle] of directory.entries()) {
      if (handle.kind === "file" && name.toLowerCase().endsWith(".mp3")) pairs.push({ handle, file: await handle.getFile() });
    }
    pairs.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: "base" }));
    tagFileHandles = pairs.map((pair) => pair.handle);
    tagFiles = pairs.map((pair) => pair.file);
  } else if (typeof window.showOpenFilePicker === "function") {
    const handles = await window.showOpenFilePicker({ multiple: true, excludeAcceptAllOption: true, types: [{ description: "MP3 audio", accept: { "audio/mpeg": [".mp3"] } }] });
    const pairs = await Promise.all(handles.map(async (handle) => ({ handle, file: await handle.getFile() })));
    pairs.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: "base" }));
    tagFileHandles = pairs.map((pair) => pair.handle);
    tagFiles = pairs.map((pair) => pair.file);
  } else {
    dom.tagFileInput.click();
    return;
  }
  updateTagFileSummary();
}

function updateTagFileSummary() {
  const count = tagFiles.length;
  dom.tagFileSummary.textContent = count ? `${count}개 파일 선택됨 · 파일명 순서로 매칭` : "선택된 파일 없음";
  dom.applyTags.disabled = !count || !(tagTracks.length || queueTracks.length);
}

function sortTagFiles(files) {
  return [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

async function audioFileDuration(file) {
  const url = URL.createObjectURL(file);
  try {
    const audio = new Audio();
    audio.preload = "metadata";
    const duration = await new Promise((resolveDuration, reject) => {
      const timeout = window.setTimeout(() => reject(new Error(`${file.name}: 재생 시간 판독 시간 초과`)), 10000);
      const finish = () => {
        window.clearTimeout(timeout);
        const value = Number(audio.duration);
        URL.revokeObjectURL(url);
        if (Number.isFinite(value) && value > 0) resolveDuration(value * 1000);
        else reject(new Error(`${file.name}: 재생 시간을 읽을 수 없습니다.`));
      };
      audio.addEventListener("loadedmetadata", finish, { once: true });
      audio.addEventListener("error", () => { window.clearTimeout(timeout); reject(new Error(`${file.name}: MP3 파일을 읽을 수 없습니다.`)); }, { once: true });
      audio.src = url;
      audio.load();
    });
    return duration;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function utf16Frame(frameId, value) {
  const text = String(value || "");
  const utf16 = new Uint8Array(2 + text.length * 2 + 2);
  utf16[0] = 0xff; utf16[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    utf16[2 + i * 2] = code & 0xff;
    utf16[3 + i * 2] = code >> 8;
  }
  const payload = new Uint8Array(1 + utf16.length);
  payload[0] = 1;
  payload.set(utf16, 1);
  const frame = new Uint8Array(10 + payload.length);
  frame.set([...frameId].map((char) => char.charCodeAt(0)), 0);
  new DataView(frame.buffer).setUint32(4, payload.length);
  frame.set(payload, 10);
  return frame;
}

function syncSafe(value) {
  return new Uint8Array([(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f]);
}

function id3TagFor(track, index, total) {
  const frames = [
    utf16Frame("TIT2", track.name),
    utf16Frame("TPE1", track.artist),
    utf16Frame("TALB", track.album || queueContextLabel),
    utf16Frame("TRCK", `${index + 1}/${total}`),
  ];
  if (track.release_date) frames.push(utf16Frame("TYER", track.release_date.slice(0, 4)));
  const bodyLength = frames.reduce((sum, frame) => sum + frame.length, 0);
  const tag = new Uint8Array(10 + bodyLength);
  tag.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00], 0);
  tag.set(syncSafe(bodyLength), 6);
  let offset = 10;
  for (const frame of frames) { tag.set(frame, offset); offset += frame.length; }
  return tag;
}

function existingId3Length(bytes) {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
  return Math.min(bytes.length, 10 + size + ((bytes[5] & 0x10) ? 10 : 0));
}

async function taggedBlob(file, track, index, total) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const offset = existingId3Length(bytes);
  return new Blob([id3TagFor(track, index, total), bytes.slice(offset)], { type: "audio/mpeg" });
}

async function applyId3Tags() {
  const tracks = tagTracks.length ? tagTracks : queueTracks;
  if (!tagFiles.length || !tracks.length) return;
  const files = sortTagFiles(tagFiles);
  const total = Math.min(files.length, tracks.length);
  const results = [];
  dom.applyTags.disabled = true;
  dom.tagProgress.hidden = false;
  for (let index = 0; index < total; index++) {
    const file = files[index];
    const track = tracks[index];
    dom.tagProgress.textContent = `${index + 1}/${total} 확인 중: ${file.name}`;
    let duration;
    try { duration = await audioFileDuration(file); }
    catch (error) { results.push(`건너뜀 · ${file.name} (${error.message})`); continue; }
    const difference = Math.abs(duration - Number(track.duration_ms || 0));
    if (difference > 10000) {
      results.push(`건너뜀 · ${file.name} (길이 차이 ${Math.round(difference / 1000)}초)`);
      continue;
    }
    let blob;
    try {
      blob = await taggedBlob(file, track, index, total);
    } catch (error) {
      results.push(`실패 · ${file.name} (파일 데이터를 읽을 수 없음: ${error.message})`);
      continue;
    }
    if (tagFileHandles[index]?.createWritable) {
      try {
        const handle = tagFileHandles[index];
        const writable = await Promise.race([
          handle.createWritable(),
          new Promise((_, reject) => window.setTimeout(() => reject(new Error("파일 쓰기 준비 시간 초과")), 10000)),
        ]);
        await Promise.race([
          writable.write(blob),
          new Promise((_, reject) => window.setTimeout(() => reject(new Error("파일 쓰기 시간 초과")), 30000)),
        ]);
        if (writable.truncate) await writable.truncate(blob.size);
        await writable.close();
        results.push(`완료 · ${file.name}`);
      } catch (error) {
        results.push(`실패 · ${file.name} (${error.message})`);
      }
    } else {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = file.name; link.click();
      URL.revokeObjectURL(url);
      results.push(`다운로드 · ${file.name}`);
    }
  }
  for (let index = total; index < files.length; index++) results.push(`건너뜀 · ${files[index].name} (Spotify 곡보다 파일이 많음)`);
  dom.tagProgress.textContent = results.join("\n");
  dom.applyTags.disabled = false;
  showToast(`${results.filter((line) => line.startsWith("완료") || line.startsWith("다운로드")).length}개 파일 처리가 완료되었습니다.`, "success", 7000);
}

window.setInterval(pollPlayer, 1000);
updateGapUi();
boot();

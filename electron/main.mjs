import electron from "electron";
import { startAlbumDeckServer } from "../server.mjs";

const { app, BrowserWindow, components, dialog, shell } = electron;
const localUrl = "http://127.0.0.1:8888/";
let mainWindow = null;
let server = null;
let quitting = false;

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("enable-features", "HardwareMediaKeyHandling");

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

function isInternalNavigation(value) {
  try {
    const url = new URL(value);
    if (url.origin === "http://127.0.0.1:8888") return true;
    return url.protocol === "https:"
      && (url.hostname === "spotify.com" || url.hostname.endsWith(".spotify.com"));
  } catch {
    return false;
  }
}

async function prepareWidevine() {
  if (!components?.whenReady) {
    throw new Error("이 Electron 런타임은 Widevine 구성 요소 관리자를 제공하지 않습니다.");
  }

  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("Widevine 준비 시간이 45초를 초과했습니다.")),
      45_000,
    );
  });

  try {
    await Promise.race([components.whenReady(), timeout]);
  } finally {
    clearTimeout(timeoutId);
  }

  process.stdout.write(`DRM components: ${JSON.stringify(components.status?.() || {})}\n`);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: "#101315",
    title: "Album Deck",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isInternalNavigation(url)) return;
    event.preventDefault();
    shell.openExternal(url);
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  await mainWindow.loadURL(localUrl);
  if (!mainWindow.isVisible()) mainWindow.show();
}

async function startDesktopApp() {
  try {
    await prepareWidevine();
  } catch (error) {
    dialog.showMessageBoxSync({
      type: "warning",
      title: "보호된 콘텐츠 준비 실패",
      message: "Spotify 재생에 필요한 Widevine을 준비하지 못했습니다.",
      detail: `${error.message}\n인터넷 연결을 확인한 뒤 앱을 다시 시작해 주세요.`,
    });
  }

  try {
    server = await startAlbumDeckServer({
      host: "127.0.0.1",
      port: 8888,
      publicUrl: "http://127.0.0.1:8888",
    });
  } catch (error) {
    const detail = error?.code === "EADDRINUSE"
      ? "포트 8888을 사용 중인 기존 Album Deck을 먼저 종료해 주세요. 시작 메뉴의 'Album Deck Stop'을 사용할 수 있습니다."
      : error.message;
    dialog.showErrorBox("Album Deck을 시작하지 못했습니다", detail);
    app.quit();
    return;
  }
  await createWindow();
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(startDesktopApp);
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  if (quitting) return;
  quitting = true;
  server?.close();
});

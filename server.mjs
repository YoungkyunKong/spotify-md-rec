import { createServer } from "node:http";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("./web/", import.meta.url)));
const port = Number(process.env.PORT || 8888);
const host = process.env.HOST || "0.0.0.0";
const clientId = process.env.SPOTIFY_CLIENT_ID || null;
const publicUrl = process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL) : null;
if (publicUrl && publicUrl.protocol !== "https:" && publicUrl.hostname !== "127.0.0.1" && publicUrl.hostname !== "[::1]") {
  throw new Error("PUBLIC_URL must use HTTPS except for a loopback address.");
}
const redirectUri = publicUrl ? new URL("/callback", publicUrl).href : null;
const browserConfigPath = process.platform === "win32" && process.env.LOCALAPPDATA
  ? resolve(process.env.LOCALAPPDATA, "AlbumDeck", "browser.json")
  : process.platform === "darwin"
    ? resolve(homedir(), "Library", "Application Support", "AlbumDeck", "browser.json")
    : null;
const windowsBrowsers = {
  edge: [
    resolve(process.env.ProgramFiles || "", "Microsoft\\Edge\\Application\\msedge.exe"),
    resolve(process.env["ProgramFiles(x86)"] || "", "Microsoft\\Edge\\Application\\msedge.exe"),
    resolve(process.env.LOCALAPPDATA || "", "Microsoft\\Edge\\Application\\msedge.exe"),
  ],
  chrome: [
    resolve(process.env.ProgramFiles || "", "Google\\Chrome\\Application\\chrome.exe"),
    resolve(process.env["ProgramFiles(x86)"] || "", "Google\\Chrome\\Application\\chrome.exe"),
    resolve(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
  ],
};
const macBrowsers = {
  safari: ["/Applications/Safari.app", "/System/Applications/Safari.app"],
  chrome: ["/Applications/Google Chrome.app"],
  edge: ["/Applications/Microsoft Edge.app"],
};
const browserExecutables = process.platform === "darwin" ? macBrowsers : process.platform === "win32" ? windowsBrowsers : {};
const allowedBrowserPreferences = ["auto", ...Object.keys(browserExecutables)];
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

const server = createServer(async (request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }

  if (!["GET", "HEAD", "POST"].includes(request.method) || (request.method === "POST" && pathname !== "/browser-config")) {
    response.writeHead(405, { Allow: pathname === "/browser-config" ? "GET, HEAD, POST" : "GET, HEAD" }).end();
    return;
  }

  if (pathname === "/browser-config") {
    if (request.method === "POST") {
      try {
        const body = await readRequestBody(request);
        const payload = JSON.parse(body || "{}");
        if (!allowedBrowserPreferences.includes(payload.preference)) throw new Error("Invalid browser preference");
        if (!browserConfigPath) throw new Error("Browser settings are only available locally.");
        await mkdir(resolve(browserConfigPath, ".."), { recursive: true });
        await writeFile(browserConfigPath, JSON.stringify({ preference: payload.preference }, null, 2), "utf8");
      } catch (error) {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify({ error: error.message }));
        return;
      }
    }
    const config = await browserConfig();
    const content = Buffer.from(JSON.stringify(config));
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": content.length, "Cache-Control": "no-store" });
    response.end(request.method === "HEAD" ? undefined : content);
    return;
  }

  if (pathname === "/healthz") {
    const content = Buffer.from("ok\n");
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Content-Length": content.length, "Cache-Control": "no-store" });
    response.end(request.method === "HEAD" ? undefined : content);
    return;
  }

  if (pathname === "/config.js") {
    const config = JSON.stringify({ clientId, redirectUri }).replaceAll("<", "\\u003c");
    const content = Buffer.from(`window.ALBUM_DECK_CONFIG = ${config};\n`);
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Content-Length": content.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : content);
    return;
  }
  const relative = pathname === "/callback" || pathname === "/" ? "index.html" : pathname.slice(1);
  const file = resolve(root, relative);
  if (file !== root && !file.startsWith(root + sep)) {
    response.writeHead(404).end("Not found");
    return;
  }

  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("Not a file");
    const content = await readFile(file);
    response.writeHead(200, {
      "Content-Type": mime[extname(file)] || "application/octet-stream",
      "Content-Length": content.length,
      "Cache-Control": extname(file) === ".html" ? "no-store" : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
});

server.listen(port, host, () => {
  process.stdout.write(`Album Deck is ready on ${host}:${port}${redirectUri ? ` (${redirectUri})` : ""}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

async function browserConfig() {
  let preference = "auto";
  if (browserConfigPath) {
    try {
      const saved = JSON.parse(await readFile(browserConfigPath, "utf8"));
      if (allowedBrowserPreferences.includes(saved.preference)) preference = saved.preference;
    } catch { /* Use automatic selection when no local preference exists. */ }
  }
  const available = [];
  for (const [id, paths] of Object.entries(browserExecutables)) {
    for (const path of paths) {
      try { await access(path); available.push(id); break; } catch { /* Try the next installation path. */ }
    }
  }
  const selected = preference !== "auto" && available.includes(preference)
    ? preference
    : available[0] || "system";
  return { preference, available, selected, platform: process.platform };
}

function readRequestBody(request) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4096) reject(new Error("Request body is too large"));
    });
    request.on("end", () => resolveBody(body));
    request.on("error", reject);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

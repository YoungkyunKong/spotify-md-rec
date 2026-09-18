import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("./web/", import.meta.url)));
const port = Number(process.env.PORT || 8888);
const host = process.env.HOST || "0.0.0.0";
const clientId = process.env.SPOTIFY_CLIENT_ID || "4f876bef5a0b46f2931b4b5e1cae8af1";
const publicUrl = process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL) : null;
if (publicUrl && publicUrl.protocol !== "https:" && publicUrl.hostname !== "127.0.0.1" && publicUrl.hostname !== "[::1]") {
  throw new Error("PUBLIC_URL must use HTTPS except for a loopback address.");
}
const redirectUri = publicUrl ? new URL("/callback", publicUrl).href : null;
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  } catch {
    response.writeHead(400).end("Bad request");
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
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

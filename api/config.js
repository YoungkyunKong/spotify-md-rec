export default function handler(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    response.status(405).end();
    return;
  }

  const publicUrl = process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL) : null;
  if (publicUrl && publicUrl.protocol !== "https:") {
    response.status(500).end("PUBLIC_URL must use HTTPS.");
    return;
  }
  const config = JSON.stringify({
    clientId: process.env.SPOTIFY_CLIENT_ID || null,
    redirectUri: publicUrl ? new URL("/callback", publicUrl).href : null,
  }).replaceAll("<", "\\u003c");
  response.setHeader("Content-Type", "text/javascript; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.status(200).end(request.method === "HEAD" ? undefined : `window.ALBUM_DECK_CONFIG = ${config};\n`);
}

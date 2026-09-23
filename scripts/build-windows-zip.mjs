import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderUserGuide } from "./render-user-guide.mjs";
import { buildHelpFiles } from "./build-help.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const outputRoot = resolve(root, "dist");
const stage = resolve(outputRoot, "album-deck-windows");
const archive = resolve(outputRoot, `album-deck-windows-v${packageJson.version}.zip`);

await rm(stage, { recursive: true, force: true });
await rm(archive, { force: true });
await mkdir(stage, { recursive: true });
await buildHelpFiles(root);

const files = [
  "assets",
  "web",
  "windows",
  "install-windows.cmd",
  "install-windows.ps1",
  "README.md",
  "README.en.md",
  "docs",
  "package.json",
  "package-lock.json",
  "server.mjs",
];

try {
  for (const name of files) {
    await cp(resolve(root, name), resolve(stage, name), { recursive: true });
  }
  const readme = await readFile(resolve(root, "README.md"), "utf8");
  await writeFile(resolve(stage, "사용설명서.html"), renderUserGuide(readme, packageJson.version), "utf8");
  const englishReadme = await readFile(resolve(root, "README.en.md"), "utf8");
  await writeFile(resolve(stage, "User-Guide.html"), renderUserGuide(englishReadme, packageJson.version, {
    lang: "en",
    title: "Album Deck User Guide",
    heading: "User Guide",
    subtitle: "Installation, Spotify setup, MiniDisc recording, and troubleshooting.",
    contentsLabel: "Contents",
    generatedNote: "This HTML file is generated from README.en.md when the release ZIP is built.",
    alternateHref: "사용설명서.html",
    alternateLabel: "한국어",
  }), "utf8");

  if (process.platform === "win32") {
    const powershell = "$ErrorActionPreference = 'Stop'; Compress-Archive -Path (Join-Path $env:ALBUM_DECK_STAGE '*') -DestinationPath $env:ALBUM_DECK_ARCHIVE -CompressionLevel Optimal";
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", powershell], {
      env: { ...process.env, ALBUM_DECK_STAGE: stage, ALBUM_DECK_ARCHIVE: archive },
      stdio: "inherit",
    });
  } else {
    execFileSync("zip", ["-r", "-q", archive, "."], { cwd: stage, stdio: "inherit" });
  }
} finally {
  await rm(stage, { recursive: true, force: true });
}

console.log(`Created ${archive}`);

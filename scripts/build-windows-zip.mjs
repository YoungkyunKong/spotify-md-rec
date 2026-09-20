import { cp, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const outputRoot = resolve(root, "dist");
const stage = resolve(outputRoot, "album-deck-windows");
const archive = resolve(outputRoot, `album-deck-windows-v${packageJson.version}.zip`);

await rm(stage, { recursive: true, force: true });
await rm(archive, { force: true });
await mkdir(stage, { recursive: true });

const files = [
  "assets",
  "web",
  "windows",
  "install-windows.cmd",
  "install-windows.ps1",
  "package.json",
  "package-lock.json",
  "server.mjs",
  "README.md",
];

try {
  for (const name of files) {
    await cp(resolve(root, name), resolve(stage, name), { recursive: true });
  }

  const powershell = "$ErrorActionPreference = 'Stop'; Compress-Archive -Path (Join-Path $env:ALBUM_DECK_STAGE '*') -DestinationPath $env:ALBUM_DECK_ARCHIVE -CompressionLevel Optimal";
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", powershell], {
    env: { ...process.env, ALBUM_DECK_STAGE: stage, ALBUM_DECK_ARCHIVE: archive },
    stdio: "inherit",
  });
} finally {
  await rm(stage, { recursive: true, force: true });
}

console.log(`Created ${archive}`);

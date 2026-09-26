#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const server = resolve(packageRoot, "server.mjs");
const port = Number(process.env.PORT || 8888);
const url = `http://127.0.0.1:${port}/`;
const child = spawn(process.execPath, [server], { stdio: "inherit", env: process.env });

function openBrowser() {
  if (process.platform === "win32") {
    spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } else if (process.platform === "darwin") {
    const browsers = {
      safari: { app: "Safari", paths: ["/Applications/Safari.app", "/System/Applications/Safari.app"] },
      chrome: { app: "Google Chrome", paths: ["/Applications/Google Chrome.app"] },
      edge: { app: "Microsoft Edge", paths: ["/Applications/Microsoft Edge.app"] },
    };
    let preference = "safari";
    try {
      const configPath = resolve(homedir(), "Library", "Application Support", "AlbumDeck", "browser.json");
      const saved = JSON.parse(readFileSync(configPath, "utf8"));
      if (["auto", ...Object.keys(browsers)].includes(saved.preference)) preference = saved.preference;
    } catch { /* Safari remains the macOS default. */ }
    const order = preference === "auto" ? ["safari", "chrome", "edge"] : [preference, "safari", "chrome", "edge"];
    const browser = order.map((id) => browsers[id]).find((candidate) => candidate?.paths.some(existsSync));
    const args = browser ? ["-a", browser.app, url] : [url];
    spawn("open", args, { detached: true, stdio: "ignore" }).unref();
  } else if (existsSync("/usr/bin/xdg-open")) {
    spawn("/usr/bin/xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    console.log(`Album Deck is ready at ${url}`);
  }
}

const timer = setTimeout(openBrowser, 700);
timer.unref();
child.on("exit", (code, signal) => {
  clearTimeout(timer);
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

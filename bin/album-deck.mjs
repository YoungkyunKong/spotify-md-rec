#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
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

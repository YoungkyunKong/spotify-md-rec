import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHelpFiles } from "./build-help.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const source = resolve(root, "web");
const output = resolve(root, "public");
if (dirname(output) !== root) {
  throw new Error("Invalid Vercel output directory.");
}

await buildHelpFiles(root);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of await readdir(source)) {
  if (name === "config.js") continue;
  await cp(resolve(source, name), resolve(output, name), { recursive: true });
}

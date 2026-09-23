import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderUserGuide } from "./render-user-guide.mjs";

const defaultRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));

function withoutLanguageSelector(markdown) {
  return markdown.replace("[한국어](README.md) | [English](README.en.md)\n\n", "");
}

export async function buildHelpFiles(root = defaultRoot) {
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const webRoot = resolve(root, "web");
  const imageTarget = resolve(webRoot, "docs/images");
  await mkdir(imageTarget, { recursive: true });
  await cp(resolve(root, "docs/images"), imageTarget, { recursive: true });

  const koreanReadme = withoutLanguageSelector(await readFile(resolve(root, "README.md"), "utf8"));
  await writeFile(resolve(webRoot, "help.html"), renderUserGuide(koreanReadme, packageJson.version, {
    alternateHref: "help-en.html",
    alternateLabel: "English",
    generatedNote: "이 도움말은 README.md에서 자동 생성되었습니다.",
  }), "utf8");

  const englishReadme = withoutLanguageSelector(await readFile(resolve(root, "README.en.md"), "utf8"));
  await writeFile(resolve(webRoot, "help-en.html"), renderUserGuide(englishReadme, packageJson.version, {
    lang: "en",
    title: "Album Deck User Guide",
    heading: "User Guide",
    subtitle: "Installation, Spotify setup, MiniDisc recording, and troubleshooting.",
    contentsLabel: "Contents",
    generatedNote: "This help page is generated from README.en.md.",
    alternateHref: "help.html",
    alternateLabel: "한국어",
  }), "utf8");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildHelpFiles();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function inlineMarkdown(source) {
  const tokens = [];
  const hold = (html) => {
    const marker = `\u0000${tokens.length}\u0000`;
    tokens.push(html);
    return marker;
  };

  let text = String(source)
    .replace(/`([^`]+)`/g, (_, code) => hold(`<code>${escapeHtml(code)}</code>`))
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => hold(
      `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy">`,
    ))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => hold(
      `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`,
    ));

  text = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
}

function headingId(text, usedIds) {
  const base = text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "section";
  const count = usedIds.get(base) || 0;
  usedIds.set(base, count + 1);
  return count ? `${base}-${count + 1}` : base;
}

function listItem(line) {
  const match = line.match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
  if (!match) return null;
  return {
    indent: match[1].replaceAll("\t", "    ").length,
    type: match[2].endsWith(".") ? "ol" : "ul",
    text: match[3],
  };
}

function renderList(lines, startIndex, indent) {
  const first = listItem(lines[startIndex]);
  const type = first.type;
  let index = startIndex;
  let html = `<${type}>`;

  while (index < lines.length) {
    const item = listItem(lines[index]);
    if (!item || item.indent < indent || item.type !== type) break;
    if (item.indent > indent) {
      const nested = renderList(lines, index, item.indent);
      html += nested.html;
      index = nested.index;
      continue;
    }

    html += `<li>${inlineMarkdown(item.text)}`;
    index += 1;
    const next = listItem(lines[index] || "");
    if (next && next.indent > indent) {
      const nested = renderList(lines, index, next.indent);
      html += nested.html;
      index = nested.index;
    }
    html += "</li>";
  }

  return { html: `${html}</${type}>`, index };
}

function markdownBody(markdown) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const usedIds = new Map();
  const headings = [];
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(`<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ""}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2];
      const id = headingId(title, usedIds);
      if (level === 2) headings.push({ id, title: title.replace(/`/g, "") });
      blocks.push(`<h${level} id="${id}">${inlineMarkdown(title)}</h${level}>`);
      index += 1;
      continue;
    }

    const item = listItem(line);
    if (item) {
      const list = renderList(lines, index, item.indent);
      blocks.push(list.html);
      index = list.index;
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim()) {
      if (paragraph.length && (lines[index].startsWith("```") || /^(#{1,3})\s+/.test(lines[index]) || listItem(lines[index]))) break;
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
  }

  return { body: blocks.join("\n"), headings };
}

export function renderUserGuide(markdown, version, options = {}) {
  const { body, headings } = markdownBody(markdown);
  const navigation = headings.map(({ id, title }) => `<a href="#${id}">${escapeHtml(title)}</a>`).join("\n");
  const {
    lang = "ko",
    title = "Album Deck 사용설명서",
    heading = "사용설명서",
    subtitle = "설치부터 Spotify 연결, MiniDisc 녹음과 문제 해결까지 안내합니다.",
    contentsLabel = "목차",
    generatedNote = "이 HTML은 배포 ZIP을 만들 때 README.md에서 자동 생성되었습니다.",
    alternateHref = "User-Guide.html",
    alternateLabel = "English",
  } = options;
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; --bg:#0d1110; --panel:#151b18; --line:#2b342f; --text:#edf3ee; --muted:#a8b2ab; --accent:#b9f36a; }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin:0; background:var(--bg); color:var(--text); font:16px/1.72 "Segoe UI", "Noto Sans KR", sans-serif; }
    header { padding:56px 28px 48px; border-bottom:1px solid var(--line); background:radial-gradient(circle at 75% 15%, #29401d 0, transparent 34%), #101512; }
    header div { max-width:1120px; margin:auto; }
    header span { color:var(--accent); font-size:13px; font-weight:700; letter-spacing:.16em; }
    header h1 { margin:10px 0 8px; font-size:clamp(34px, 6vw, 62px); line-height:1.05; }
    header p { max-width:720px; margin:0; color:var(--muted); }
    header a { display:inline-block; margin-top:18px; color:var(--accent); font-size:14px; }
    .layout { display:grid; grid-template-columns:250px minmax(0, 820px); gap:52px; max-width:1180px; margin:0 auto; padding:42px 28px 90px; }
    nav { position:sticky; top:24px; align-self:start; max-height:calc(100vh - 48px); overflow:auto; padding:18px; border:1px solid var(--line); border-radius:14px; background:var(--panel); }
    nav strong { display:block; margin-bottom:10px; color:var(--accent); font-size:13px; letter-spacing:.1em; }
    nav a { display:block; padding:5px 0; color:var(--muted); text-decoration:none; font-size:14px; }
    nav a:hover { color:var(--accent); }
    main { min-width:0; }
    h1 { display:none; }
    h2 { margin:58px 0 18px; padding-top:10px; color:var(--accent); font-size:28px; line-height:1.25; border-top:1px solid var(--line); }
    main > h2:first-of-type { margin-top:0; }
    h3 { margin:32px 0 10px; font-size:20px; }
    p, li { color:#d8dfda; }
    a { color:var(--accent); text-underline-offset:3px; }
    strong { color:#fff; }
    ul, ol { padding-left:1.45rem; }
    li { margin:.35rem 0; }
    li > ul, li > ol { margin:.35rem 0 .7rem; }
    code { padding:.15em .38em; border:1px solid #354239; border-radius:5px; background:#101612; color:#d8ffae; font-family:"Cascadia Code", Consolas, monospace; font-size:.9em; }
    pre { overflow:auto; padding:18px; border:1px solid var(--line); border-radius:12px; background:#080b09; }
    pre code { padding:0; border:0; background:transparent; color:#dfe9e1; }
    img { display:block; max-width:100%; height:auto; margin:24px auto 36px; border:1px solid var(--line); border-radius:14px; box-shadow:0 18px 48px #0008; }
    footer { margin-top:70px; padding-top:20px; border-top:1px solid var(--line); color:var(--muted); font-size:13px; }
    @media (max-width:850px) { .layout { display:block; } nav { position:relative; top:0; max-height:none; margin-bottom:36px; columns:2; } nav strong { column-span:all; } }
    @media print { :root { color-scheme:light; --bg:#fff; --panel:#fff; --line:#ddd; --text:#111; --muted:#555; --accent:#326b00; } header { padding:20px 0; background:#fff; } .layout { display:block; padding:0; } nav { display:none; } h1 { display:none; } h2 { break-after:avoid; } img { box-shadow:none; } a { color:#111; } }
  </style>
</head>
<body>
  <header><div><span>ALBUM DECK · v${escapeHtml(version)}</span><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(subtitle)}</p><a href="${escapeHtml(alternateHref)}">${escapeHtml(alternateLabel)}</a></div></header>
  <div class="layout">
    <nav aria-label="${escapeHtml(contentsLabel)}"><strong>CONTENTS</strong>${navigation}</nav>
    <main>${body}<footer>${escapeHtml(generatedNote)}</footer></main>
  </div>
</body>
</html>\n`;
}

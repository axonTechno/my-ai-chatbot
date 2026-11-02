/* =========================================================
   AXON AI — markdown.js
   Safe Markdown renderer: builds DOM nodes, never injects raw
   HTML from the model. Supports headings, lists, tables,
   quotes, links, inline code and fenced code blocks with a
   small syntax highlighter + copy button.
   ========================================================= */

const INLINE_CODE = "\u0000";
const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}

/* ---------- syntax highlighting (tiny, language-agnostic) ---------- */

const KEYWORDS = new Set(
  (
    "const let var function return if else for while do switch case break continue new class extends " +
    "import from export default async await try catch finally throw typeof instanceof in of this super " +
    "null true false undefined void yield static get set def elif lambda pass raise with as and or not " +
    "None True False self fn pub impl struct enum trait use mod match mut ref package func go defer chan " +
    "int float double char bool string String Number Boolean interface type readonly public private protected"
  ).split(" ")
);

function highlight(code, lang) {
  const escaped = escapeHTML(code);
  if (!lang || /^(text|plain|txt|none)$/i.test(lang)) return escaped;

  const pattern = new RegExp(
    [
      "(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*|#[^\\n]*|--[^\\n]*)", // 1 comments
      "(\\&quot;[^\\n]*?\\&quot;|&#39;[^\\n]*?&#39;|`[^`\\n]*`)", // 2 strings
      "\\b(\\d+(?:\\.\\d+)?)\\b", // 3 numbers
      "\\b([A-Za-z_$][\\w$]*)\\b(?=\\s*\\()", // 4 function calls
      "\\b([A-Za-z_$][\\w$]*)\\b" // 5 words
    ].join("|"),
    "g"
  );

  return escaped.replace(pattern, (match, comment, str, num, fn, word) => {
    if (comment) return `<span class="tok-com">${comment}</span>`;
    if (str) return `<span class="tok-str">${str}</span>`;
    if (num) return `<span class="tok-num">${num}</span>`;
    if (fn) return `<span class="tok-fn">${fn}</span>`;
    if (word && KEYWORDS.has(word)) return `<span class="tok-key">${word}</span>`;
    return match;
  });
}

/* ---------- inline formatting ---------- */

function renderInline(text) {
  const frag = document.createDocumentFragment();
  /* split out inline code first so its content is never formatted */
  const parts = String(text).split(/(`[^`\n]+`)/g);

  parts.forEach((part) => {
    if (!part) return;
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      const code = document.createElement("code");
      code.className = "inline";
      code.textContent = part.slice(1, -1);
      frag.appendChild(code);
      return;
    }
    frag.appendChild(renderEmphasis(part));
  });

  return frag;
}

function renderEmphasis(text) {
  const frag = document.createDocumentFragment();
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|~~[^~]+~~|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s<]+)/g;
  let last = 0;
  let m;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    const token = m[0];
    let node = null;

    if (token.startsWith("**") || token.startsWith("__")) {
      node = document.createElement("strong");
      node.textContent = token.slice(2, -2);
    } else if (token.startsWith("~~")) {
      node = document.createElement("s");
      node.textContent = token.slice(2, -2);
    } else if (token.startsWith("*") || token.startsWith("_")) {
      node = document.createElement("em");
      node.textContent = token.slice(1, -1);
    } else if (token.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (linkMatch && /^https?:\/\//i.test(linkMatch[2])) {
        node = document.createElement("a");
        node.href = linkMatch[2];
        node.target = "_blank";
        node.rel = "noopener noreferrer nofollow";
        node.textContent = linkMatch[1];
      }
    } else if (/^https?:\/\//i.test(token)) {
      node = document.createElement("a");
      node.href = token;
      node.target = "_blank";
      node.rel = "noopener noreferrer nofollow";
      node.textContent = token;
    }

    if (node) frag.appendChild(node);
    else frag.appendChild(document.createTextNode(token));
    last = m.index + token.length;
  }

  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}

/* ---------- code block ---------- */

function buildCodeBlock(lang, code) {
  const wrap = document.createElement("div");
  wrap.className = "code-block";

  const head = document.createElement("div");
  head.className = "code-head";

  const label = document.createElement("span");
  label.className = "code-lang";
  label.textContent = lang || "code";
  head.appendChild(label);

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "code-copy";
  copyBtn.dataset.copyCode = "1";
  copyBtn.setAttribute("aria-label", "Copy code");
  copyBtn.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg><span>Copy</span>';
  head.appendChild(copyBtn);

  const pre = document.createElement("pre");
  const codeEl = document.createElement("code");
  codeEl.innerHTML = highlight(code, lang);
  pre.appendChild(codeEl);

  wrap.appendChild(head);
  wrap.appendChild(pre);
  wrap.dataset.raw = code;
  return wrap;
}

/* ---------- block parsing ---------- */

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

function splitRow(line) {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

export function renderMarkdown(markdown) {
  const root = document.createElement("div");
  root.className = "md";
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");

  let i = 0;
  let para = [];

  const flushPara = () => {
    if (!para.length) return;
    const p = document.createElement("p");
    p.appendChild(renderInline(para.join("\n")));
    root.appendChild(p);
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    /* fenced code */
    const fence = /^\s*```([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      flushPara();
      const lang = fence[1] || "";
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; /* skip closing fence */
      root.appendChild(buildCodeBlock(lang, buf.join("\n")));
      continue;
    }

    /* heading */
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      const level = Math.min(h[1].length, 4);
      const el = document.createElement(`h${level}`);
      el.appendChild(renderInline(h[2]));
      root.appendChild(el);
      i++;
      continue;
    }

    /* horizontal rule */
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushPara();
      root.appendChild(document.createElement("hr"));
      i++;
      continue;
    }

    /* blockquote */
    if (/^\s*>\s?/.test(line)) {
      flushPara();
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      const quote = document.createElement("blockquote");
      quote.appendChild(renderMarkdown(buf.join("\n")));
      root.appendChild(quote);
      continue;
    }

    /* table */
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushPara();
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const trh = document.createElement("tr");
      splitRow(line).forEach((cell) => {
        const th = document.createElement("th");
        th.appendChild(renderInline(cell));
        trh.appendChild(th);
      });
      thead.appendChild(trh);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        const tr = document.createElement("tr");
        splitRow(lines[i]).forEach((cell) => {
          const td = document.createElement("td");
          td.appendChild(renderInline(cell));
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
        i++;
      }
      table.appendChild(tbody);
      root.appendChild(table);
      continue;
    }

    /* lists */
    const listMatch = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (listMatch) {
      flushPara();
      const ordered = /\d/.test(listMatch[2]);
      const list = document.createElement(ordered ? "ol" : "ul");
      let baseIndent = listMatch[1].length;

      while (i < lines.length) {
        const lm = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (!lm) break;
        const indent = lm[1].length;
        if (indent < baseIndent) break;
        if (indent > baseIndent) {
          /* nested list — render recursively into the previous <li> */
          const nested = renderMarkdown(lines[i].trimStart());
          const prev = list.lastElementChild;
          if (prev) prev.appendChild(nested.firstChild || nested);
          i++;
          continue;
        }
        const li = document.createElement("li");
        li.appendChild(renderInline(lm[3]));
        list.appendChild(li);
        i++;
      }
      root.appendChild(list);
      baseIndent = 0;
      continue;
    }

    /* blank line ends a paragraph */
    if (line.trim() === "") {
      flushPara();
      i++;
      continue;
    }

    para.push(line);
    i++;
  }

  flushPara();
  return root;
}

/* Convenience: replace a container's content with rendered markdown. */
export function setMarkdown(container, markdown) {
  container.replaceChildren(renderMarkdown(markdown));
}

export { INLINE_CODE };

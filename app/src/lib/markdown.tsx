import type { ReactNode } from "react";

/**
 * A deliberately small Markdown renderer for the manifesto: headings, paragraphs, lists, tables, bold, italics, links
 * and inline code. That is everything docs/paper.md uses; anything else renders as plain text. No dependency, and the
 * output is ordinary JSX the page can style.
 */

const REPO = "https://github.com/Demiladepy/mandate/blob/main/docs/";

export type Block =
  | { kind: "h1" | "h2"; text: string; id: string }
  | { kind: "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] };

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[*`[\]()]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

export function parse(md: string): Block[] {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,2}) (.*)$/.exec(line);
    if (h) {
      const text = h[2]!.trim();
      out.push({ kind: h[1]!.length === 1 ? "h1" : "h2", text, id: slug(text) });
      i++;
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        if (!/^\|?\s*:?-{3,}/.test(lines[i]!.trim().replace(/^\|/, ""))) rows.push(cells(lines[i]!));
        i++;
      }
      out.push({ kind: "table", head: rows[0] ?? [], rows: rows.slice(1) });
      continue;
    }
    if (/^- /.test(line) || /^\d+\. /.test(line)) {
      const ordered = /^\d+\. /.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\d+\. /.test(lines[i]!) : /^- /.test(lines[i]!))) {
        items.push(lines[i]!.replace(ordered ? /^\d+\. / : /^- /, ""));
        i++;
      }
      out.push({ kind: ordered ? "ol" : "ul", items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,2} |\||- |\d+\. )/.test(lines[i]!)) {
      para.push(lines[i]!.trim());
      i++;
    }
    out.push({ kind: "p", text: para.join(" ") });
  }
  return out;
}

function href(url: string) {
  if (/^https?:\/\//.test(url)) return { href: url, external: true };
  if (/\.md$/.test(url)) return { href: REPO + url, external: true };
  return { href: url, external: false };
}

const TOKEN = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))/g;

/** Inline Markdown to React nodes. */
export function inline(text: string, key = "i"): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) nodes.push(text.slice(last, at));
    const t = m[0];
    const k = `${key}-${n++}`;
    if (m[1]) nodes.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (m[2]) nodes.push(<strong key={k}>{inline(t.slice(2, -2), k)}</strong>);
    else if (m[3]) nodes.push(<em key={k}>{inline(t.slice(1, -1), k)}</em>);
    else if (m[4]) {
      const label = /^\[([^\]]+)\]/.exec(t)![1]!;
      const url = /\(([^)\s]+)\)$/.exec(t)![1]!;
      const h = href(url);
      nodes.push(
        <a key={k} href={h.href} {...(h.external ? { target: "_blank", rel: "noreferrer" } : {})}>
          {inline(label, k)}
        </a>,
      );
    }
    last = at + t.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

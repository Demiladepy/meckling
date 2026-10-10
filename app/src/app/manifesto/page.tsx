import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { PAPER } from "@/content/paper";
import { inline, parse, type Block } from "@/lib/markdown";
import s from "./page.module.css";

export const metadata: Metadata = {
  title: "Manifesto · Mandate",
  description: "Spend caps changed how much an agent can move. Mandate changes what it is allowed to do over time.",
};

const sentence = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** A paragraph that is one bold sentence and nothing else: the thesis, set as a pull quote. */
const isStatement = (b: Block) => b.kind === "p" && /^\*\*[^*]+\*\*$/.test(b.text);

/** A paragraph that opens with a bold label ("The weak point, stated here:") becomes a callout. */
function callout(text: string): "weak" | "test" | "label" | undefined {
  const m = /^\*\*([^*]+)\*\*/.exec(text);
  if (!m || isStatement({ kind: "p", text })) return undefined;
  const label = m[1]!.toLowerCase();
  if (label.includes("weak point")) return "weak";
  if (label.includes("test")) return "test";
  return "label";
}

export default function ManifestoPage() {
  const blocks = parse(PAPER);
  const title = blocks.find((b) => b.kind === "h1");
  const bylineAt = blocks.findIndex((b) => b.kind === "p");
  const byline = bylineAt >= 0 ? (blocks[bylineAt] as { text: string }).text : "";
  const body = blocks.filter((b, i) => b.kind !== "h1" && i !== bylineAt);
  const sections = body.flatMap((b) => (b.kind === "h2" ? [{ id: b.id, text: b.text }] : []));
  const minutes = Math.max(1, Math.round(PAPER.split(/\s+/).length / 230));

  return (
    <>
      <AppHeader />
      <main className={s.main}>
        <div className="atmosphere" aria-hidden />
        <header className={s.head}>
          <p className={s.kicker}>Manifesto</p>
          <h1 className="display">{title?.kind === "h1" ? sentence(title.text.replace(/^Mandate: /, "")) : "Mandate"}</h1>
          <p className={s.byline}>{inline(byline.replace(/^\*|\*$/g, ""))}</p>
          <p className={s.meta}>
            {minutes} min read ·{" "}
            <a href="https://github.com/Demiladepy/mandate/blob/main/docs/paper.md" target="_blank" rel="noreferrer">
              Read on GitHub
            </a>{" "}
            · <Link href="/trade">Try it</Link>
          </p>
        </header>

        <div className={s.layout}>
          <nav className={s.toc} aria-label="Contents">
            <p className={s.tocTitle}>Contents</p>
            <ol>
              {sections.map((h) => (
                <li key={h.id}>
                  <a href={`#${h.id}`}>{h.text}</a>
                </li>
              ))}
            </ol>
          </nav>

          <article className={s.article}>
            {body.map((b, i) => (
              <Render key={i} block={b} index={i} />
            ))}
          </article>
        </div>
      </main>
    </>
  );
}

function Render({ block: b, index }: { block: Block; index: number }) {
  const k = `b${index}`;
  switch (b.kind) {
    case "h1":
    case "h2":
      return (
        <h2 id={b.id} className={s.h2}>
          {inline(b.text, k)}
        </h2>
      );
    case "ul":
      return (
        <ul className={s.list}>
          {b.items.map((it, j) => (
            <li key={j}>{inline(it, `${k}-${j}`)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className={s.list}>
          {b.items.map((it, j) => (
            <li key={j}>{inline(it, `${k}-${j}`)}</li>
          ))}
        </ol>
      );
    case "table":
      return (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                {b.head.map((c, j) => (
                  <th key={j}>{inline(c, `${k}-h${j}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, j) => (
                <tr key={j}>
                  {r.map((c, m) => (
                    <td key={m}>{inline(c, `${k}-${j}-${m}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "p": {
      if (isStatement(b)) return <p className={s.statement}>{b.text.slice(2, -2)}</p>;
      const tone = callout(b.text);
      if (tone === "weak" || tone === "test") {
        return (
          <p className={s.callout} data-tone={tone}>
            {inline(b.text, k)}
          </p>
        );
      }
      return <p className={tone === "label" ? s.lead : s.p}>{inline(b.text, k)}</p>;
    }
  }
}

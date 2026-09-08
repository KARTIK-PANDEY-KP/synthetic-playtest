import { Fragment, type ReactNode } from "react";

/**
 * Small, dependency-free Markdown renderer for analyst answers and report.md:
 * headings, paragraphs, lists, tables, blockquotes, fenced code, hr, and inline
 * bold / italic / code / links. Not a full spec implementation — good enough for
 * LLM-written prose.
 */
export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  return <div className={`md ${className}`}>{renderBlocks(text)}</div>;
}

function renderBlocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const k = () => `b${key++}`;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // fenced code
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(<pre key={k()}><code>{buf.join("\n")}</code></pre>);
      continue;
    }
    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const content = inline(h[2]);
      out.push(level === 1 ? <h1 key={k()}>{content}</h1> : level === 2 ? <h2 key={k()}>{content}</h2> : <h3 key={k()}>{content}</h3>);
      i++;
      continue;
    }
    // hr
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push(<hr key={k()} />); i++; continue; }
    // table
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(splitRow(lines[i++]));
      out.push(
        <div key={k()} className="overflow-x-auto">
          <table>
            <thead><tr>{header.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    // blockquote
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(<blockquote key={k()}>{renderBlocks(buf.join("\n"))}</blockquote>);
      continue;
    }
    // lists
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const items: string[][] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (m && /\d/.test(m[2]) === ordered) { items.push([m[3]]); i++; continue; }
        // continuation line (indented or non-empty and not a new block)
        if (items.length && lines[i].trim() && /^\s{2,}/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) { items[items.length - 1].push(lines[i].trim()); i++; continue; }
        break;
      }
      const children = items.map((it, j) => <li key={j}>{inline(it.join(" "))}</li>);
      out.push(ordered ? <ol key={k()}>{children}</ol> : <ul key={k()}>{children}</ul>);
      continue;
    }
    // paragraph
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*>|\s*([-*+]|\d+[.)])\s+)/.test(lines[i]) && !(lines[i].includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]))) buf.push(lines[i++]);
    out.push(<p key={k()}>{inline(buf.join(" "))}</p>);
  }
  return out;
}

function splitRow(row: string): string[] {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;

function inline(text: string): ReactNode {
  const parts = text.split(INLINE);
  return parts.map((p, j) => {
    if (!p) return null;
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={j}>{inline(p.slice(2, -2))}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={j}>{p.slice(1, -1)}</code>;
    if ((p.startsWith("*") && p.endsWith("*")) || (p.startsWith("_") && p.endsWith("_"))) return <em key={j}>{inline(p.slice(1, -1))}</em>;
    const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return <a key={j} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    return <Fragment key={j}>{p}</Fragment>;
  });
}

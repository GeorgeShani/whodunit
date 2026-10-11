/**
 * The How to Play manual as structured content, parsed from docs/HOW_TO_PLAY.md (the single source of truth, written by
 * Agatha). Pure and isomorphic: lib/how-to-play.server.ts reads the file at build time; the client only ever receives
 * the parsed JSON below. Supports the markdown the manual uses: #/##/### headings, paragraphs, a paragraph that is all
 * bold (rendered as a sub-heading), - and 1. lists, pipe tables, **bold**, *italic* and `code`. The leading HTML
 * comment and the "Notes for Dexter" section (and anything after it) are not player copy and are dropped.
 */

export type Inline = { t: "text" | "strong" | "em" | "code"; v: string };
export type Block =
  | { type: "p"; text: Inline[] }
  | { type: "h"; text: Inline[] }
  | { type: "ul" | "ol"; items: Inline[][] }
  | { type: "table"; head: Inline[][]; rows: Inline[][][] };
export interface ManualSection {
  id: string;
  title: string;
  blocks: Block[];
}
export interface Manual {
  title: string;
  intro: Block[];
  sections: ManualSection[];
}

/** Headings (case-insensitive prefix) that end the player copy. */
const NOT_PLAYER_COPY = /^##\s+notes for\b/i;

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+?)\*\*|\*([^*\s][^*]*?)\*|`([^`]+)`/g;
  let at = 0;
  for (const m of s.matchAll(re)) {
    if (m.index > at) out.push({ t: "text", v: s.slice(at, m.index) });
    if (m[1] !== undefined) out.push({ t: "strong", v: m[1] });
    else if (m[2] !== undefined) out.push({ t: "em", v: m[2] });
    else out.push({ t: "code", v: m[3]! });
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ t: "text", v: s.slice(at) });
  return out;
}

export const plainText = (xs: readonly Inline[]): string => xs.map((x) => x.v).join("");

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => parseInline(c.trim()));

function blocksOf(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();
    if (!line || /^-{3,}$/.test(line)) {
      i++;
      continue;
    }
    if (/^#{3,6}\s/.test(line)) {
      blocks.push({ type: "h", text: parseInline(line.replace(/^#+\s+/, "")) });
      i++;
    } else if (line.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(lines[i++]!.trim());
      const body = rows.filter((r, k) => !(k === 1 && /^\|?[\s:|-]+\|?$/.test(r)));
      blocks.push({ type: "table", head: cells(body[0]!), rows: body.slice(1).map(cells) });
    } else if (/^([-*]|\d+\.)\s/.test(line)) {
      const ordered = /^\d+\.\s/.test(line);
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i]!)) {
        let item = lines[i++]!.trim().replace(/^([-*]|\d+\.)\s+/, "");
        // A wrapped list item continues on indented lines.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]!) && !/^\s*([-*]|\d+\.)\s/.test(lines[i]!)) item += ` ${lines[i++]!.trim()}`;
        items.push(parseInline(item));
      }
      blocks.push({ type: ordered ? "ol" : "ul", items });
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i]!.trim() && !/^(#|\||-{3,}$|([-*]|\d+\.)\s)/.test(lines[i]!.trim())) para.push(lines[i++]!.trim());
      const text = parseInline(para.join(" "));
      blocks.push(text.length === 1 && text[0]!.t === "strong" ? { type: "h", text: [{ t: "text", v: text[0]!.v }] } : { type: "p", text });
    }
  }
  return blocks;
}

/** Parse the manual. Throws when it has no title or no sections (a broken source must fail the build, not ship blank). */
export function parseManual(md: string): Manual {
  const noComments = md.replace(/<!--[\s\S]*?-->/g, "");
  const all = noComments.split(/\r?\n/);
  const end = all.findIndex((l) => NOT_PLAYER_COPY.test(l.trim()));
  const lines = end >= 0 ? all.slice(0, end) : all;
  const titleAt = lines.findIndex((l) => /^#\s/.test(l));
  if (titleAt < 0) throw new Error("HOW_TO_PLAY.md: missing a '# ' title");
  const title = lines[titleAt]!.replace(/^#\s+/, "").trim();
  const sections: ManualSection[] = [];
  let intro: string[] = [];
  let cur: { title: string; lines: string[] } | null = null;
  const flush = () => {
    if (cur) sections.push({ id: slugify(cur.title), title: cur.title, blocks: blocksOf(cur.lines) });
  };
  for (const l of lines.slice(titleAt + 1)) {
    if (/^##\s/.test(l)) {
      flush();
      cur = { title: l.replace(/^##\s+/, "").trim(), lines: [] };
    } else if (cur) cur.lines.push(l);
    else intro = [...intro, l];
  }
  flush();
  if (!sections.length) throw new Error("HOW_TO_PLAY.md: no '## ' sections");
  return { title, intro: blocksOf(intro), sections };
}

/** Every player-visible string of the manual (spoiler and contradiction checks). */
export function manualText(m: Manual): string {
  const b = (x: Block): string =>
    x.type === "p" || x.type === "h" ? plainText(x.text) : x.type === "table" ? [...x.head, ...x.rows.flat()].map(plainText).join(" | ") : x.items.map(plainText).join("\n");
  return [m.title, ...m.intro.map(b), ...m.sections.flatMap((s) => [s.title, ...s.blocks.map(b)])].join("\n");
}

/** The grading section ("How accusations are graded"): the accuse form's "How am I graded?" link opens it. */
export const GRADING_SECTION_ID = "how-accusations-are-graded";
/** No-JS / new-tab fallback for that link: the standalone page's anchor. */
export const GRADING_HREF = `/how-to-play#htp-${GRADING_SECTION_ID}`;

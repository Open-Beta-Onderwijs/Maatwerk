// SPDX-License-Identifier: AGPL-3.0-or-later

// Markdown in the AI's answers (user, 2026-11-20): the CLIs answer in Markdown. A small parser
// for what they use (headings, paragraphs, lists, quotes, code blocks, tables, rules; bold,
// italic, strikethrough, code and links inline) into a tree, then DOM nodes. Text only ever
// becomes text nodes, never HTML, so an answer cannot inject markup (dom.ts). A single newline
// is a line break (chat style; a plain-text Eigen CLI keeps its lines). Links are not followed
// (the editor is an iframe): their text shows, the address is the tooltip.

import { h } from './dom';

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'br' }
  | { t: 'code'; text: string }
  | { t: 'strong' | 'em' | 'del'; children: Inline[] }
  | { t: 'link'; href: string; children: Inline[] };

export type Block =
  | { t: 'p'; children: Inline[] }
  | { t: 'h'; level: number; children: Inline[] }
  | { t: 'code'; lang: string; text: string }
  | { t: 'quote'; children: Block[] }
  | { t: 'list'; ordered: boolean; start: number; items: Block[][] }
  | {
      t: 'table';
      align: ('left' | 'center' | 'right' | null)[];
      head: Inline[][];
      rows: Inline[][][];
    }
  | { t: 'hr' };

// ── Blocks ─────────────────────────────────────────────────────────────────

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const BULLET = /^( {0,3})([-*+])[ \t]+(.*)$/;
const ORDERED = /^( {0,3})(\d{1,9})[.)][ \t]+(.*)$/;
const TABLE_SEP = /^ {0,3}\|?(?:[ \t]*:?-+:?[ \t]*\|)*[ \t]*:?-+:?[ \t]*\|?[ \t]*$/;

const blank = (l: string) => l.trim() === '';

function listMarker(
  line: string,
): { ordered: boolean; num: number; text: string; indent: number } | null {
  const b = BULLET.exec(line);
  if (b && !HR.test(line)) return { ordered: false, num: 1, text: b[3]!, indent: b[1]!.length + 2 };
  const o = ORDERED.exec(line);
  if (o)
    return {
      ordered: true,
      num: Number(o[2]),
      text: o[3]!,
      indent: o[1]!.length + o[2]!.length + 2,
    };
  return null;
}

function cells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (s[i] === '|') {
      out.push(cur.trim());
      cur = '';
    } else cur += s[i];
  }
  out.push(cur.trim());
  return out;
}

/** Whether `line` starts a block other than a paragraph (ends a paragraph). */
function startsBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    QUOTE.test(line) ||
    listMarker(line) !== null ||
    (line.includes('|') && next !== undefined && TABLE_SEP.test(next) && next.includes('-'))
  );
}

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  return blocks(lines);
}

function blocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (blank(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[1]!;
      const body: string[] = [];
      i++;
      while (
        i < lines.length &&
        !new RegExp(`^ {0,3}${mark[0]}{${mark.length},}\\s*$`).test(lines[i]!)
      )
        body.push(lines[i++]!);
      i++; // the closing fence (or the end)
      out.push({ t: 'code', lang: fence[2] ?? '', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      out.push({ t: 'h', level: heading[1]!.length, children: parseInline(heading[2] ?? '') });
      i++;
      continue;
    }
    if (HR.test(line)) {
      out.push({ t: 'hr' });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && !blank(lines[i]!)) {
        const q = QUOTE.exec(lines[i]!);
        body.push(q ? q[1]! : lines[i]!);
        i++;
      }
      out.push({ t: 'quote', children: blocks(body) });
      continue;
    }
    const marker = listMarker(line);
    if (marker) {
      const items: Block[][] = [];
      const { ordered, num } = marker;
      while (i < lines.length) {
        const m = listMarker(lines[i]!);
        if (!m || m.ordered !== ordered) break;
        const body = [m.text];
        i++;
        // Continuation: indented lines (nested lists, more text), blank lines inside the item.
        while (i < lines.length) {
          const l = lines[i]!;
          if (blank(l)) {
            const nextIndented = i + 1 < lines.length && /^ {2,}\S/.test(lines[i + 1]!);
            if (!nextIndented) break;
            body.push('');
            i++;
            continue;
          }
          const indent = /^ */.exec(l)![0].length;
          if (indent >= Math.min(m.indent, 4) || (indent >= 2 && listMarker(l.slice(indent)))) {
            body.push(l.slice(Math.min(indent, m.indent)));
            i++;
            continue;
          }
          // A lazy continuation line of the item's paragraph.
          if (!startsBlock(l, lines[i + 1]) && !blank(body.at(-1)!)) {
            body.push(l);
            i++;
            continue;
          }
          break;
        }
        items.push(blocks(body));
        // Blank lines between items keep the list going.
        let j = i;
        while (j < lines.length && blank(lines[j]!)) j++;
        if (j > i && j < lines.length && listMarker(lines[j]!)?.ordered === ordered) i = j;
      }
      out.push({ t: 'list', ordered, start: num, items });
      continue;
    }
    const next = lines[i + 1];
    if (line.includes('|') && next !== undefined && TABLE_SEP.test(next) && next.includes('-')) {
      const head = cells(line);
      const align = cells(next).map((c) =>
        c.startsWith(':') && c.endsWith(':')
          ? ('center' as const)
          : c.endsWith(':')
            ? ('right' as const)
            : c.startsWith(':')
              ? ('left' as const)
              : null,
      );
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && !blank(lines[i]!) && lines[i]!.includes('|')) {
        const row = cells(lines[i++]!);
        rows.push(head.map((_, c) => parseInline(row[c] ?? '')));
      }
      out.push({ t: 'table', align, head: head.map((c) => parseInline(c)), rows });
      continue;
    }
    // A paragraph: up to a blank line or another block.
    const para = [line.trim()];
    i++;
    while (i < lines.length && !blank(lines[i]!) && !startsBlock(lines[i]!, lines[i + 1]))
      para.push(lines[i++]!.trim());
    out.push({ t: 'p', children: parseInline(para.join('\n')) });
  }
  return out;
}

// ── Inline ─────────────────────────────────────────────────────────────────

const PUNCT = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;
const WORD = /[\p{L}\p{N}]/u;

/** The closing delimiter `d` for an opener at `from`, or -1. */
function closing(s: string, d: string, from: number): number {
  for (let k = from; k < s.length; k++) {
    if (s[k] === '\\') {
      k++;
      continue;
    }
    if (s[k] === '`') {
      // Code spans bind tighter: skip them.
      const run = /^`+/.exec(s.slice(k))![0];
      const end = s.indexOf(run, k + run.length);
      if (end > 0) k = end + run.length - 1;
      continue;
    }
    if (s.startsWith(d, k) && k > from && !/\s/.test(s[k - 1]!)) {
      // `_` closes only at a word's end (snake_case stays text).
      if (d[0] === '_' && WORD.test(s[k + d.length] ?? '')) continue;
      // `***`: the double closer is the last two (`***x***` is strong around em).
      if (d.length === 2 && s[k + 2] === d[0]) continue;
      // `*` inside `**`: not the single closer.
      if (d === '*' && (s[k + 1] === '*' || s[k - 1] === '*')) continue;
      return k;
    }
  }
  return -1;
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ t: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '\\' && i + 1 < s.length && PUNCT.test(s[i + 1]!)) {
      text += s[i + 1];
      i += 2;
      continue;
    }
    if (c === '\n') {
      flush();
      out.push({ t: 'br' });
      i++;
      continue;
    }
    if (c === '`') {
      const run = /^`+/.exec(s.slice(i))![0];
      const end = s.indexOf(run, i + run.length);
      if (end > 0) {
        flush();
        let code = s.slice(i + run.length, end).replace(/\n/g, ' ');
        if (/^ .*\S.* $/.test(code)) code = code.slice(1, -1);
        out.push({ t: 'code', text: code });
        i = end + run.length;
        continue;
      }
      text += run;
      i += run.length;
      continue;
    }
    if (c === '[') {
      const m =
        /^\[([^\]]*)\]\(\s*<?([^\s<>()]*(?:\([^\s()]*\)[^\s<>()]*)*)>?(?:\s+"[^"]*")?\s*\)/.exec(
          s.slice(i),
        );
      if (m) {
        flush();
        out.push({ t: 'link', href: m[2]!, children: parseInline(m[1]!) });
        i += m[0].length;
        continue;
      }
    }
    const delims: [string, 'strong' | 'em' | 'del'][] = [
      ['**', 'strong'],
      ['__', 'strong'],
      ['~~', 'del'],
      ['*', 'em'],
      ['_', 'em'],
    ];
    let matched = false;
    for (const [d, t] of delims) {
      if (!s.startsWith(d, i)) continue;
      const after = s[i + d.length];
      if (after === undefined || /\s/.test(after)) continue;
      // `_` opens only at a word's start.
      if (d[0] === '_' && i > 0 && WORD.test(s[i - 1]!)) continue;
      const end = closing(s, d, i + d.length);
      if (end < 0) continue;
      flush();
      out.push({ t, children: parseInline(s.slice(i + d.length, end)) });
      i = end + d.length;
      matched = true;
      break;
    }
    if (matched) continue;
    text += c;
    i++;
  }
  flush();
  return out;
}

// ── DOM ────────────────────────────────────────────────────────────────────

function inlineNodes(nodes: Inline[]): (Node | string)[] {
  return nodes.map((n) => {
    switch (n.t) {
      case 'text':
        return n.text;
      case 'br':
        return h('br');
      case 'code':
        return h('code', {}, n.text);
      case 'link':
        return h('span', { class: 'ai-md-link', title: n.href }, ...inlineNodes(n.children));
      default:
        return h(n.t, {}, ...inlineNodes(n.children));
    }
  });
}

function blockNode(b: Block): HTMLElement {
  switch (b.t) {
    case 'p':
      return h('p', {}, ...inlineNodes(b.children));
    case 'h':
      // Headings in a chat bubble stay small: h4-h6 only (the panel has its own h3).
      return h(`h${Math.min(6, b.level + 3)}` as 'h4', {}, ...inlineNodes(b.children));
    case 'code':
      return h('pre', {}, h('code', b.lang ? { 'data-lang': b.lang } : {}, b.text));
    case 'quote':
      return h('blockquote', {}, ...b.children.map(blockNode));
    case 'hr':
      return h('hr');
    case 'list': {
      const items = b.items.map((item) => {
        // A one-paragraph item is "tight": no paragraph margins.
        if (item.length === 1 && item[0]!.t === 'p')
          return h('li', {}, ...inlineNodes(item[0]!.children));
        return h('li', {}, ...item.map(blockNode));
      });
      return b.ordered
        ? h('ol', b.start !== 1 ? { start: b.start } : {}, ...items)
        : h('ul', {}, ...items);
    }
    case 'table': {
      const cell = (tag: 'th' | 'td', c: Inline[], k: number) =>
        // A class, not a style attribute (the strict CSP).
        h(tag, b.align[k] ? { class: `is-${b.align[k]}` } : {}, ...inlineNodes(c));
      return h(
        'div',
        { class: 'ai-md-table' },
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, ...b.head.map((c, k) => cell('th', c, k)))),
          h('tbody', {}, ...b.rows.map((r) => h('tr', {}, ...r.map((c, k) => cell('td', c, k))))),
        ),
      );
    }
  }
}

/** The answer `text` as rendered Markdown in a `.ai-md` element. */
export function markdown(text: string): HTMLElement {
  return h('div', { class: 'ai-md' }, ...parseBlocks(text).map(blockNode));
}

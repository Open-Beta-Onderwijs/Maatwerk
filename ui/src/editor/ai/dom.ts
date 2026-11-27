// SPDX-License-Identifier: AGPL-3.0-or-later

// Small DOM helpers and the icons of the AI panel (boards 59-61). Text always goes in as text
// nodes: AI answers, file names and CLI output are never parsed as HTML.

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

/** `h('button', { class: 'x', onclick: fn, 'aria-label': 'y' }, 'text', child)` */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2), v);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  append(el, ...children);
  return el;
}

export function append(el: Element, ...children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
}

const SVG = 'http://www.w3.org/2000/svg';

/** Icon paths (viewBox 0 0 24 24, stroke currentColor). */
const PATHS = {
  check: ['m5 12 5 5 9-10'],
  plus: ['M12 5v14M5 12h14'],
  minus: ['M6 12h12'],
  x: ['M6 6l12 12M18 6 6 18'],
  warn: ['M12 3 2 21h20z', 'M12 10v5M12 18h.01'],
  key: ['M15 7a4 4 0 1 1-3.9 5H4v3h3v3h3v-3h1.1A4 4 0 0 1 15 7z'],
  clock: ['M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z'],
  stop: ['M7 7h10v10H7z'],
  info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5h.01'],
  pencil: ['M4 20h4L19 9l-4-4L4 16z'],
  swap: ['M4 7h12l-3-3M20 17H8l3 3'],
  chevronDown: ['m6 9 6 6 6-6'],
  chevronRight: ['m9 6 6 6-6 6'],
  spinner: ['M12 3a9 9 0 1 1-9 9'],
  paperclip: [
    'm21 11-8.6 8.6a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4L15.5 7',
  ],
  send: ['M5 12h14M13 6l6 6-6 6'],
  image: ['M3 4h18v16H3zM3 16l5-5 4 4 3-3 6 6'],
  file: ['M6 3h9l4 4v14H6zM9 12h7M9 16h7'],
  lock: [
    'M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z',
    'M8 11V8a4 4 0 0 1 8 0v3',
  ],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4'],
  upload: ['M12 15V4M7 9l5-5 5 5', 'M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4'],
  gear: [
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  ],
} as const;
export type IconName = keyof typeof PATHS;

/** An inline SVG icon (`aria-hidden`). */
export function icon(name: IconName, size = 16, stroke = 2): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(stroke));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ai-icon', `ai-icon-${name}`);
  for (const d of PATHS[name]) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

/**
 * Letters and colour per provider (decision 62, board 59). No vendor logos: letter buttons
 * (user, 2026-11-26).
 */
const MONOGRAMS: Record<string, [string, string]> = {
  claude: ['CC', '#c2540f'],
  codex: ['GPT', '#1f7045'],
  gemini: ['G', '#2560bf'],
  antigravity: ['AG', '#0f7f86'],
  vibe: ['V', '#c93636'],
  copilot: ['CP', '#7a33b0'],
};

export function monogram(key: string, name: string): { text: string; colour: string } {
  const m = MONOGRAMS[key];
  if (m) return { text: m[0], colour: m[1] };
  const text = name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2) || '?';
  return { text: text[0]!.toUpperCase() + text.slice(1).toLowerCase(), colour: '#5d6675' };
}

/** `el` shows the monogram of `key`: its letters, its colour, a smaller font for three. */
export function monogramEl<T extends HTMLElement>(el: T, key: string, name: string): T {
  const m = monogram(key, name);
  el.textContent = m.text;
  el.style.setProperty('--provider', m.colour);
  el.dataset.letters = String([...m.text].length);
  return el;
}

/** Copies text to the clipboard; false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

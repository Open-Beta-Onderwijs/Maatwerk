// SPDX-License-Identifier: AGPL-3.0-or-later

// The window draws emoji with the embedded Noto Color Emoji, the same font the PDFs use (one copy
// in the binary, served by the `maatwerk-out` scheme), so an observatie icon looks the same on
// screen and in the rapport, on every Windows build (quirk T2).
//
// Only for emoji code points (`unicode-range`), so text keeps its own font. Only where the webview
// can draw COLRv1 colour fonts (WebView2 on Windows): elsewhere (macOS, older WebKitGTK) the
// system emoji font stays, as before. The font family is first in the font stacks (tokens.css,
// editor.css); an unregistered family is simply skipped.

export const EMOJI_FAMILY = 'Maatwerk Emoji';

/**
 * Emoji code points, without the ones that are ordinary text in the UI too (digits, #, *, arrows,
 * ©, ®, ™): those keep the text font. Characters the font lacks fall through to the next font.
 */
export const EMOJI_UNICODE_RANGE = [
  'U+200D', // zero width joiner
  'U+20E3', // combining keycap
  'U+231A-23FF',
  'U+24C2',
  'U+25AA-25AB',
  'U+25B6',
  'U+25C0',
  'U+25FB-25FE',
  'U+2600-27BF',
  'U+2B1B-2B1C',
  'U+2B50',
  'U+2B55',
  'U+3030',
  'U+303D',
  'U+3297',
  'U+3299',
  'U+FE0F', // emoji presentation selector
  'U+1F000-1FAFF',
  'U+E0020-E007F', // tag sequences (flags of regions)
].join(', ');

/** Whether this webview can draw a COLRv1 colour font. */
export function supportsColrV1(): boolean {
  return typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
    ? CSS.supports('font-tech(color-COLRv1)')
    : false;
}

/**
 * Registers the font for `doc` (the main window or the editor frame); it loads on first use.
 * Returns whether it is used.
 */
export function registerEmojiFont(
  url: string | null | undefined,
  doc: Document = document,
): boolean {
  if (!url || !supportsColrV1() || typeof FontFace === 'undefined') return false;
  for (const face of doc.fonts) if (face.family.replace(/"/g, '') === EMOJI_FAMILY) return true;
  const face = new FontFace(EMOJI_FAMILY, `url("${url}")`, {
    unicodeRange: EMOJI_UNICODE_RANGE,
    display: 'swap',
  });
  doc.fonts.add(face);
  return true;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

// The install help (decision 72, board 62; step 32c) and the provider tile, shared by
// AI-instellingen in the main window and the "?" panel in the editor. Styles:
// styles/ai-install.css (tokens only, so both documents can load it).

import type { AiProvider, InstallHelp } from '../../bridge/ai-api';
import { copyText, h, monogramEl } from './dom';

/** Who makes each CLI. */
export const MAKER: Record<string, string> = {
  claude: 'Anthropic',
  codex: 'OpenAI',
  gemini: 'Google',
  antigravity: 'Google',
  vibe: 'Mistral AI',
  copilot: 'GitHub',
};

/** The install command for this computer (Windows or macOS/Linux). */
export function installCommand(help: InstallHelp, windows = /Windows/i.test(navigator.userAgent)) {
  return windows ? help.windows : help.unix;
}

/** The provider's tile: its monogram in its colour (logos: decision 62). */
export function logoTile(key: string, name: string, size: 'sm' | 'md' = 'md'): HTMLElement {
  const tile = h('span', { class: `ais-logo ais-logo--${size}`, 'aria-hidden': 'true' });
  return monogramEl(tile, key, name);
}

/** "Kopiëren" that says "Gekopieerd" for a moment. */
export function copyButton(text: string, cls = 'ais-copy', label = 'Kopiëren'): HTMLButtonElement {
  const b = h('button', { type: 'button', class: cls, 'aria-label': `${label}: ${text}` }, label);
  b.addEventListener('click', async () => {
    if (await copyText(text)) {
      b.textContent = 'Gekopieerd';
      setTimeout(() => (b.textContent = label), 1500);
    }
  });
  return b;
}

/** One card per built-in CLI with its install command, then the Node.js note. */
export function installList(providers: readonly AiProvider[]): HTMLElement {
  const list = h('div', { class: 'ais-install' });
  for (const p of providers) {
    if (!p.install || !p.builtin) continue;
    const cmd = installCommand(p.install);
    list.append(
      h(
        'div',
        { class: 'ais-install__card' },
        h(
          'div',
          { class: 'ais-install__head' },
          logoTile(p.key, p.name, 'sm'),
          h('strong', {}, p.name),
          h('span', { class: 'ais-muted' }, MAKER[p.builtin] ?? ''),
        ),
        h(
          'div',
          { class: 'ais-install__cmd' },
          h('code', { class: 'ais-mono', title: cmd }, cmd),
          copyButton(cmd),
        ),
        p.install.note ? h('span', { class: 'ais-hint' }, p.install.note) : null,
      ),
    );
  }
  list.append(
    h(
      'span',
      { class: 'ais-hint' },
      'De npm-opdrachten hebben Node.js nodig. Maatwerk installeert zelf niets.',
    ),
  );
  return list;
}

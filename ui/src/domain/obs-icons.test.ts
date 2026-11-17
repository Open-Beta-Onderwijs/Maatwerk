// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { ICON_CATEGORIES, ICON_COUNT, filterIcons } from './obs-icons';

/** The icons of the old picker (screens/observaties.js before step 30). */
const OLD = [
  '📏 📐 🔢 🧮 ➗ ➕ ➖ 📊 📈 📉 ✏️ 📝 📌 📎 🔖 📋 📓 📚 🗒️ 📖',
  '🔍 🔎 💡 💬 🎯 ✅ ❌ ⚠️ ❓ 🧠 ⚗️ 🧪 🧫 🧬 🔬 🔭 🌡️ ⚡ 🧲 💧',
  '🌱 🦠 🌿 🦋 🐚 🔄 🔗 🎲 ⏱️ 🚀',
]
  .join(' ')
  .split(' ');

const all = ICON_CATEGORIES.flatMap((c) => c.icons.map((i) => i.emoji));

describe('F-15: the observatie icons', () => {
  it('200+ icons in the six categories of the spec, each once', () => {
    expect(ICON_COUNT).toBeGreaterThanOrEqual(200);
    expect(ICON_CATEGORIES.map((c) => c.label)).toEqual([
      'Natuurkunde',
      'Scheikunde',
      'Biologie',
      'Wiskunde',
      'Leren & school',
      'Fouten & aandacht',
    ]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('every icon of the old list is still there', () => {
    expect(OLD.length).toBe(50);
    expect(OLD.filter((e) => !all.includes(e))).toEqual([]);
  });

  it('no ZWJ sequences (system emoji fonts draw them apart)', () => {
    expect(all.filter((e) => e.includes('‍'))).toEqual([]);
  });

  it('search: Dutch words, prefix per word, any category; a category narrows it', () => {
    const emojis = (cat: string, q: string) =>
      filterIcons(cat, q).flatMap((c) => c.icons.map((i) => i.emoji));
    expect(emojis('Alle', 'grafiek')).toEqual(['📈', '📉']);
    expect(emojis('Alle', 'lamp')).toContain('💡');
    expect(emojis('Alle', 'molecuul')).toEqual(['⚛️']);
    expect(emojis('Alle', 'grafiek dal')).toEqual(['📉']);
    expect(emojis('Wiskunde', 'lamp')).toEqual([]);
    expect(emojis('Biologie', '').length).toBeGreaterThan(30);
    // The category name counts as a search word.
    expect(emojis('Alle', 'scheikunde').length).toBe(
      ICON_CATEGORIES.find((c) => c.label === 'Scheikunde')!.icons.length,
    );
    expect(filterIcons('Alle', 'xyzzy')).toEqual([]);
  });
});

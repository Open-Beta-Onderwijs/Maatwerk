// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline, type Inline } from './markdown';

const text = (t: string): Inline => ({ t: 'text', text: t });

describe('inline Markdown', () => {
  it('bold, italic, strikethrough, code', () => {
    expect(parseInline('a **b** *c* ~~d~~ `e`')).toEqual([
      text('a '),
      { t: 'strong', children: [text('b')] },
      text(' '),
      { t: 'em', children: [text('c')] },
      text(' '),
      { t: 'del', children: [text('d')] },
      text(' '),
      { t: 'code', text: 'e' },
    ]);
    expect(parseInline('***x***')).toEqual([
      { t: 'strong', children: [{ t: 'em', children: [text('x')] }] },
    ]);
  });

  it('keeps snake_case, lone stars and unclosed markers as text', () => {
    expect(parseInline('opgave_punten en totaal_punten')).toEqual([
      text('opgave_punten en totaal_punten'),
    ]);
    expect(parseInline('2 * 3 = 6')).toEqual([text('2 * 3 = 6')]);
    expect(parseInline('**open')).toEqual([text('**open')]);
    expect(parseInline('a `b')).toEqual([text('a `b')]);
  });

  it('code spans win over emphasis; backslash escapes', () => {
    expect(parseInline('`*x*` \\*y\\*')).toEqual([{ t: 'code', text: '*x*' }, text(' *y*')]);
    expect(parseInline('``a ` b``')).toEqual([{ t: 'code', text: 'a ` b' }]);
  });

  it('links keep their address; newlines are line breaks', () => {
    expect(parseInline('[Typst](https://typst.app/docs)\nklaar')).toEqual([
      { t: 'link', href: 'https://typst.app/docs', children: [text('Typst')] },
      { t: 'br' },
      text('klaar'),
    ]);
  });

  it('never makes HTML: tags stay text', () => {
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([
      text('<img src=x onerror=alert(1)>'),
    ]);
  });
});

describe('block Markdown', () => {
  it('headings, paragraphs, rules', () => {
    expect(parseBlocks('# Titel\n\nEen\ntwee\n\n---\nDrie')).toEqual([
      { t: 'h', level: 1, children: [text('Titel')] },
      { t: 'p', children: [text('Een'), { t: 'br' }, text('twee')] },
      { t: 'hr' },
      { t: 'p', children: [text('Drie')] },
    ]);
  });

  it('fenced code keeps its text as is', () => {
    expect(parseBlocks('Zo:\n```typst\n#let x = *1*\n\n  y\n```\nKlaar')).toEqual([
      { t: 'p', children: [text('Zo:')] },
      { t: 'code', lang: 'typst', text: '#let x = *1*\n\n  y' },
      { t: 'p', children: [text('Klaar')] },
    ]);
    // An unclosed fence runs to the end (a stopped answer).
    expect(parseBlocks('```\na')).toEqual([{ t: 'code', lang: '', text: 'a' }]);
  });

  it('lists: bullets, numbers with their start, nesting, loose items', () => {
    expect(parseBlocks('- een\n- **twee**\n  - twee a\n- drie')).toEqual([
      {
        t: 'list',
        ordered: false,
        start: 1,
        items: [
          [{ t: 'p', children: [text('een')] }],
          [
            { t: 'p', children: [{ t: 'strong', children: [text('twee')] }] },
            {
              t: 'list',
              ordered: false,
              start: 1,
              items: [[{ t: 'p', children: [text('twee a')] }]],
            },
          ],
          [{ t: 'p', children: [text('drie')] }],
        ],
      },
    ]);
    const ordered = parseBlocks('3. a\n\n4. b\n\nNa');
    expect(ordered).toEqual([
      {
        t: 'list',
        ordered: true,
        start: 3,
        items: [[{ t: 'p', children: [text('a')] }], [{ t: 'p', children: [text('b')] }]],
      },
      { t: 'p', children: [text('Na')] },
    ]);
  });

  it('a paragraph followed by a list without a blank line', () => {
    expect(parseBlocks('Wijzigingen:\n- a\n- b').map((b) => b.t)).toEqual(['p', 'list']);
  });

  it('quotes and tables', () => {
    expect(parseBlocks('> let op\n> echt')).toEqual([
      {
        t: 'quote',
        children: [{ t: 'p', children: [text('let op'), { t: 'br' }, text('echt')] }],
      },
    ]);
    expect(parseBlocks('| Vraag | Punten |\n|:--|--:|\n| 1a | 2 |\n| 1b |')).toEqual([
      {
        t: 'table',
        align: ['left', 'right'],
        head: [[text('Vraag')], [text('Punten')]],
        rows: [
          [[text('1a')], [text('2')]],
          [[text('1b')], []],
        ],
      },
    ]);
  });

  it('a line with a pipe but no separator stays a paragraph', () => {
    expect(parseBlocks('a | b')).toEqual([{ t: 'p', children: [text('a | b')] }]);
  });
});

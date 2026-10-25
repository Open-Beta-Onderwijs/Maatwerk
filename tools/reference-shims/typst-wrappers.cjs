// SPDX-License-Identifier: AGPL-3.0-or-later
// Typst wrapper builders of `_reference/main.js` (rapport and opdracht wrappers).
// Blocks between @verbatim and @end are copied unchanged from the reference app at
// commit 0e30a70 (docs/reference/VERSION.md); the rest is glue.
// Do not edit by hand: regenerate with `node tests/reference-harness/make-shims.mjs`.
/* eslint-disable */
// rapportWrapper(students, examInfo): the body of app:renderRapportPdf that builds
// the wrapper source (main.js:557-583), returned instead of written to temp/.
function rapportWrapper(students, examInfo) {
// @verbatim main.js:557-583
  // Recursively serialize a JS value to a Typst literal.
  function toTypst(val) {
    if (val === null || val === undefined) return 'none';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'number') return isFinite(val) ? String(val) : '0';
    if (typeof val === 'string') {
      return '"' + val.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }
    if (Array.isArray(val)) {
      if (val.length === 0) return '()';
      return '(' + val.map(toTypst).join(', ') + ',)';
    }
    if (typeof val === 'object') {
      const pairs = Object.entries(val).map(([k, v]) => `${k}: ${toTypst(v)}`);
      return '(' + pairs.join(', ') + ')';
    }
    return '"' + String(val) + '"';
  }

  // The wrapper imports setup + render, applies heading styles via #show: setup,
  // then calls render with the injected data.
  const wrapperContent =
    `#import "rtti_export.typ": setup, render\n\n` +
    `#let exam_info = ${toTypst(examInfo ?? {})}\n` +
    `#let student_data = ${toTypst(students ?? [])}\n\n` +
    `#show: setup\n` +
    `#render(exam_info, student_data)\n`;
// @end
  return { wrapperContent, toTypst };
}

// @verbatim main.js:604-687
// Draws an invisible link at the position of the <__rtti_cursor> metadata marker
// on each page, so the renderer can locate the editor cursor in the SVG output.
const CURSOR_FOREGROUND =
  `#set page(foreground: context {\n` +
  `  for m in query(<__rtti_cursor>).filter(m => m.location().page() == here().page()) {\n` +
  `    let p = m.location().position()\n` +
  `    place(top + left, dx: p.x, dy: p.y, link("rtti-cursor:")[#box(width: 1pt, height: 1em)])\n` +
  `  }\n` +
  `})\n`;

const typStr = (s) =>
  '"' +
  String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"') +
  '"';

// Header shown in the editor (preview and PDF), where no real student is involved.
// The observatie name is long on purpose, so authors see how a two-line header looks.
function placeholderHeader(title) {
  return {
    title,
    student: 'Leerling Voornaam Achternaam',
    group: 'Klas Z vak W',
    exam: 'Voorbeeldtoets Toetsweek X',
    observaties: [
      {
        icon: '❌',
        name: 'Een voorbeeldobservatie met een behoorlijk lange naam, zodat deze twee regels beslaat in het voorbeeld',
      },
    ],
  };
}

// Build the wrapper .typ that renders an opdracht.
// importPath: absolute Typst path (resolved against --root appDir) of the opdracht file.
// header: { title, student, group, exam, observaties: [{ icon, name }] }
// mode: 'student' (header + uitleg + opgaven [+ upside-down answers]) | 'answers' (answer key only)
// The opdracht file defines setup_extra(), render_uitleg() and render_opgaven(); the
// answers are collected by lib.typ from the #vraag markers in the document.
function buildAssignmentWrapper(
  importPath,
  header,
  { cursorMarker = false, includeAnswers = true, mode = 'student' } = {}
) {
  const imports =
    `#import "/data/opdrachten/lib.typ": setup, opdracht_header, antwoorden_header, ` +
    `antwoorden_lijst, antwoorden_omgekeerd\n` +
    `#import "${importPath}": setup_extra, render_uitleg, render_opgaven\n\n` +
    `#show: setup\n` +
    (cursorMarker ? CURSOR_FOREGROUND : '') +
    `#setup_extra()\n\n`;

  if (mode === 'answers') {
    return (
      imports +
      `#antwoorden_header(title: ${typStr(header.title)})\n\n` +
      // The answers come from the vraag markers, so the content is laid out
      // invisibly (taking no space) for them to exist in this document.
      `#place(hide[#render_uitleg() #render_opgaven()])\n` +
      `#antwoorden_lijst()\n`
    );
  }

  const obs = (header.observaties ?? [])
    .map((o) => `(icon: ${typStr(o.icon)}, name: ${typStr(o.name)}),`)
    .join(' ');

  return (
    imports +
    `#opdracht_header(\n` +
    `  title: ${typStr(header.title)},\n` +
    `  student: ${typStr(header.student)},\n` +
    `  group: ${typStr(header.group)},\n` +
    `  exam_prefix: "N.a.v.",\n` +
    `  exam: ${typStr(header.exam)},\n` +
    `  observaties: (${obs}),\n` +
    `)\n\n` +
    `#render_uitleg()\n\n` +
    `#pagebreak()\n\n` +
    `#render_opgaven()\n` +
    (includeAnswers ? `#antwoorden_omgekeerd()\n` : '')
  );
}
// @end

module.exports = { rapportWrapper, typStr, placeholderHeader, buildAssignmentWrapper, CURSOR_FOREGROUND };

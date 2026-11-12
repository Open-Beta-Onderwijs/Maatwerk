// SPDX-License-Identifier: AGPL-3.0-or-later
// rapport-po.typ — the PO rapport (step 24; design spec 4.13 "PO rapport", boards 19 and 20,
// PLAN-2 decision 26). The toets rapport's look: page setup, footer, watermark, headings,
// section labels, zebra tables and the lollipop scale all come from rapport.typ. No RTTI parts,
// no histogram.
// Entry point: rapport-po-main.typ reads data.json and calls  #render_po(po_info, students)
// po_info : (name, subject_display, scale_max: the largest category max)
// students: array of (
//   name, student_nr, klas, grade (string), grade_overridden (bool),
//   grade_only (bool: an overwritten grade without scores: no tables, no category pages),
//   points, max, pct (whole percent or none), rubric_grade (string or none),
//   group_size, projectgroep: (naam, members: array of (name, klas)), the student first,
//   categories: array of (
//     name, soort ("normaal", "bonus" or "diagnostisch"), max, score (or none),
//     avg, avg_pct, dot_color, levels: array of (min, max, title, text),
//     comment, observaties
//   ),
//   total: (avg, avg_pct),
//   lines: array of (voor ("Projectgroep" or "Persoonlijk"), label, value (number), text),
//   comment, observaties (general),
// )
// An observatie: (icon, naam, uitleg, leeradvies (markup, guarded by the UI)).
// Every number is calculated in the core (crates/maatwerk-grades); this template only draws it.

#import "rapport.typ": (
  setup, section_label, zebra_stroke, zebra_fill, scale_track, lollipop_track, student_start,
  student_end, _num, _dots, _guard_markup, _eval_scope, TRACK_W, TRACK_H,
)

#let BLUE = rgb("#1a5276")
#let MUTED = rgb("#9aa0ab")
#let MINUS = rgb("#b42318")
#let PLUS = rgb("#2e7d32")

#let _soort_tag(soort) = if soort == "bonus" { "bonus" } else if soort == "diagnostisch" { "diagnostisch" } else { none }
#let _bd(soort) = if soort == "bonus" { "B" } else if soort == "diagnostisch" { "D" } else { "" }
#let _score_str(c) = (if c.score == none { "—" } else { _num(c.score) }) + " / " + _num(c.max)

// ── Page 1: the overview ───────────────────────────────────────────────────────

// One sentence with points, percentage, group grade and the final grade (bold).
#let _summary(s) = {
  let group = s.group_size > 1
  let has = voor => s.lines.any(l => l.voor == voor)
  let group_lines = has("Projectgroep")
  let own_lines = has("Persoonlijk")
  if not s.grade_only {
    let pts = _num(s.points) + " / " + _num(s.max)
    if group [Jullie hebben #pts punten behaald] else [Je hebt #pts punten behaald]
    if s.pct != none { if group [ en hadden dus #s.pct% goed. ] else [ en had dus #s.pct% goed. ] } else [. ]
  }
  if s.rubric_grade != none and (group_lines or own_lines) {
    if group [De beoordeling van het groepswerk is een #s.rubric_grade. ] else [De beoordeling van je werk is een #s.rubric_grade. ]
    if group_lines and own_lines [Met bonus en malus voor de groep en je persoonlijke bonus en malus wordt je cijfer een *#s.grade*.]
    else if group_lines [Met bonus en malus voor de groep wordt je cijfer een *#s.grade*.]
    else [Met je persoonlijke bonus en malus wordt je cijfer een *#s.grade*.]
  } else [Je cijfer is een *#s.grade*.]
  if s.grade_overridden [ Dit cijfer is met de hand overschreven door de docent.]
}

#let _projectgroep(s) = {
  let pg = s.projectgroep
  if pg == none or pg.members.len() < 2 { return }
  v(10pt)
  section_label[Projectgroep #pg.naam]
  v(0pt)
  pg.members.map(m => m.name + " (" + m.klas + ")").join(", ", last: " en ")
}

#let _score_table(s, scale_max, dots) = {
  v(10pt)
  section_label[Scoretabel]
  {
    set text(size: 9pt)
    let special = c => c.soort != "normaal"
    let cell = (c, body) => if special(c) { text(fill: MUTED, style: "italic", body) } else { body }
    table(
      columns: (2.8cm, 1.2cm, 1.4cm, TRACK_W * 1cm + 1cm, 2.6cm),
      align: left + horizon,
      stroke: zebra_stroke,
      fill: zebra_fill,
      // 1pt: a category name on two lines does not touch the rows around it.
      inset: (x: 4pt, y: 1pt),
      [*Categorie*], [*B / D*], [*Jij (●)*], scale_track(scale_max, dots), [*Gemiddeld (◇)*],
      ..s.categories.map(c => (
        cell(c, c.name),
        cell(c, _bd(c.soort)),
        cell(c, _score_str(c)),
        lollipop_track(
          (score: c.score, max: c.max, class_avg: c.avg, dot_color: c.dot_color, rtti_color: none),
          scale_max,
          dots,
        ),
        cell(c, _num(c.avg) + " / " + _num(c.max) + " (" + str(c.avg_pct) + "%)"),
      )).flatten(),
      [*Totaal*], [], [*#_num(s.points) / #_num(s.max)*], box(height: TRACK_H * 1cm),
      [#_num(s.total.avg) / #_num(s.max) (#s.total.avg_pct%)],
    )
  }
  let notes = ()
  if s.categories.any(c => c.soort == "bonus") { notes.push("B = bonus: telt mee in de punten, niet in het maximum.") }
  if s.categories.any(c => c.soort == "diagnostisch") { notes.push("D = diagnostisch: telt niet mee in het cijfer.") }
  notes.push("Gemiddeld = alle leerlingen met deze PO.")
  text(8pt, fill: gray.darken(20%), notes.join(" "))
}

#let _lines_table(s) = {
  if s.lines.len() == 0 { return }
  v(10pt)
  section_label[Bonus / malus]
  set text(size: 9pt)
  table(
    columns: (3cm, 1fr, 2cm),
    align: (left + horizon, left + horizon, right + horizon),
    stroke: zebra_stroke,
    fill: zebra_fill,
    inset: (x: 4pt, y: 4pt),
    [*Voor*], [*Omschrijving*], [*Cijfer*],
    ..s.lines.map(l => (
      [#l.voor],
      if l.label == "" { text(fill: MUTED, style: "italic")[Zonder omschrijving] } else [#l.label],
      text(weight: "bold", fill: if l.value < 0 { MINUS } else { PLUS }, l.text),
    )).flatten(),
  )
}

#let _comment(s) = {
  if s.comment == "" { return }
  v(10pt)
  section_label[Opmerking van de docent]
  v(0pt)
  s.comment
}

// ── Pages 2 and on: the categories ─────────────────────────────────────────────

#let _obs(o) = grid(
  columns: (0.7cm, 1fr),
  row-gutter: 0pt,
  text(size: 12pt, o.icon),
  {
    [*#o.naam*]
    if o.uitleg != none and o.uitleg != "" [ — #o.uitleg]
    if o.leeradvies != "" {
      linebreak()
      section_label[Leeradvies:]
      [ ]
      eval(_guard_markup(o.leeradvies), mode: "markup", scope: _eval_scope)
    }
  },
)

#let _obs_list(list) = for o in list {
  v(4pt)
  _obs(o)
}

#let _block_heading(left, right) = block(
  width: 100%,
  below: 5pt,
  stroke: (bottom: 0.5pt + gray),
  inset: (bottom: 2pt),
  grid(columns: (1fr, auto), left, right),
)

#let _level(l, score) = {
  let on = score != none and l.min != none and l.max != none and l.min <= score and score <= l.max
  let range = if l.min == none or l.max == none { "—" } else if l.min == l.max { _num(l.min) } else { _num(l.min) + "–" + _num(l.max) }
  grid.cell(
    inset: (x: 5pt, y: 4pt),
    stroke: if on { 1.2pt + BLUE } else { 0.5pt + gray.lighten(30%) },
    fill: if on { BLUE.lighten(92%) } else { white },
    {
      text(weight: "bold", fill: if on { BLUE } else { gray.darken(20%) }, range)
      if l.title != none and l.title != "" [ *#l.title*]
      linebreak()
      text(size: 8.5pt, fill: if on { black } else { gray.darken(40%) }, l.text)
    },
  )
}

#let _category(c) = block(breakable: false, below: 14pt, {
  set text(size: 9.5pt)
  let tag = _soort_tag(c.soort)
  _block_heading(
    {
      text(size: 11pt, weight: "bold", c.name)
      if tag != none { h(6pt); text(style: "italic", fill: BLUE, tag) }
    },
    text(size: 11pt, weight: "bold", _score_str(c)),
  )
  if c.levels.len() > 0 {
    grid(
      columns: (1fr,) * c.levels.len(),
      column-gutter: 4pt,
      ..c.levels.map(l => _level(l, c.score)),
    )
  }
  if c.comment != "" {
    v(4pt)
    section_label[Opmerking:]
    [ #c.comment]
  }
  _obs_list(c.observaties)
})

#let _categories(s) = {
  section_label[Beoordeling per categorie]
  v(2pt)
  for c in s.categories { _category(c) }
  if s.observaties.len() > 0 {
    block(breakable: false, {
      set text(size: 9.5pt)
      _block_heading(text(size: 11pt, weight: "bold")[Algemene observaties], [])
      _obs_list(s.observaties)
    })
  }
}

// ── Render ─────────────────────────────────────────────────────────────────────
#let render_po(po_info, students) = {
  let n = students.len()
  let dots = _dots(false) // whole points only (decision 16)
  for (i, s) in students.enumerate() {
    student_start(i, po_info.subject_display + " " + po_info.name + " \u{2014} " + s.name)
    [= Beoordeling #po_info.subject_display #po_info.name
    == #s.klas — #s.name (#s.student_nr)

    #v(8pt)
    ]
    _summary(s)
    _projectgroep(s)
    if not s.grade_only { _score_table(s, po_info.scale_max, dots) }
    _lines_table(s)
    _comment(s)
    if not s.grade_only and s.categories.len() > 0 {
      pagebreak()
      _categories(s)
    }
    student_end(i, n)
  }
}

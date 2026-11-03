// SPDX-License-Identifier: AGPL-3.0-or-later
// maatwerk-main 1
// main.typ: entry point of an opdracht (ADR-0002 5a). It lays out the teacher's opdracht.typ with
// lib.typ, as the generated wrapper of the old app did. Maatwerk passes the student header and
// the mode as JSON in `sys.inputs` ("maatwerk-data"). Without it (plain `typst compile main.typ`
// in the opdracht folder) the placeholder header and student mode are used.
#import "lib.typ": setup, opdracht_header, antwoorden_header, antwoorden_lijst, antwoorden_omgekeerd
#import "opdracht.typ": setup_extra, render_uitleg, render_opgaven

#let _placeholder = (
  // "student" or "answers" (the answer key).
  mode: "student",
  // Student mode: the answers upside down at the bottom.
  include_answers: true,
  // Live preview: draw a `maatwerk-cursor:` link where `<__maatwerk_cursor>` is.
  cursor: false,
  header: (
    title: "Titel",
    student: "Leerling Voornaam Achternaam",
    group: "Klas Z vak W",
    exam: "Voorbeeldtoets Toetsweek X",
    observaties: (
      (
        icon: "❌",
        name: "Een voorbeeldobservatie met een behoorlijk lange naam, zodat deze twee regels beslaat in het voorbeeld",
      ),
    ),
  ),
)
#let _input = json(bytes(sys.inputs.at("maatwerk-data", default: "{}")))
#let data = _placeholder + _input
#let header = _placeholder.header + _input.at("header", default: (:))

#show: setup
#show: body => if data.cursor {
  set page(foreground: context {
    for m in query(<__maatwerk_cursor>).filter(m => m.location().page() == here().page()) {
      let p = m.location().position()
      place(top + left, dx: p.x, dy: p.y, link("maatwerk-cursor:")[#box(width: 1pt, height: 1em)])
    }
  })
  body
} else {
  body
}
#setup_extra()

#if data.mode == "answers" [
  #antwoorden_header(title: header.title)

  #place(hide[#render_uitleg() #render_opgaven()])
  #antwoorden_lijst()
] else [
  #opdracht_header(
    title: header.title,
    student: header.student,
    group: header.group,
    exam_prefix: "N.a.v.",
    exam: header.exam,
    observaties: header.observaties,
  )

  #render_uitleg()

  #pagebreak()

  #render_opgaven()
  #if data.include_answers { antwoorden_omgekeerd() }
]

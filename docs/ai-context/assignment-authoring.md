# Writing a Maatwerk opdracht (context for an author or an AI model)

Self-contained: this file is all you need to write or fix an opdracht. Full format reference:
`docs/assignment-format.md`. Examples that compile cleanly: `docs/assignment-examples/`.

## 1. What an opdracht is

A Dutch secondary-school teacher gives a student a short remedial assignment ("opdracht") after
an exam: an explanation ("uitleg") and exercises ("opgaven") made of questions ("vragen"), each
with points ("punten") and an answer ("antwoord"). It is written in **Typst 0.14** and printed per
student; the answers are printed upside down at the bottom, and there is a separate answer key.

One opdracht is one folder. **You edit only `opdracht.typ`** (and may add images to `images/`):

```text
main.typ       entry point; page setup, student header, answer-key mode. Do not edit.
lib.typ        helper library (API below). Do not edit.
opdracht.typ   your file
images/        figures, referenced as image("images/<name>")
```

Nothing outside the folder can be read. Never put student names, grades or other personal data in
an opdracht: the student header is filled in by the app when it prints.

## 2. Skeleton of `opdracht.typ`

```typst
#import "lib.typ": *

// Extra set/show rules on top of the standard layout. Usually empty.
#let setup_extra() = []

// The explanation: theory, examples, formulas, context.
#let render_uitleg() = [
  = Onderwerp
  Uitleg ...
]

// The exercises.
#let render_opgaven() = [
  #opgave(titel: "Titel")[
    Inleidende tekst.
    #vraag(punten: 2, antwoord: [Het antwoord.])[De vraag.]
  ]
]
```

All three functions must exist, with these names, and return content. `main.typ` prints the
header, then `render_uitleg()`, a page break, then `render_opgaven()`. Do not add a page break
between them yourself, and do not call `setup`, the header or answer functions.

## 3. `lib.typ` API (`#import "lib.typ": *`)

| Call                                          | What it makes                                                                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#opgave(titel: none)[body]`                  | Grey numbered block "Opgave 1 (titel)". May break across pages. Holds text, grids, figures and `#vraag`s. Can carry a label: `#opgave[...] <naam>`. |
| `#vraag(punten: none, antwoord: none)[vraag]` | One question: letter in the margin, points right ("2p", "1,5p"). `punten`: a number (int or float). `antwoord`: content.                            |
| `#voorbeeld_blok(name: none)[body]`           | Blue block "Voorbeeld 1 (name)".                                                                                                                    |
| `#formule_blok(name: none)[body]`             | Yellow block "Formule 1 (name)".                                                                                                                    |
| `#context_blok(name: none)[body]`             | Green block "Context 1 (name)".                                                                                                                     |
| `#belangrijk_blok[body]`                      | Red "Belangrijk!" block, not numbered.                                                                                                              |
| `#num[1.5]`                                   | A number with a decimal comma (1,5) and digit grouping (`@preview/zero`). Also `quan`, `set-num` from zero.                                         |

The blocks are figures: label them (`#voorbeeld_blok[...] <vb-fiets>`) and refer with `@vb-fiets`
("Voorbeeld 1"). Headings: `=` (14 pt) and `==` (12 pt), not numbered.

Layout set by `lib.typ`: A4, margin 1.5 cm, Source Serif 4 10.5 pt, justified, `lang: "nl"`, math
in STIX Two Math, table captions above the table, other captions below.

Available packages (embedded, nothing is downloaded): `@preview/zero:0.7.1` (imported by
lib.typ), `@preview/cetz:0.3.4` (drawings), `@preview/oxifmt:0.2.1`, `@preview/unify:0.8.0`.
Import them with exactly these versions. Any other package fails.

## 4. Rules

1. **Language:** Dutch text. `lang: "nl"` is set; do not change it (it makes references read
   "Figuur 1", "Tabel 1").
2. **Decimal comma:** in running text write `1,5`. In math and in numbers that need grouping use
   `#num[1.5]` (`$v = #num[1.5]$ m/s`). Do not write `1,5` inside `$...$`: Typst treats the comma
   as punctuation and adds a space.
3. **Vragen:** every `#vraag` is inside an `#opgave`, has `punten:` and a non-empty `antwoord:`.
   Never number or letter questions yourself: the letters a, b, c are automatic, and left out
   when an opgave has one vraag. Answer labels are "1", "2a", "2b" on the key.
4. **Points:** numbers, usually whole or halves (`punten: 1.5` prints "1,5p"). The total is the
   sum of all punten.
5. **Answers** are content: text, math (`antwoord: [$x = 4$]`), short. They are printed in a list
   (and upside down for the student), so no figures or long tables in an answer.
6. **Labels** are unique in the whole opdracht, start with a letter, and use only `a-z`, `0-9`,
   `-` (e.g. `<fig-kring>`, `<tab-dichtheid>`). A reference to a label used twice is an error
   ("label `<x>` occurs multiple times in the document").
7. **Figures** always have a caption and a label:

   ```typst
   #figure(
     image("images/stroomkring.png", width: 60%),
     caption: [Een batterij, een lampje en een schakelaar in serie.],
   ) <fig-kring>
   ```

   Refer to them in the text with `@fig-kring`, not "de figuur hieronder". Tables likewise:
   `#figure(table(...), caption: [...]) <tab-...>`.

8. **Images:** only files in `images/` of the folder (PNG, JPEG, GIF, WebP, SVG), referenced as
   `"images/<name>"`. No URLs, no paths outside the folder.
9. **Fonts:** do not set fonts. Emoji work (Noto Color Emoji is embedded).
10. **No new helpers in lib.typ.** Small local helpers go in `opdracht.typ` with `#let`.
11. **`setup_extra()`** is for document-wide rules only (e.g.
    `#set math.equation(numbering: "(1)")`); it must return content (`[]` when empty).

## 5. Checks (what the editor shows, what `check` reports)

- Typst **errors** (the opdracht does not compile) and **warnings** (e.g. a character no font can
  draw), each with file, line and column.
- The vragen checks, exactly these Dutch messages:
  - `De opdracht heeft geen vragen.`
  - `Vraag 2a heeft geen punten.` / `Een vraag buiten een opgave heeft geen punten.`
  - `Vraag 2a heeft geen antwoord.`
  - `Een vraag buiten een opgave staat niet in een #opgave.`
  - `De punten zijn onbekend: lib.typ van deze opdracht is een oudere versie.` (only for an old
    `lib.typ`; not your file's fault)

An opdracht is done when it compiles with **no errors, no warnings and no checks**.

## 6. Compile, check, fix

```text
maatwerk-cli assignment check <opdracht folder> --json
```

Exit code 0 when it compiles. JSON (schema `maatwerk-assignment-check/1`):

```json
{
  "ok": true,
  "entry": "main.typ",
  "mode": "student",
  "pageCount": 2,
  "diagnostics": [
    {
      "severity": "error|warning",
      "message": "...",
      "hints": [],
      "location": { "file": "opdracht.typ", "line": 3, "column": 26, "range": [70, 78] },
      "trace": []
    }
  ],
  "vragen": [{ "opgave": 1, "label": "1a", "punten": 2.0, "antwoord": "...", "page": 2 }],
  "totalPunten": 5.0,
  "checks": ["Vraag 1b heeft geen antwoord."]
}
```

`range` is the UTF-8 byte range in `location.file`. An error inside `lib.typ` or `main.typ`
usually comes from a wrong call in `opdracht.typ`: look at `trace` for the place in your file.
Repeat edit, check, fix until `ok` is true and `diagnostics` and `checks` are empty.
`maatwerk-cli assignment render <folder> --pdf out.pdf` writes the PDF (`--answers` for the key).

## 7. A complete example

```typst
#import "lib.typ": *

#let setup_extra() = []

#let render_uitleg() = [
  = Snelheid

  De gemiddelde snelheid is de afstand gedeeld door de tijd.

  #formule_blok(name: "Gemiddelde snelheid")[
    $ v_"gem" = s / t $
    met $s$ de afstand in m, $t$ de tijd in s en $v_"gem"$ de snelheid in m/s.
  ]

  #voorbeeld_blok(name: "Fietsen")[
    Je fietst #num[3000] m in #num[600] s: $v_"gem" = 3000 / 600 = 5$ m/s.
  ]
]

#let render_opgaven() = [
  #opgave(titel: "Naar school")[
    Sanne loopt #num[1.2] km naar school. Ze doet er 15 minuten over.

    #vraag(punten: 1, antwoord: [#num[1200] m en #num[900] s.])[
      Reken de afstand om naar meter en de tijd naar seconde.
    ]
    #vraag(punten: 2, antwoord: [$v_"gem" = 1200 / 900 = #num[1.3]$ m/s.])[
      Bereken de gemiddelde snelheid van Sanne in m/s.
    ]
  ]

  #opgave(titel: "Trein")[
    #vraag(punten: 1.5, antwoord: [$s = v dot t = 40 dot 120 = #num[4800]$ m.])[
      Een trein rijdt 2 minuten met 40 m/s. Bereken de afstand.
    ]
  ]
]
```

More in `docs/assignment-examples/`: `02-figuur.typ` (image, caption, `@label`), `03-tabel.typ`
(table figure, `#num`), `04-context-en-grid.typ` (context and belangrijk blocks, vragen in a
grid), `05-wiskunde.typ` (math, `setup_extra` rule).

#import "lib.typ": *

#let setup_extra() = []

#let render_uitleg() = [
  #formule_blok(name: [Snelheid])[$v = s / t$]
  #belangrijk_blok[Let op de eenheden: #quan("3.5 m/s").]
]

#let render_opgaven() = [
  #opgave(titel: "Opgave met een figuur")[
    #grid(columns: (3fr, 2fr), gutter: 1em,
      [
        Tekst naast de figuur.

        #vraag(punten: 1, antwoord: [Het antwoord.])[De vraag in een grid.]
      ],
      rect(width: 100%, height: 3cm, stroke: luma(160))[#align(center + horizon)[Figuur]],
    )
  ]
  #opgave(titel: "Vraag in een figuur")[
    #figure(kind: "voorbeeld", supplement: "Voorbeeld", caption: [In een figuur])[
      #vraag(punten: 2, antwoord: [#num[1234.5]])[Schrijf als getal.]
    ]
    #vraag(antwoord: none)[Vraag zonder punten en zonder antwoord.]
  ]
]

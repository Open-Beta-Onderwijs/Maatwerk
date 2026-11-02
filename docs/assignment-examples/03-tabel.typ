// Voorbeeld 3: een tabel als figuur (onderschrift boven de tabel), getallen met #num zodat ze
// een decimale komma krijgen, en een vraag die naar de tabel verwijst.
#import "lib.typ": *

#let setup_extra() = []

#let render_uitleg() = [
  = Dichtheid

  De dichtheid van een stof is de massa per volume-eenheid: $rho = m / V$.

  #figure(
    table(
      columns: 2,
      align: (left, right),
      table.header([*Stof*], [*Dichtheid (g/cm³)*]),
      [Water], [#num[1.00]],
      [Aluminium], [#num[2.70]],
      [IJzer], [#num[7.87]],
    ),
    caption: [Dichtheid van enkele stoffen bij kamertemperatuur.],
  ) <dichtheden>
]

#let render_opgaven() = [
  #opgave(titel: "Een blokje metaal")[
    Een blokje heeft een volume van #num[10.0] cm³ en een massa van #num[27.0] g.

    #vraag(punten: 2, antwoord: [$rho = #num[27.0] / #num[10.0] = #num[2.70]$ g/cm³.])[
      Bereken de dichtheid van het blokje.
    ]
    #vraag(punten: 1, antwoord: [Aluminium (@dichtheden).])[
      Van welke stof is het blokje gemaakt? Gebruik @dichtheden.
    ]
  ]
]

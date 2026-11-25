#import "lib.typ": *

#let setup_extra() = []

#let render_uitleg() = [
  #voorbeeld_blok(name: [Remweg])[Een auto remt af.] <vb>
  #context_blok[Context zonder naam.]
  #figure(table(columns: 2, [Grootheid], [Eenheid], [$v$], [m/s]), caption: [Eenheden.]) <tab>
  Zie @vb, @tab en @opg-twee. Een vraag buiten een opgave:
  #vraag(punten: 1, antwoord: [Buiten.])[Losse vraag.]
]

#let render_opgaven() = [
  #opgave(titel: "Eén vraag")[
    #vraag(punten: 1.5, antwoord: [#quan("3.5 m/s")])[Enige vraag, zonder letter.]
  ]
  #opgave(titel: "Over de paginagrens")[
    #lorem(500)

    #vraag(punten: 2, antwoord: [A.])[Na de grens.]
    #vraag(punten: 2)[Zonder antwoord.]
  ] <opg-twee>
]

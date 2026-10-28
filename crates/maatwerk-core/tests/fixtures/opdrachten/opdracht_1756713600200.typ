#import "lib.typ": *

#let setup_extra() = []

#let render_uitleg() = [
  Uitleg met drie figuren.

  #figure(image("images/opdracht_1756713600200/figuur.png", width: 60%), caption: [Een PNG.]) <fig-png>
  #figure(image("images/opdracht_1756713600200/foto.jpg", width: 40%), caption: [Een JPG.])
  #figure(image("images/opdracht_1756713600200/schema.svg", width: 50%), caption: [Een SVG.])
]

#let render_opgaven() = [
  #opgave(titel: "Figuren")[
    Zie @fig-png.

    #vraag(punten: 2, antwoord: [Een rechte lijn.])[Wat zie je in de figuur?]
    #vraag(punten: 1.5, antwoord: [$v = s / t$])[Geef de formule.]
  ]
]

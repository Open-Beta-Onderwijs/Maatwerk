#import "lib.typ": *

#let setup_extra() = []

#let render_uitleg() = [
  Plaats hier de uitleg...
]

#let render_opgaven() = [
  #opgave(titel: "Oefening")[
    #vraag(punten: 2, antwoord: [Antwoord a.])[Eerste vraag.]
    #vraag(punten: 1, antwoord: [Antwoord b.])[Tweede vraag.]
  ]
]

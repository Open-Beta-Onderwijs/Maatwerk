// Voorbeeld 2: een afbeelding uit de map images/ als figuur met onderschrift en label, en een
// verwijzing ernaar met @label ("Figuur 1").
#import "lib.typ": *

#let setup_extra(body) = body

#let render_uitleg() = [
  = Een eenvoudige stroomkring

  In @kring zie je een batterij, een lampje en een schakelaar in serie. Is de schakelaar dicht,
  dan loopt er stroom en brandt het lampje.

  #figure(
    image("images/stroomkring.svg", width: 60%),
    caption: [Een batterij, een lampje en een schakelaar in serie.],
  ) <kring>
]

#let render_opgaven() = [
  #opgave(titel: "Schakelaar")[
    Bekijk @kring.

    #vraag(punten: 1, antwoord: [Het lampje gaat uit: de kring is niet meer gesloten.])[
      Wat gebeurt er met het lampje als je de schakelaar opent?
    ]
    #vraag(punten: 2, antwoord: [Beide lampjes branden zwakker; de stroom is kleiner.])[
      Je zet een tweede lampje in serie met het eerste. Leg uit wat er met de felheid gebeurt.
    ]
  ]
]

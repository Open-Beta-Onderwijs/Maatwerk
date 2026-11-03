// Voorbeeld 4: een contextblok, een belangrijk-blok en een opgave in twee kolommen met een
// grid. Vragen mogen overal in een opgave staan, ook in een grid.
#import "lib.typ": *

#let setup_extra(body) = body

#let render_uitleg() = [
  = Fotosynthese

  #context_blok(name: "Kas")[
    Een tuinder kweekt tomaten in een kas. Hij kan de temperatuur, het licht en de hoeveelheid
    koolstofdioxide in de kas regelen.
  ]

  Bij fotosynthese maakt een plant glucose en zuurstof uit koolstofdioxide en water, met
  energie uit licht.

  #belangrijk_blok[
    Fotosynthese gebeurt alleen in cellen met bladgroenkorrels, en alleen bij licht.
  ]
]

#let render_opgaven() = [
  #opgave(titel: "In de kas")[
    #grid(
      columns: (1fr, 1fr),
      gutter: 1em,
      [
        #vraag(punten: 1, antwoord: [Koolstofdioxide en water.])[
          Noem de twee stoffen die een plant nodig heeft voor fotosynthese.
        ]
      ],
      [
        #vraag(punten: 1, antwoord: [Glucose en zuurstof.])[
          Noem de twee stoffen die bij fotosynthese ontstaan.
        ]
      ],
    )

    De tuinder laat 's nachts de lampen in de kas branden.

    #vraag(punten: 2, antwoord: [Ja: met licht gaat de fotosynthese ook 's nachts door, dus
      maakt de plant meer glucose.])[
      Leg uit of dit de groei van de tomaten kan versnellen.
    ]
  ]
]

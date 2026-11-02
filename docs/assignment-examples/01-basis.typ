// Voorbeeld 1: de basis. Uitleg met een voorbeeld- en formuleblok, twee opgaven, elke vraag
// met punten en een antwoord.
#import "lib.typ": *

#let setup_extra() = []

#let render_uitleg() = [
  = Snelheid

  De gemiddelde snelheid is de afstand die je aflegt gedeeld door de tijd die je daarvoor nodig
  hebt.

  #formule_blok(name: "Gemiddelde snelheid")[
    $ v_"gem" = s / t $
    met $s$ de afstand in m, $t$ de tijd in s en $v_"gem"$ de snelheid in m/s.
  ]

  #voorbeeld_blok(name: "Fietsen")[
    Je fietst #num[3000] m in #num[600] s. Je gemiddelde snelheid is
    $v_"gem" = 3000 / 600 = 5$ m/s.
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
      Een trein rijdt 2 minuten met een snelheid van 40 m/s. Bereken de afstand.
    ]
  ]
]

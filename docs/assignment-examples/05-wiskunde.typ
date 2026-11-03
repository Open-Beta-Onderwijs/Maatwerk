// Voorbeeld 5: wiskunde. Formules als Typst-math, een antwoord met een formule, en een eigen
// stijlregel voor de hele opdracht (genummerde vergelijkingen) in setup_extra.
#import "lib.typ": *

#let setup_extra(body) = {
  set math.equation(numbering: "(1)")
  body
}

#let render_uitleg() = [
  = Lineaire vergelijkingen

  Een lineaire vergelijking los je op door aan beide kanten hetzelfde te doen.

  #voorbeeld_blok[
    $ 3x + 4 = 19 => 3x = 15 => x = 5 $
  ]
]

#let render_opgaven() = [
  #opgave(titel: "Oplossen")[
    Los de vergelijkingen op.

    #vraag(punten: 1, antwoord: [$x = 4$])[$2x - 3 = 5$]
    #vraag(punten: 2, antwoord: [$x = -2$])[$5x + 7 = 3x + 3$]
    #vraag(punten: 2, antwoord: [$x = 1 / 2$])[$4(x + 1) = 6$]
  ]

  #opgave(titel: "Een formule opstellen")[
    Een taxi rekent €4 instaptarief en €2 per kilometer.

    #vraag(punten: 1, antwoord: [$K = 4 + 2a$, met $a$ het aantal km.])[
      Stel een formule op voor de kosten $K$ in euro bij een rit van $a$ km.
    ]
    #vraag(punten: 2, antwoord: [$4 + 2a = 30$, dus $a = 13$ km.])[
      Een rit kost €30. Hoeveel kilometer was de rit?
    ]
  ]
]

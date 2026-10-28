// SPDX-License-Identifier: AGPL-3.0-or-later
// Entry point of the rapport World (ADR-0002 section 5). Replaces the reference's generated
// wrapper `temp/_rapport_run.typ`: the data comes from a virtual JSON file instead of Typst
// source literals (`toTypst`), so there is nothing to escape.
#import "rapport.typ": setup, render

#let data = json("data.json")

#show: setup
#render(data.exam_info, data.students)

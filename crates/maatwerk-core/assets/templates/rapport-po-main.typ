// SPDX-License-Identifier: AGPL-3.0-or-later
// Entry point of the PO rapport World (step 24): as rapport-main.typ, for rapport-po.typ.
#import "rapport.typ": setup
#import "rapport-po.typ": render_po

#let data = json("data.json")

#show: setup.with(watermark: data.at("watermark", default: true))
#render_po(data.po_info, data.students)

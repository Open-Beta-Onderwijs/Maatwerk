Maatwerk: bestanden voor een opdracht in een andere editor
==========================================================

Deze map is gemaakt met `maatwerk-cli assignment export-lib`. Er staat in:

  lib.typ, main.typ   de standaardversies die Maatwerk in elke opdrachtmap zet
  opdracht.typ        de startversie van een nieuwe opdracht
  packages/           de Typst-pakketten die Maatwerk ingebouwd heeft (zero, cetz, oxifmt, unify)
  fonts/              de lettertypen van de opdrachten (Source Serif 4, STIX Two Math, Noto Color Emoji)

Maatwerk downloadt nooit pakketten. Met deze map ziet een andere editor dezelfde pakketten en
lettertypen als Maatwerk, zodat een opdracht er daar hetzelfde uitziet.

Typst-opdrachtregel (in een opdrachtmap, met <map> = deze map):

  typst compile --font-path <map>/fonts --package-path <map>/packages main.typ

Tinymist (VS Code), in settings.json:

  "tinymist.fontPaths": ["<map>/fonts"],
  "tinymist.typstExtraArgs": ["--package-path", "<map>/packages"]

Controleren zoals de editor van Maatwerk dat doet (fouten, aantal pagina's, vragen, punten):

  maatwerk-cli assignment check <opdrachtmap> [--json]

Licenties: de pakketten hebben elk hun eigen LICENSE-bestand in packages/; de lettertypen vallen
onder de SIL Open Font License 1.1 (zie THIRD_PARTY_LICENSES.md van Maatwerk).

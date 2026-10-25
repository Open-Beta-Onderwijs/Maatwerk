# Data file schemas (drafts)

Draft JSON Schemas (draft 2020-12) for every JSON file type the reference app keeps, written in
Step 1 from reading the reference code (`_reference/`, see
[../reference/VERSION.md](../reference/VERSION.md)). They describe what the reference app
writes and accepts; they are **drafts**, not yet checked against real data. The prose spec,
with `file:line` sources, is [../reference/data-files.md](../reference/data-files.md).

| Schema                      | File                                                                |
| --------------------------- | ------------------------------------------------------------------- |
| `config.schema.json`        | `data/config.json`                                                  |
| `gebruikers.schema.json`    | `data/gebruikers.json`                                              |
| `school.schema.json`        | `data/school.json`                                                  |
| `presence.schema.json`      | `data/users/<userId>.json`                                          |
| `observatie.schema.json`    | `data/observaties/<obsId>.json`                                     |
| `opdracht.schema.json`      | `data/opdrachten/<opdrachtId>.json`                                 |
| `rtti-template.schema.json` | `data/templates/RTTI explanations and advices/rtti_expl_adv_*.json` |
| `students.schema.json`      | `data/<year>/students-<year>.json`                                  |
| `exam.schema.json`          | `data/<year>/exams/<examId>.json`                                   |
| `group.schema.json`         | `data/<year>/groups/<groupId>.json`                                 |
| `scores.schema.json`        | `data/<year>/scores/<subject>/<studentId>.json`                     |
| `session.schema.json`       | `<userData>/session.json` (machine-local, not in `data/`)           |

Notes:

- Top-level objects allow unknown properties (the reference app spreads objects and keeps
  fields it does not know); nested shapes that the app fully controls (`_meta`, presence,
  overrides) are closed with `additionalProperties: false`.
- Union types are used where the reference data really is mixed (student ids as number or
  string, score values `number | null | string`).
- `samples/` holds synthetic samples only (names such as "Leerling Een", school
  "Voorbeeldschool"); no real data. `exam` has two samples (`exam`, `exam-resit`).

## Validation

ajv 8.20.0, ajv-formats 3.0.1, ajv-cli 5.0.0, installed in a throwaway folder outside the repo
(`npm init -y; npm i ajv ajv-formats ajv-cli`). Run from `docs/schemas/` (Git Bash), with `$AJV`
= that folder's `node_modules/.bin/ajv`:

```sh
for f in *.schema.json; do
  t=${f%.schema.json}
  "$AJV" validate --spec=draft2020 -c ajv-formats --strict=true --allow-union-types \
    --all-errors -s "$f" -d "samples/$t*.sample.json"
done
```

Result (2026-10-25): all 13 samples `valid`, all 12 schemas compile in strict mode
(`--allow-union-types` is needed because of the union types above).

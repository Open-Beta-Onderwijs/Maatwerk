#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Fails when a tracked source file lacks the SPDX header in its first 3 lines.
# Exempt: vendored Typst packages (their own licences, THIRD_PARTY_LICENSES.md) and
# base_assignment.typ, which becomes the start of a teacher's own opdracht file, and the
# generated opdracht fixtures (teacher files, tools/fixtures/export-opdrachten.mjs).
set -euo pipefail

missing=0
while IFS= read -r file; do
  case "$file" in
    crates/maatwerk-core/assets/packages/* | crates/maatwerk-core/assets/templates/base_assignment.typ | crates/maatwerk-core/tests/fixtures/*) continue ;;
  esac
  if ! head -n 3 "$file" | grep -q 'SPDX-License-Identifier: AGPL-3.0-or-later'; then
    echo "missing SPDX header: $file"
    missing=1
  fi
done < <(git ls-files '*.rs' '*.ts' '*.js' '*.mjs' '*.cjs' '*.css' '*.html' '*.sh' '*.typ')

exit "$missing"

#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Fails when a tracked source file lacks the SPDX header in its first 3 lines.
set -euo pipefail

missing=0
while IFS= read -r file; do
  if ! head -n 3 "$file" | grep -q 'SPDX-License-Identifier: AGPL-3.0-or-later'; then
    echo "missing SPDX header: $file"
    missing=1
  fi
done < <(git ls-files '*.rs' '*.ts' '*.js' '*.mjs' '*.css' '*.html' '*.sh' '*.typ')

exit "$missing"

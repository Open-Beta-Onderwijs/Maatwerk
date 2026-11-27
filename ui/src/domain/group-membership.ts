// SPDX-License-Identifier: AGPL-3.0-or-later

// Removing a student with scores from a group asks first (edit-locks.md 2.2): the scores stay,
// and who may edit them follows the group. Not a lock.

/** The students that leave a group in this save and have data in the year. */
export function removedWithData(
  changes: readonly { before: readonly string[]; after: readonly string[] }[],
  withData: ReadonlySet<string>,
): string[] {
  const out = new Set<string>();
  for (const { before, after } of changes) {
    const kept = new Set(after.map(String));
    for (const id of before.map(String)) if (!kept.has(id) && withData.has(id)) out.add(id);
  }
  return [...out];
}

/** The confirm text; at most five names, then "en N anderen". */
export function removeWithDataText(names: readonly string[]): string {
  const shown = names.slice(0, 5).join(', ');
  const more = names.length - 5;
  const who = more > 0 ? `${shown} en ${more === 1 ? '1 ander' : `${more} anderen`}` : shown;
  const lead =
    names.length === 1
      ? 'Deze leerling heeft scores'
      : `Deze ${names.length} leerlingen hebben scores`;
  return `${lead} en gaat uit de groep: ${who}. De scores blijven bewaard; wie ze mag bewerken, volgt de groep. Doorgaan?`;
}

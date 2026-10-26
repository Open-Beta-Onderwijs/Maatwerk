// SPDX-License-Identifier: AGPL-3.0-or-later
// Compare-and-swap writes and _meta stamping of the renderer Store (`_reference/renderer/store.js`).
// Blocks between @verbatim and @end are copied unchanged from the reference app at
// commit 0e30a70 (docs/reference/VERSION.md); the rest is glue.
// Do not edit by hand: regenerate with `node tests/reference-harness/make-shims.mjs`.
/* eslint-disable */
// `rtti` is the bridge (here: { readJsonVersioned, writeJson } from main-storage).
function createStoreCas({ rtti, activeUser = null }) {
  const window = { rtti };
  let _activeUser = activeUser;
// @verbatim renderer/store.js:60-123
  const writeQueues = {};

  // Run fn after all earlier queued work on relPath (own writes, external refreshes).
  function serialize(relPath, fn) {
    const queued = (writeQueues[relPath] ?? Promise.resolve()).then(fn, fn);
    writeQueues[relPath] = queued.catch(() => {});
    return queued;
  }

  function update(relPath, mutator, fallback = () => null) {
    const run = async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const read = await window.rtti.readJsonVersioned(relPath);
        if (read?.error) throw new Error(`Bestand ${relPath} is onleesbaar: ${read.error}`);
        const next = mutator(read.data ?? fallback(), read.data);
        const result = await window.rtti.writeJson(relPath, next, {
          cas: true,
          expectedHash: read.hash,
        });
        if (result?.ok) return next;
        if (result?.reason !== 'conflict') {
          throw new Error(`Save failed for ${relPath}: ${result?.reason}`);
        }
      }
      throw new Error(`Save failed for ${relPath}: conflict`);
    };
    return serialize(relPath, run);
  }

  // Version info stored in single-object files (exams, groups, observaties, opdrachten).
  function stampMeta(obj, onDisk) {
    const now = new Date().toISOString();
    const userId = _activeUser?.id ?? null;
    const prev = onDisk?._meta;
    obj._meta = {
      rev: (prev?.rev ?? 0) + 1,
      createdBy: onDisk ? (prev?.createdBy ?? null) : userId,
      createdAt: onDisk ? (prev?.createdAt ?? null) : now,
      updatedBy: userId,
      updatedAt: now,
    };
    return obj;
  }

  // Thrown when saving an object someone else saved after it was loaded here.
  // err.updatedBy holds the other user's id (if known). Handled globally in app.js.
  function conflictError(meta) {
    const err = new Error('conflict');
    err.code = 'conflict';
    err.updatedBy = meta?.updatedBy ?? null;
    return err;
  }

  // Save a single-object file. baseRev is the _meta.rev of the version the edit
  // started from; if the file on disk has moved on since, nothing is written.
  // force: overwrite regardless (deliberate replacements such as a CSV import).
  function saveEntity(relPath, entity, baseRev, { force = false } = {}) {
    return update(relPath, (_current, onDisk) => {
      if (!force && onDisk && (onDisk._meta?.rev ?? 0) !== (baseRev ?? 0)) {
        throw conflictError(onDisk._meta);
      }
      return stampMeta({ ...entity }, onDisk);
    });
  }
// @end
  return { update, saveEntity, stampMeta, setActiveUser: (u) => (_activeUser = u) };
}

module.exports = { createStoreCas };

// SPDX-License-Identifier: AGPL-3.0-or-later
// Executable storage and sync spec of the reference app, run against the
// verbatim shims in this folder. One test per row of docs/specs/storage-spec.md
// (ids S01...). The Rust storage layer (Step 4) must pass the same table.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { mock, test } from 'node:test';

const require = createRequire(import.meta.url);
const sync = require('./sync.cjs');
const { createMainStorage } = require('./main-storage.cjs');
const { createStoreCas } = require('./store-cas.cjs');

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const pretty = (data) => JSON.stringify(data, null, 2);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'maatwerk-spec-'));
}
function withDir(fn) {
  return async () => {
    const dir = tmpDir();
    try {
      await fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}
const put = (dir, rel, text) => {
  const abs = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return abs;
};
const read = (dir, rel) => fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8');
const exists = (dir, rel) => fs.existsSync(path.join(dir, ...rel.split('/')));
const ageFile = (abs, ms) => {
  const t = (Date.now() - ms) / 1000;
  fs.utimesSync(abs, t, t);
};
function quiet(fn) {
  const err = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = err;
  }
}
function bridge(m) {
  return {
    readJsonVersioned: (p) => m.invoke('fs:readJsonVersioned', p),
    writeJson: (p, data, opts) => m.invoke('fs:writeJson', p, data, opts),
  };
}

/** Makes fs.renameSync fail with `code` for the first `times` calls. */
function failRename(code, times) {
  const real = fs.renameSync;
  let calls = 0;
  fs.renameSync = (...args) => {
    calls++;
    if (calls <= times) throw Object.assign(new Error(code), { code });
    return real(...args);
  };
  return {
    get calls() {
      return calls;
    },
    restore: () => (fs.renameSync = real),
  };
}

// ── Atomic write (sync.js writeFileAtomic) ───────────────────────────────────

test(
  'S01 atomic write: content lands, no temp file left',
  withDir((dir) => {
    const f = path.join(dir, 'a.json');
    sync.writeFileAtomic(f, 'hallo');
    assert.equal(fs.readFileSync(f, 'utf8'), 'hallo');
    assert.deepEqual(fs.readdirSync(dir), ['a.json']);
  }),
);

test(
  'S02 atomic write creates missing parent folders',
  withDir((dir) => {
    sync.writeFileAtomic(path.join(dir, 'x', 'y', 'a.json'), '1');
    assert.equal(read(dir, 'x/y/a.json'), '1');
  }),
);

test(
  'S03 atomic write retries a rename that fails with EPERM/EBUSY/EACCES',
  withDir((dir) => {
    for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
      const f = path.join(dir, `${code}.json`);
      const r = failRename(code, 2);
      try {
        sync.writeFileAtomic(f, code);
      } finally {
        r.restore();
      }
      assert.equal(r.calls, 3);
      assert.equal(fs.readFileSync(f, 'utf8'), code);
    }
    assert.ok(fs.readdirSync(dir).every((n) => !n.endsWith('.tmp')));
  }),
);

test(
  'S04 after 6 failed renames it removes the temp file and writes directly',
  withDir((dir) => {
    const f = path.join(dir, 'a.json');
    fs.writeFileSync(f, 'old');
    const r = failRename('EBUSY', 100);
    try {
      sync.writeFileAtomic(f, 'new');
    } finally {
      r.restore();
    }
    assert.equal(r.calls, 6);
    assert.equal(fs.readFileSync(f, 'utf8'), 'new');
    assert.deepEqual(fs.readdirSync(dir), ['a.json']);
  }),
);

test(
  'S05 any other rename error falls back to a direct write at once',
  withDir((dir) => {
    const f = path.join(dir, 'a.json');
    const r = failRename('EXDEV', 100);
    try {
      sync.writeFileAtomic(f, 'x');
    } finally {
      r.restore();
    }
    assert.equal(r.calls, 1);
    assert.equal(fs.readFileSync(f, 'utf8'), 'x');
  }),
);

test(
  'S06 the temp file is <target>.<pid>.tmp next to the target',
  withDir((dir) => {
    const f = path.join(dir, 'a.json');
    const seen = [];
    const real = fs.renameSync;
    fs.renameSync = (from, to) => {
      seen.push([path.basename(from), path.basename(to)]);
      return real(from, to);
    };
    try {
      sync.writeFileAtomic(f, 'x');
    } finally {
      fs.renameSync = real;
    }
    assert.deepEqual(seen, [[`a.json.${process.pid}.tmp`, 'a.json']]);
  }),
);

test(
  'S07 hashContent is SHA-1 hex of the bytes; readWithHash: null when missing, throws otherwise',
  withDir((dir) => {
    assert.equal(sync.hashContent('abc'), sha1('abc'));
    assert.equal(sync.hashContent(Buffer.from('abc')), sha1('abc'));
    assert.equal(sync.readWithHash(path.join(dir, 'nope.json')), null);
    const f = put(dir, 'a.json', 'é');
    const r = sync.readWithHash(f);
    assert.equal(r.hash, sha1(Buffer.from('é')));
    assert.equal(r.buf.toString('utf8'), 'é');
    fs.mkdirSync(path.join(dir, 'd'));
    assert.throws(() => sync.readWithHash(path.join(dir, 'd')));
  }),
);

// ── IPC handlers (main.js) ───────────────────────────────────────────────────

test(
  'S08 fs:readJson: missing -> null, corrupt -> null, valid -> parsed',
  withDir(async (dir) => {
    const m = createMainStorage({ dataDir: dir });
    assert.equal(await m.invoke('fs:readJson', 'nope.json'), null);
    put(dir, 'bad.json', '{"a":');
    assert.equal(await quiet(() => m.invoke('fs:readJson', 'bad.json')), null);
    put(dir, 'ok.json', '{"a":[1,2]}');
    assert.deepEqual(await m.invoke('fs:readJson', 'ok.json'), { a: [1, 2] });
  }),
);

test(
  'S09 fs:readJsonVersioned: missing -> nulls, corrupt -> {error}, valid -> {data, hash}',
  withDir(async (dir) => {
    const m = createMainStorage({ dataDir: dir });
    assert.deepEqual(await m.invoke('fs:readJsonVersioned', 'nope.json'), {
      data: null,
      hash: null,
    });
    put(dir, 'bad.json', '{');
    const bad = await quiet(() => m.invoke('fs:readJsonVersioned', 'bad.json'));
    assert.deepEqual(Object.keys(bad), ['error']);
    put(dir, 'ok.json', '{ "a": 1 }');
    assert.deepEqual(await m.invoke('fs:readJsonVersioned', 'ok.json'), {
      data: { a: 1 },
      hash: sha1('{ "a": 1 }'),
    });
  }),
);

test(
  'S10 fs:writeJson writes JSON.stringify(data, null, 2) without trailing newline and returns its hash',
  withDir(async (dir) => {
    const m = createMainStorage({ dataDir: dir });
    const data = { b: 1, a: [1, { c: 'é' }], n: null };
    const r = await m.invoke('fs:writeJson', 'sub/x.json', data);
    assert.equal(read(dir, 'sub/x.json'), pretty(data));
    assert.deepEqual(r, { ok: true, hash: sha1(pretty(data)) });
    assert.equal(exists(dir, 'sub/x.json.lock'), false);
  }),
);

test(
  'S11 CAS: matching expectedHash writes; a different one gives conflict and leaves the file',
  withDir(async (dir) => {
    const m = createMainStorage({ dataDir: dir });
    const { hash } = await m.invoke('fs:writeJson', 'a.json', { v: 1 });
    assert.equal(
      (await m.invoke('fs:writeJson', 'a.json', { v: 2 }, { cas: true, expectedHash: hash })).ok,
      true,
    );
    const r = await m.invoke('fs:writeJson', 'a.json', { v: 3 }, { cas: true, expectedHash: hash });
    assert.deepEqual(r, { ok: false, reason: 'conflict' });
    assert.deepEqual(JSON.parse(read(dir, 'a.json')), { v: 2 });
  }),
);

test(
  'S12 CAS with expectedHash null/absent means "must not exist yet"',
  withDir(async (dir) => {
    const m = createMainStorage({ dataDir: dir });
    assert.equal(
      (await m.invoke('fs:writeJson', 'a.json', 1, { cas: true, expectedHash: null })).ok,
      true,
    );
    assert.deepEqual(await m.invoke('fs:writeJson', 'a.json', 2, { cas: true }), {
      ok: false,
      reason: 'conflict',
    });
    assert.deepEqual(
      await m.invoke('fs:writeJson', 'a.json', 2, { cas: true, expectedHash: null }),
      { ok: false, reason: 'conflict' },
    );
    assert.equal(read(dir, 'a.json'), '1');
  }),
);

test(
  'S13 a fresh .lock (< 10 s) blocks writes and deletes of non-score files with reason locked',
  withDir(async (dir) => {
    const m = createMainStorage({ dataDir: dir });
    put(dir, 'exams/a.json', '"old"');
    put(dir, 'exams/a.json.lock', String(Date.now()));
    assert.deepEqual(await m.invoke('fs:writeJson', 'exams/a.json', 'new'), {
      ok: false,
      reason: 'locked',
    });
    assert.deepEqual(await m.invoke('fs:deleteFile', 'exams/a.json'), {
      ok: false,
      reason: 'locked',
    });
    assert.equal(read(dir, 'exams/a.json'), '"old"');
    assert.equal(exists(dir, 'exams/a.json.lock'), true, 'foreign lock is left alone');
  }),
);

test(
  'S14 a stale .lock (mtime >= 10 s ago) is removed and the write goes ahead',
  withDir(async (dir) => {
    const m = createMainStorage({ dataDir: dir });
    ageFile(put(dir, 'a.json.lock', 'x'), m.LOCK_TTL_MS + 1000);
    assert.equal((await m.invoke('fs:writeJson', 'a.json', 1)).ok, true);
    assert.equal(exists(dir, 'a.json.lock'), false);
  }),
);

test(
  'S15 the lock is released after the write, also after a CAS conflict or a write error',
  withDir(async (dir) => {
    const m = createMainStorage({ dataDir: dir });
    await m.invoke('fs:writeJson', 'a.json', 1);
    await m.invoke('fs:writeJson', 'a.json', 2, { cas: true, expectedHash: 'x' });
    fs.mkdirSync(path.join(dir, 'd.json'));
    const r = await m.invoke('fs:writeJson', 'd.json', 3);
    assert.equal(r.ok, false);
    assert.equal(typeof r.reason, 'string');
    assert.deepEqual(
      fs.readdirSync(dir).filter((n) => n.endsWith('.lock')),
      [],
    );
  }),
);

test(
  'S16 score files (relPath contains "/scores/") never take or honour a lock',
  withDir(async (dir) => {
    const m = createMainStorage({ dataDir: dir });
    const rel = '2025-2026/scores/nat/1.json';
    put(dir, `${rel}.lock`, String(Date.now()));
    assert.equal((await m.invoke('fs:writeJson', rel, { s: 1 })).ok, true);
    assert.deepEqual(await m.invoke('fs:deleteFile', rel), { ok: true });
    assert.equal(exists(dir, rel), false);
    assert.equal(exists(dir, `${rel}.lock`), true);
  }),
);

test(
  'S17 quirk: "scores/x.json" at the top level is not a score path (no leading slash) and is locked',
  withDir(async (dir) => {
    const m = createMainStorage({ dataDir: dir });
    put(dir, 'scores/1.json.lock', String(Date.now()));
    assert.deepEqual(await m.invoke('fs:writeJson', 'scores/1.json', {}), {
      ok: false,
      reason: 'locked',
    });
  }),
);

test(
  'S18 own writes and deletes are noted in the watcher (noteWrite with the written text, noteDelete)',
  withDir(async (dir) => {
    const calls = [];
    const watcher = {
      noteWrite: (rel, content) => calls.push(['write', rel, content]),
      noteDelete: (rel) => calls.push(['delete', rel]),
    };
    const m = createMainStorage({ dataDir: dir, watcher });
    await m.invoke('fs:writeJson', 'a.json', { a: 1 });
    await m.invoke('fs:writeJson', 'a.json', { a: 2 }, { cas: true, expectedHash: 'stale' });
    await m.invoke('fs:deleteFile', 'a.json');
    await m.invoke('fs:deleteFile', 'missing.json');
    assert.deepEqual(calls, [
      ['write', 'a.json', pretty({ a: 1 })],
      ['delete', 'a.json'],
      ['delete', 'missing.json'],
    ]);
  }),
);

test(
  'S19 fs:deleteFile: removes the file, a missing file is still ok, no lock left behind',
  withDir(async (dir) => {
    const m = createMainStorage({ dataDir: dir });
    put(dir, 'exams/a.json', '1');
    assert.deepEqual(await m.invoke('fs:deleteFile', 'exams/a.json'), { ok: true });
    assert.deepEqual(await m.invoke('fs:deleteFile', 'exams/a.json'), { ok: true });
    assert.deepEqual(fs.readdirSync(path.join(dir, 'exams')), []);
  }),
);

test(
  'S37 CAS is not atomic: a foreign write landing between the hash check and the rename is lost',
  withDir(async (dir) => {
    for (const rel of ['exams/a.json', '2025-2026/scores/nat/1.json']) {
      const m = createMainStorage({ dataDir: dir });
      const { hash } = await m.invoke('fs:writeJson', rel, { v: 'base' });
      const real = fs.renameSync;
      let raced = false;
      fs.renameSync = (from, to) => {
        if (!raced) {
          raced = true;
          fs.writeFileSync(to, pretty({ v: 'colleague' }));
        }
        return real(from, to);
      };
      let r;
      try {
        r = await m.invoke('fs:writeJson', rel, { v: 'mine' }, { cas: true, expectedHash: hash });
      } finally {
        fs.renameSync = real;
      }
      assert.equal(r.ok, true, rel);
      assert.deepEqual(
        JSON.parse(read(dir, rel)),
        { v: 'mine' },
        `${rel}: colleague's write is gone`,
      );
    }
  }),
);

test(
  'S38 writes without cas (Store.save) overwrite a newer version from another instance',
  withDir(async (dir) => {
    const a = createMainStorage({ dataDir: dir });
    const b = createMainStorage({ dataDir: dir });
    for (const rel of [
      'school.json',
      'config.json',
      '2025-2026/students-2025-2026.json',
      '2025-2026/scores/nat/1.json',
    ]) {
      await a.invoke('fs:writeJson', rel, { v: 1 });
      await b.invoke('fs:writeJson', rel, { v: 2, by: 'b' });
      assert.deepEqual(await a.invoke('fs:writeJson', rel, { v: 1, by: 'a' }), {
        ok: true,
        hash: sha1(pretty({ v: 1, by: 'a' })),
      });
      assert.deepEqual(JSON.parse(read(dir, rel)), { v: 1, by: 'a' }, rel);
    }
  }),
);

// ── Compare-and-swap in the renderer (store.js update / saveEntity) ──────────

test(
  'S20 update: mutator gets (current or fallback(), onDisk) and the result is written with CAS',
  withDir(async (dir) => {
    const m = createMainStorage({ dataDir: dir });
    const writes = [];
    const rtti = bridge(m);
    const spy = { ...rtti, writeJson: (p, d, o) => (writes.push(o), rtti.writeJson(p, d, o)) };
    const cas = createStoreCas({ rtti: spy });
    const seen = [];
    await cas.update(
      'a.json',
      (cur, onDisk) => (seen.push([structuredClone(cur), onDisk]), { n: 1 }),
      () => ({ fresh: true }),
    );
    const next = await cas.update(
      'a.json',
      (cur, onDisk) => (
        seen.push([structuredClone(cur), structuredClone(onDisk)]),
        { n: cur.n + 1 }
      ),
    );
    assert.deepEqual(next, { n: 2 });
    assert.deepEqual(seen, [
      [{ fresh: true }, null],
      [{ n: 1 }, { n: 1 }],
    ]);
    assert.deepEqual(writes, [
      { cas: true, expectedHash: null },
      { cas: true, expectedHash: sha1(pretty({ n: 1 })) },
    ]);
  }),
);

test(
  'S21 update re-reads and re-applies the mutator when another instance wrote in between',
  withDir(async (dir) => {
    const m = createMainStorage({ dataDir: dir });
    const other = createMainStorage({ dataDir: dir });
    await m.invoke('fs:writeJson', 'a.json', { list: ['start'] });
    const rtti = bridge(m);
    let raced = false;
    const racing = {
      ...rtti,
      readJsonVersioned: async (p) => {
        const r = await rtti.readJsonVersioned(p);
        if (!raced) {
          raced = true;
          await other.invoke('fs:writeJson', p, { list: ['start', 'other'] });
        }
        return r;
      },
    };
    const cas = createStoreCas({ rtti: racing });
    let calls = 0;
    await cas.update('a.json', (cur) => (calls++, { list: [...cur.list, 'mine'] }));
    assert.equal(calls, 2);
    assert.deepEqual(JSON.parse(read(dir, 'a.json')), { list: ['start', 'other', 'mine'] });
  }),
);

test(
  'S22 update gives up after 5 conflicts: "Save failed for <rel>: conflict"',
  withDir(async (dir) => {
    const m = createMainStorage({ dataDir: dir });
    const rtti = bridge(m);
    let n = 0;
    const always = { ...rtti, writeJson: async () => (n++, { ok: false, reason: 'conflict' }) };
    const cas = createStoreCas({ rtti: always });
    await assert.rejects(
      cas.update('a.json', () => 1),
      { message: 'Save failed for a.json: conflict' },
    );
    assert.equal(n, 5);
  }),
);

test(
  'S23 update does not retry other failures (e.g. locked)',
  withDir(async (dir) => {
    const m = createMainStorage({ dataDir: dir });
    put(dir, 'a.json.lock', String(Date.now()));
    const cas = createStoreCas({ rtti: bridge(m) });
    await assert.rejects(
      cas.update('a.json', () => 1),
      { message: 'Save failed for a.json: locked' },
    );
  }),
);

test(
  'S24 update refuses to overwrite an unreadable file',
  withDir(async (dir) => {
    const m = createMainStorage({ dataDir: dir });
    put(dir, 'a.json', '{"half');
    const cas = createStoreCas({ rtti: bridge(m) });
    await quiet(() =>
      assert.rejects(
        cas.update('a.json', () => 1),
        /^Error: Bestand a\.json is onleesbaar: /,
      ),
    );
    assert.equal(read(dir, 'a.json'), '{"half');
  }),
);

test(
  'S25 updates of one file run one after another; a throwing mutator aborts only its own write',
  withDir(async (dir) => {
    const m = createMainStorage({ dataDir: dir });
    const cas = createStoreCas({ rtti: bridge(m) });
    const inc = () => cas.update('c.json', (cur) => ({ n: (cur?.n ?? 0) + 1 }));
    const results = await Promise.allSettled([
      inc(),
      inc(),
      cas.update('c.json', () => {
        throw new Error('nee');
      }),
      inc(),
    ]);
    assert.deepEqual(
      results.map((r) => r.status),
      ['fulfilled', 'fulfilled', 'rejected', 'fulfilled'],
    );
    assert.deepEqual(JSON.parse(read(dir, 'c.json')), { n: 3 });
  }),
);

test(
  'S26 saveEntity: _meta stamping (new file, rev increments, created* kept, legacy rev 0)',
  withDir(async (dir) => {
    mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-03-02T09:00:00Z') });
    try {
      const m = createMainStorage({ dataDir: dir });
      const cas = createStoreCas({ rtti: bridge(m), activeUser: { id: 'u1' } });
      const first = await cas.saveEntity('e.json', { id: 'e' }, undefined);
      assert.deepEqual(first._meta, {
        rev: 1,
        createdBy: 'u1',
        createdAt: '2026-03-02T09:00:00.000Z',
        updatedBy: 'u1',
        updatedAt: '2026-03-02T09:00:00.000Z',
      });
      mock.timers.setTime(Date.parse('2026-03-03T09:00:00Z'));
      cas.setActiveUser({ id: 'u2' });
      const second = await cas.saveEntity('e.json', { id: 'e', x: 1, _meta: first._meta }, 1);
      assert.deepEqual(second._meta, {
        rev: 2,
        createdBy: 'u1',
        createdAt: '2026-03-02T09:00:00.000Z',
        updatedBy: 'u2',
        updatedAt: '2026-03-03T09:00:00.000Z',
      });
      put(dir, 'legacy.json', pretty({ id: 'l' }));
      const legacy = await cas.saveEntity('legacy.json', { id: 'l' }, undefined);
      assert.deepEqual(legacy._meta, {
        rev: 1,
        createdBy: null,
        createdAt: null,
        updatedBy: 'u2',
        updatedAt: '2026-03-03T09:00:00.000Z',
      });
      cas.setActiveUser(null);
      const anon = await cas.saveEntity('anon.json', {}, 0);
      assert.equal(anon._meta.createdBy, null);
    } finally {
      mock.timers.reset();
    }
  }),
);

test(
  'S27 saveEntity: stale baseRev throws code "conflict" with updatedBy; force overwrites',
  withDir(async (dir) => {
    const m = createMainStorage({ dataDir: dir });
    const a = createStoreCas({ rtti: bridge(m), activeUser: { id: 'a' } });
    const b = createStoreCas({ rtti: bridge(m), activeUser: { id: 'b' } });
    await a.saveEntity('e.json', { v: 1 }, undefined);
    await b.saveEntity('e.json', { v: 2 }, 1);
    await assert.rejects(
      a.saveEntity('e.json', { v: 3 }, 1),
      (e) => e.message === 'conflict' && e.code === 'conflict' && e.updatedBy === 'b',
    );
    const forced = await a.saveEntity('e.json', { v: 4 }, 1, { force: true });
    assert.equal(forced._meta.rev, 3);
    // A new file accepts any baseRev; a deleted file is "new" again.
    assert.equal((await a.saveEntity('n.json', { v: 1 }, 7))._meta.rev, 1);
  }),
);

// ── Watcher (sync.js createWatcher) ──────────────────────────────────────────
// Timers are mocked and fs.watch is replaced by a stub, so every event is
// delivered explicitly: watch(rel) = an fs.watch notification, tick(ms) = time.

function startWatcher(dir) {
  const realWatch = fs.watch;
  let notify = null;
  let onError = null;
  const watchCalls = { count: 0, closed: 0 };
  fs.watch = (_dir, _opts, cb) => {
    notify = cb;
    watchCalls.count++;
    return {
      on: (ev, fn) => {
        if (ev === 'error') onError = fn;
      },
      close: () => watchCalls.closed++,
    };
  };
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const batches = [];
  const w = sync.createWatcher(dir, { onChanges: (c) => batches.push(c) });
  return {
    w,
    batches,
    watchCalls,
    fail: (msg) => quiet(() => onError(new Error(msg))),
    watch: (rel) => notify('change', rel.split('/').join(path.sep)),
    // Step in 10 ms increments: a timer set while timers run fires on a later step.
    tick: (ms) => {
      for (let left = ms; left > 0; left -= 10) mock.timers.tick(Math.min(10, left));
    },
    changes: () => batches.splice(0).flat(),
    stop: () => {
      w.close();
      mock.timers.reset();
      fs.watch = realWatch;
    },
  };
}
const meta1 = { rev: 1, createdBy: 'u', createdAt: null, updatedBy: 'u', updatedAt: null };

test(
  'S28 an external add is reported after debounce (500 ms) + flush (100 ms) with the file _meta',
  withDir((dir) => {
    put(dir, 'config.json', pretty({ activeYear: '2025-2026' }));
    const t = startWatcher(dir);
    try {
      put(dir, 'observaties/o1.json', pretty({ id: 'o1', _meta: meta1 }));
      t.watch('observaties/o1.json');
      t.tick(499);
      assert.deepEqual(t.batches, []);
      t.tick(1);
      t.tick(99);
      assert.deepEqual(t.batches, []);
      t.tick(1);
      assert.deepEqual(t.changes(), [
        { relPath: 'observaties/o1.json', kind: 'added', meta: meta1 },
      ]);
    } finally {
      t.stop();
    }
  }),
);

test(
  'S29 changes and deletes; meta is null for arrays, files without _meta and .typ',
  withDir((dir) => {
    put(dir, '2025-2026/students-2025-2026.json', '[]');
    put(dir, 'opdrachten/o.typ', 'a');
    put(dir, 'school.json', '{}');
    const t = startWatcher(dir);
    try {
      put(dir, '2025-2026/students-2025-2026.json', '[{"id":1}]');
      put(dir, 'opdrachten/o.typ', 'bb');
      fs.rmSync(path.join(dir, 'school.json'));
      for (const r of ['2025-2026/students-2025-2026.json', 'opdrachten/o.typ', 'school.json'])
        t.watch(r);
      t.tick(600);
      assert.deepEqual(t.changes(), [
        { relPath: '2025-2026/students-2025-2026.json', kind: 'changed', meta: null },
        { relPath: 'opdrachten/o.typ', kind: 'changed', meta: null },
        { relPath: 'school.json', kind: 'deleted', meta: null },
      ]);
    } finally {
      t.stop();
    }
  }),
);

test(
  'S30 own writes (noteWrite) and own deletes (noteDelete) are not reported',
  withDir((dir) => {
    put(dir, 'a.json', '1');
    const t = startWatcher(dir);
    try {
      put(dir, 'a.json', '2');
      t.w.noteWrite('a.json', '2');
      put(dir, 'b.json', '3');
      t.w.noteWrite('b.json', '3');
      fs.rmSync(path.join(dir, 'a.json'));
      t.w.noteDelete('a.json');
      for (const r of ['a.json', 'b.json']) t.watch(r);
      t.tick(20_000 + 600);
      assert.deepEqual(t.changes(), []);
    } finally {
      t.stop();
    }
  }),
);

test(
  'S31 ignored: fotos/, bak/, templates/, temp/ at the top, _preview_ files, other extensions',
  withDir((dir) => {
    const t = startWatcher(dir);
    try {
      const rels = [
        'fotos/a.json',
        'bak/a.json',
        'templates/x/a.json',
        'temp/a.json',
        'opdrachten/_preview_o.typ',
        'a.json.lock',
        'a.json.123.tmp',
        'img.png',
        'sub/fotos/a.json',
      ];
      for (const r of rels) {
        put(dir, r, '{}');
        t.watch(r);
      }
      t.tick(20_000 + 600);
      assert.deepEqual(
        t.changes().map((c) => c.relPath),
        ['sub/fotos/a.json'],
      );
    } finally {
      t.stop();
    }
  }),
);

test(
  'S32 the 20 s poll finds missed changes, only in the active year and outside year folders',
  withDir((dir) => {
    put(dir, 'config.json', pretty({ activeYear: '2025-2026' }));
    put(dir, '2025-2026/exams/a.json', '{}');
    put(dir, '2024-2025/exams/b.json', '{}');
    const t = startWatcher(dir);
    try {
      put(dir, '2025-2026/exams/a.json', '{"v":1}');
      put(dir, '2024-2025/exams/b.json', '{"v":1}');
      put(dir, '2025-2026/groups/new.json', '{}');
      put(dir, 'observaties/new.json', '{}');
      t.tick(19_999 + 600);
      assert.deepEqual(t.changes(), [], 'nothing before the first poll');
      t.tick(1 + 600);
      assert.deepEqual(
        t
          .changes()
          .map((c) => `${c.kind} ${c.relPath}`)
          .sort(),
        [
          'added 2025-2026/groups/new.json',
          'added observaties/new.json',
          'changed 2025-2026/exams/a.json',
        ],
      );
      // An fs.watch event for another year is still reported.
      t.watch('2024-2025/exams/b.json');
      t.tick(600);
      assert.deepEqual(
        t.changes().map((c) => c.relPath),
        ['2024-2025/exams/b.json'],
      );
    } finally {
      t.stop();
    }
  }),
);

test(
  'S33 poll reports deletes of known files in scope only',
  withDir((dir) => {
    put(dir, 'config.json', pretty({ activeYear: '2025-2026' }));
    put(dir, '2025-2026/exams/a.json', '{}');
    put(dir, '2024-2025/exams/b.json', '{}');
    const t = startWatcher(dir);
    try {
      fs.rmSync(path.join(dir, '2025-2026/exams/a.json'));
      fs.rmSync(path.join(dir, '2024-2025/exams/b.json'));
      t.tick(20_000 + 600);
      assert.deepEqual(t.changes(), [
        { relPath: '2025-2026/exams/a.json', kind: 'deleted', meta: null },
      ]);
    } finally {
      t.stop();
    }
  }),
);

test(
  'S34 quirk: the first touch with identical content is reported (no hash yet), the next is not',
  withDir((dir) => {
    const abs = put(dir, 'a.json', '{}');
    const t = startWatcher(dir);
    try {
      ageFile(abs, 5000);
      t.watch('a.json');
      t.tick(600);
      assert.deepEqual(t.changes(), [{ relPath: 'a.json', kind: 'changed', meta: null }]);
      ageFile(abs, 3000);
      t.watch('a.json');
      t.tick(600);
      assert.deepEqual(t.changes(), []);
    } finally {
      t.stop();
    }
  }),
);

test(
  'S35 unparsable JSON is skipped and checked once more after 1 s',
  withDir((dir) => {
    const t = startWatcher(dir);
    try {
      put(dir, 'a.json', '{"half');
      put(dir, 'b.json', '{"half');
      t.watch('a.json');
      t.watch('b.json');
      t.tick(500);
      assert.deepEqual(t.batches, []);
      put(dir, 'a.json', '{"whole":true}');
      t.tick(1000 + 100);
      assert.deepEqual(t.changes(), [{ relPath: 'a.json', kind: 'added', meta: null }]);
      t.tick(5000);
      assert.deepEqual(t.changes(), [], 'b.json is not retried a second time');
    } finally {
      t.stop();
    }
  }),
);

test(
  'S36 events within the debounce window coalesce into one check; one flush per 100 ms batch',
  withDir((dir) => {
    const t = startWatcher(dir);
    try {
      // a: events at 0 and 400 ms -> one check at 900; b: event at 450 -> check at 950;
      // both land in the flush that the first emit schedules for 1000.
      put(dir, 'a.json', '1');
      t.watch('a.json');
      t.tick(400);
      put(dir, 'a.json', '22');
      t.watch('a.json');
      t.tick(50);
      put(dir, 'b.json', '3');
      t.watch('b.json');
      t.tick(540);
      assert.deepEqual(t.batches, []);
      t.tick(20);
      assert.equal(t.batches.length, 1);
      assert.deepEqual(
        t.changes().map((c) => `${c.kind} ${c.relPath}`),
        ['added a.json', 'added b.json'],
      );
    } finally {
      t.stop();
    }
  }),
);

test(
  'S39 after an fs.watch error the watcher closes it, polls meanwhile and restarts it after 30 s',
  withDir((dir) => {
    put(dir, 'config.json', pretty({ activeYear: '2025-2026' }));
    const t = startWatcher(dir);
    try {
      assert.equal(t.watchCalls.count, 1);
      t.fail('EPERM');
      assert.equal(t.watchCalls.closed, 1);
      put(dir, 'observaties/x.json', '{}');
      t.tick(20_000 + 600);
      assert.deepEqual(
        t.changes().map((c) => c.relPath),
        ['observaties/x.json'],
        'poll still works',
      );
      assert.equal(t.watchCalls.count, 1);
      t.tick(10_000);
      assert.equal(t.watchCalls.count, 2, 'fs.watch restarted 30 s after the error');
    } finally {
      t.stop();
    }
  }),
);

test(
  'S40 a file that cannot be read during a check (EBUSY) is skipped silently until the next event or poll',
  withDir((dir) => {
    const t = startWatcher(dir);
    const real = fs.readFileSync;
    try {
      put(dir, 'a.json', '{}');
      let busy = true;
      fs.readFileSync = (file, ...rest) => {
        if (busy && String(file).endsWith('a.json')) {
          busy = false;
          throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
        }
        return real(file, ...rest);
      };
      t.watch('a.json');
      t.tick(5000);
      assert.deepEqual(t.changes(), [], 'no event and no retry timer');
      t.watch('a.json');
      t.tick(600);
      assert.deepEqual(t.changes(), [{ relPath: 'a.json', kind: 'added', meta: null }]);
    } finally {
      fs.readFileSync = real;
      t.stop();
    }
  }),
);

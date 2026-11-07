// SPDX-License-Identifier: AGPL-3.0-or-later
// Turns a v1 fixture into the current layout: v2 (docs/reference/data-files-v2.md),
// then v3 (data-files-v3.md, step 18). The Store tests whose golden scenarios
// hold v1 folders use the v2 step only (`filesToV2`); the UI's MockApi gets the
// current format (`toCurrent`).
// Fixtures only: the real migration is `maatwerk-core::migrate`
// (`maatwerk-cli migrate`), which also stamps every file (C19), makes a backup
// and handles legacy leftovers. This one does not stamp, and handles what
// tools/fixtures/generate.mjs and the golden scenarios contain.
//
//   node tools/fixtures/to-current.mjs <dir>     converts a folder in place

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(HERE, '../../crates/maatwerk-core/assets/templates');
const V1_TEMPLATES = 'templates/RTTI explanations and advices/';

const idString = (id) => (typeof id === 'number' ? String(id) : id);
const json = (data) => JSON.stringify(data, null, 2) + '\n';
const text = (v) => (typeof v === 'string' ? v : Buffer.from(v).toString('utf8'));

/**
 * v1 -> v2 on a map of relPath -> content (string or bytes); returns a new map.
 * Unknown files are kept as they are.
 */
export function filesToV2(files) {
  const out = new Map();
  const v1 = new Map(Object.entries(files instanceof Map ? Object.fromEntries(files) : files));
  const take = (rel) => {
    const v = v1.get(rel);
    v1.delete(rel);
    return v;
  };

  // C1
  const config = v1.has('config.json') ? JSON.parse(text(take('config.json'))) : {};
  out.set('config.json', json({ ...config, schema_version: 2 }));

  // C16
  if (v1.has('gebruikers.json')) {
    for (const user of JSON.parse(text(take('gebruikers.json'))) ?? [])
      out.set(`gebruikers/${user.id}.json`, json(user));
  }

  // C14
  const lib = fs.readFileSync(path.join(TEMPLATES, 'lib.typ'), 'utf8');
  const main = fs.readFileSync(path.join(TEMPLATES, 'opdracht-main.typ'), 'utf8');
  for (const rel of [...v1.keys()].filter((r) => /^opdrachten\/[^/]+\.json$/.test(r))) {
    const { typFile, ...opdracht } = JSON.parse(text(take(rel)));
    const dir = `opdrachten/${opdracht.id}`;
    const typ = take(`opdrachten/${typFile ?? `${opdracht.id}.typ`}`);
    out.set(`${dir}/opdracht.json`, json(opdracht));
    out.set(
      `${dir}/opdracht.typ`,
      typ === undefined ? '' : text(typ).replaceAll(`images/${opdracht.id}/`, 'images/'),
    );
    out.set(`${dir}/main.typ`, main);
    out.set(`${dir}/lib.typ`, lib);
    const images = `opdrachten/images/${opdracht.id}/`;
    for (const img of [...v1.keys()].filter((r) => r.startsWith(images)))
      out.set(`${dir}/images/${img.slice(images.length)}`, take(img));
  }
  take('opdrachten/lib.typ');

  // C11 (no wi_4..6 files in the fixtures)
  for (const rel of [...v1.keys()].filter((r) => r.startsWith(V1_TEMPLATES))) {
    const m = rel.slice(V1_TEMPLATES.length).match(/^rtti_expl_adv_(\w+)_(\d+)\.json$/);
    if (m) out.set(`templates/rtti/${m[1]}_${m[2]}.json`, take(rel));
  }

  for (const [rel, content] of v1) {
    // C8 + wrapper
    if (/^(\d{4}-\d{4})\/students-\1\.json$/.test(rel)) {
      const list = JSON.parse(text(content)) ?? [];
      out.set(rel, json({ students: list.map((s) => ({ ...s, id: idString(s.id) })) }));
    } else if (/^\d{4}-\d{4}\/groups\/[^/]+\.json$/.test(rel)) {
      const group = JSON.parse(text(content));
      if (Array.isArray(group?.student_ids))
        group.student_ids = [...new Set(group.student_ids.map(idString))];
      out.set(rel, json(group));
    } else if (/^\d{4}-\d{4}\/scores\/[^/]+\/[^/]+\.json$/.test(rel)) {
      // C9
      const rec = JSON.parse(text(content));
      if (rec && 'student_id' in rec) rec.student_id = idString(rec.student_id);
      for (const qs of Object.values(rec?.scores ?? {}))
        for (const [q, v] of Object.entries(qs ?? {})) if (v === null) qs[q] = 'N';
      out.set(rel, json(rec));
    } else {
      out.set(rel, content);
    }
  }
  return out;
}

const IMAGES_V2 = 'fotos/';
const IMAGES = 'afbeeldingen/';
const renameImage = (p) =>
  typeof p === 'string' && p.startsWith(IMAGES_V2) ? IMAGES + p.slice(IMAGES_V2.length) : p;

/**
 * v2 -> v3 on a map of relPath -> content, like `maatwerk-core::migrate::v3`:
 * fotos/ -> afbeeldingen/ (and the paths to it), users/ dropped, exam fields
 * `kind` and `diagnostic`, resits get the original's observaties (locked),
 * `school.json` `minAppVersion` 0.9.0.
 */
export function filesToV3(files) {
  const out = new Map();
  const exams = new Map();
  for (const [rel, content] of files) {
    if (rel.startsWith('users/')) continue;
    if (rel.startsWith(IMAGES_V2)) {
      out.set(renameImage(rel), content);
    } else if (rel === 'config.json') {
      out.set(rel, json({ ...JSON.parse(text(content)), schema_version: 3 }));
    } else if (rel === 'school.json') {
      const school = JSON.parse(text(content));
      for (const key of ['logo', 'watermerk'])
        if (key in school) school[key] = renameImage(school[key]);
      out.set(rel, json({ ...school, minAppVersion: '0.9.0' }));
    } else if (/^gebruikers\/[^/]+\.json$/.test(rel)) {
      const user = JSON.parse(text(content));
      out.set(rel, json('foto' in user ? { ...user, foto: renameImage(user.foto) } : user));
    } else if (/^\d{4}-\d{4}\/exams\/[^/]+\.json$/.test(rel)) {
      exams.set(rel, JSON.parse(text(content)));
    } else {
      out.set(rel, content);
    }
  }
  const byYearId = new Map([...exams].map(([rel, e]) => [`${rel.slice(0, 9)}/${e.id}`, e]));
  for (const [rel, exam] of exams) {
    const next = { ...exam, kind: exam.kind ?? 'toets', diagnostic: exam.diagnostic ?? false };
    const parent = exam.parent_id ? byYearId.get(`${rel.slice(0, 9)}/${exam.parent_id}`) : null;
    if (parent) {
      const own = (exam.obs_ids ?? []).filter((o) => !(parent.obs_ids ?? []).includes(o));
      next.obs_ids = [...(parent.obs_ids ?? []), ...own];
      next.obs_from_parent = true;
    }
    out.set(rel, json(next));
  }
  return out;
}

/** v1 (or v2) -> the current format. */
export function filesToCurrent(files) {
  return filesToV3(filesToV2(files));
}

/** Converts the folder `root` in place to the current format. */
export function toCurrent(root) {
  const files = new Map();
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else files.set(r, fs.readFileSync(path.join(root, r)));
    }
  };
  walk('');
  const converted = filesToCurrent(files);
  for (const rel of files.keys()) fs.rmSync(path.join(root, rel));
  for (const [rel, content] of converted) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  // Folders the v1 layout leaves empty.
  for (const dir of [
    'opdrachten/images',
    'templates/RTTI explanations and advices',
    'fotos',
    'users',
  ])
    fs.rmSync(path.join(root, dir), { recursive: true, force: true });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [dir] = process.argv.slice(2);
  if (!dir) {
    console.error('usage: node tools/fixtures/to-current.mjs <dir>');
    process.exit(2);
  }
  toCurrent(dir);
}

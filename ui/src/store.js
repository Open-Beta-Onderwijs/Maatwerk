// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * store.js — Central data access layer.
 *
 * File layout, format v2 (docs/reference/data-files-v2.md):
 *
 *   data/
 *   ├── config.json                          { schema_version: 2, activeYear }
 *   ├── school.json                          School + _meta
 *   ├── gebruikers/<userId>.json             User + _meta
 *   ├── observaties/
 *   │   └── <obsId>.json                     { id, naam, icon, jaarlagen[], subject }
 *   ├── opdrachten/<id>/                     opdracht.json, main.typ, opdracht.typ, lib.typ, images/
 *   └── YYYY-YYYY/
 *       ├── students-YYYY-YYYY.json          { students: [{ id, voornaam, … }] }
 *       ├── exams/
 *       │   └── <examId>.json                { id, subject, title, jaarlaag, … }
 *       ├── groups/
 *       │   └── <groupId>.json               { id, subject, name, jaarlaag, student_ids[] }
 *       └── scores/
 *           ├── nat/  bio/  schk/  wi/
 *           │   └── <studentId>.json
 *
 * Subject field inside each JSON file is authoritative (not derived from path).
 * Students and score files pass through domain/v2.ts on every read and write:
 * in memory a year's students are a plain array and "N" is null, as before.
 */

import { bestAttempt, compareHistory, resitsOf, resolveBestAttempts } from './domain/attempts';
import { calcGrade, calcResults, examResults } from './domain/grades';
import {
  currentSchoolYear,
  fullName,
  jaarlaagFromStamklas,
  makeExamId as makeExamIdFor,
  makeGroupId,
  nextVolgnummer,
  parseGroupName,
  sortStudents,
  stampMeta as stampMetaBy,
  subjectFromGroupName,
} from './domain/ids';
import {
  WI_VARIANTS,
  assignOpdrachten,
  cijferCardReason,
  opdrachtCijferCards,
  opdrachtCoupling,
  opdrachtMatchesExam as opdrachtMatchesExamFor,
} from './domain/opdrachten';
import { SUBJECT_DISPLAY } from './domain/rapport';
import { decode, encode, studentId as asStudentId } from './domain/v2';
import { timed } from './utils/perf';

const Store = (() => {
  // ── Cache ─────────────────────────────────────────────────────────────────
  // Exam/group/obs entries keyed as: `${year}/exams/${subject}`, `obs/${subject}`, etc.
  //
  // `generation` counts changes to cached data (Step 7c): screens keep their DOM
  // while it is unchanged. Replacing or dropping a cached entry counts; filling an
  // empty one from disk does not (the data did not change). In-place edits of
  // cached arrays happen only next to a write or an external change, which count
  // through changed().
  let generation = 0;
  const changed = () => {
    generation++;
  };
  const cache = new Proxy(
    {},
    {
      set(target, key, value) {
        if (target[key] !== undefined && target[key] !== value) changed();
        target[key] = value;
        return true;
      },
      deleteProperty(target, key) {
        if (target[key] !== undefined) changed();
        delete target[key];
        return true;
      },
    },
  );
  let _years = null;
  let _activeSubject = null;
  let _activeUser = null;
  // Step 7b: `{ voorzitter: <vak> }` when logged in through the sectievoorzitter badge.
  let _activeRole = null;

  async function load(relPath) {
    if (cache[relPath] !== undefined) return cache[relPath];
    const data = decode(relPath, await window.maatwerk.readJson(relPath));
    cache[relPath] = data;
    return data;
  }

  function invalidate(relPath) {
    delete cache[relPath];
  }

  // ── Safe read-modify-write (shared OneDrive folder) ───────────────────────
  // update() re-reads relPath from disk, applies mutator and writes the result
  // only if nobody changed the file in between (compare-and-swap on a content
  // hash, checked in main.js); on a conflict it starts over with the fresh file.
  // mutator(current, onDisk): `current` is the on-disk data (or fallback() when
  // the file is absent) and may be mutated; onDisk is null for a new file.
  // Throwing from the mutator aborts the write. Writes per file are serialised.
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
        const read = await window.maatwerk.readJsonVersioned(relPath);
        if (read?.error) throw new Error(`Bestand ${relPath} is onleesbaar: ${read.error}`);
        const onDisk = decode(relPath, read.data);
        const next = mutator(onDisk ?? fallback(), onDisk);
        const result = await window.maatwerk.writeJson(relPath, encode(relPath, next), {
          cas: true,
          expectedHash: read.hash,
        });
        if (result?.ok) {
          changed();
          return next;
        }
        if (result?.reason !== 'conflict') {
          throw new Error(`Save failed for ${relPath}: ${result?.reason}`);
        }
      }
      throw new Error(`Save failed for ${relPath}: conflict`);
    };
    return serialize(relPath, run);
  }

  // Whole-file editors (RTTI templates): read a file with its content hash and
  // write it back only if it is still that version (ADR-0003 C6). A conflict
  // throws an error with code 'conflict'.
  async function loadVersioned(relPath) {
    const read = await window.maatwerk.readJsonVersioned(relPath);
    if (read?.error) throw new Error(`Bestand ${relPath} is onleesbaar: ${read.error}`);
    return { data: read.data, hash: read.hash };
  }

  async function saveVersioned(relPath, data, hash) {
    const result = await window.maatwerk.writeJson(relPath, data, {
      cas: true,
      expectedHash: hash ?? null,
    });
    if (result?.ok) {
      changed();
      invalidate(relPath);
      return result.hash;
    }
    if (result?.reason === 'conflict') throw conflictError(null);
    throw new Error(`Save failed for ${relPath}: ${result?.reason}`);
  }

  // Version info stored in single-object files (exams, groups, observaties, opdrachten).
  function stampMeta(obj, onDisk) {
    return stampMetaBy(obj, onDisk, _activeUser?.id ?? null);
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

  // ── Active subject ─────────────────────────────────────────────────────────
  function setActiveSubject(s) {
    _activeSubject = s;
  }
  function getActiveSubject() {
    return _activeSubject;
  }

  // ── Active user ────────────────────────────────────────────────────────────
  function setActiveUser(user, role = null) {
    _activeUser = user;
    _activeRole = user ? role : null;
  }
  function getActiveRole() {
    return _activeRole;
  }
  /** Sectievoorzitter of `vak` in this session (Step 7b, decision 13). */
  function isVoorzitterActive(vak) {
    return Boolean(vak) && _activeRole?.voorzitter === vak;
  }
  /** The teacher assigned as sectievoorzitter of `vak` in school.json, or null. */
  function voorzitterOf(vak) {
    return getSchoolSync().secties?.[vak]?.voorzitter ?? null;
  }
  function getActiveUser() {
    return _activeUser;
  }
  function isAdminActive() {
    return _activeUser?.isAdmin === true;
  }

  // ── Users (gebruikers/<id>.json, ADR-0003 C16) ────────────────────────────
  async function loadUsers() {
    if (cache['gebruikers'] === undefined) {
      const all = await window.maatwerk.readAllJson('gebruikers');
      cache['gebruikers'] = all.filter((u) => u && u.id);
    }
    return cache['gebruikers'];
  }

  // ── School ─────────────────────────────────────────────────────────────────
  async function loadSchool() {
    return await load('school.json');
  }

  /** Forgets the cached school, so the next loadSchool reads the file. */
  function invalidateSchool() {
    invalidate('school.json');
  }

  // Apply a change to the latest school.json on disk, so a change another
  // teacher made in the meantime is kept (ADR-0003 C6). `change` is either an
  // object of fields to set or a function that edits the school in place.
  // With `baseRev` (the _meta.rev the form was loaded with) a school saved by
  // someone else since is a conflict instead (C16), as for exams and groups.
  async function updateSchool(change, baseRev) {
    const school = await update(
      'school.json',
      (current, onDisk) => {
        if (baseRev !== undefined && onDisk && (onDisk._meta?.rev ?? 0) !== (baseRev ?? 0)) {
          throw conflictError(onDisk._meta);
        }
        if (typeof change === 'function') change(current);
        else Object.assign(current, change);
        return stampMeta(current, onDisk);
      },
      () => ({}),
    );
    cache['school.json'] = school;
    return school;
  }

  // A file written by the backend outside the Store ("Herstellen uit snapshot",
  // Step 7b): the next read takes it from disk. Year data (exams, groups,
  // scores) is cached per year and subject and reloads at the next login.
  function forgetFile(relPath) {
    if (relPath.startsWith('gebruikers/')) delete cache['gebruikers'];
    else invalidate(relPath);
  }

  // A user record written by the backend (PIN commands, Step 7b): own writes
  // are not echoed by the watcher, so the cache is updated here.
  function cacheUser(user) {
    const users = cache['gebruikers'];
    if (!users || !user?.id) return;
    const idx = users.findIndex((u) => u.id === user.id);
    if (idx >= 0) users[idx] = user;
    else users.push(user);
    if (_activeUser?.id === user.id) _activeUser = user;
    changed();
  }

  // One file per user (C16): saving checks the rev the edit started from, so
  // two admins editing the same user no longer overwrite each other silently.
  async function upsertUser(user, baseRev = user._meta?.rev) {
    const saved = await saveEntity(`gebruikers/${user.id}.json`, user, baseRev);
    const users = await loadUsers();
    const idx = users.findIndex((u) => u.id === saved.id);
    if (idx >= 0) users[idx] = saved;
    else users.push(saved);
    return saved;
  }

  // ── Instellingen (instellingen.json, Step 7b; admin) ────────────────────
  async function loadInstellingen() {
    invalidate('instellingen.json');
    return await load('instellingen.json');
  }

  async function saveInstellingen(data, baseRev) {
    const saved = await saveEntity('instellingen.json', data, baseRev);
    cache['instellingen.json'] = saved;
    return saved;
  }

  // ── Session (machine-local, not synced via OneDrive) ──────────────────────
  async function saveLastSession(subject, userId) {
    const existing = (await window.maatwerk.readLocalSession()) ?? {};
    await window.maatwerk.writeLocalSession({
      ...existing,
      lastSubject: subject,
      lastUserId: userId,
    });
  }

  async function loadLastSession() {
    return await window.maatwerk.readLocalSession();
  }

  async function saveFilterState(userId, state) {
    const existing = (await window.maatwerk.readLocalSession()) ?? {};
    const filtersByUser = existing.filtersByUser ?? {};
    filtersByUser[userId] = {
      schoolsoorten: [...state.schoolsoorten],
      jaarlagen: [...state.jaarlagen],
      jaarlagenKlas: [...state.jaarlagenKlas],
      eigenOnly: state.eigenOnly,
    };
    await window.maatwerk.writeLocalSession({ ...existing, filtersByUser });
  }

  async function loadFilterState(userId) {
    const session = await window.maatwerk.readLocalSession();
    return session?.filtersByUser?.[userId] ?? null;
  }

  // ── Path helpers ──────────────────────────────────────────────────────────
  const ypStudents = (year) => `${year}/students-${year}.json`;
  const ypExam = (year, id) => `${year}/exams/${id}.json`;
  const ypGroup = (year, id) => `${year}/groups/${id}.json`;
  const ypObs = (id) => `observaties/${id}.json`;
  const ypScore = (year, subj, id) => `${year}/scores/${subj}/${id}.json`;

  // ── Subject helpers ────────────────────────────────────────────────────────
  // SUBJECT_DISPLAY: src/domain/rapport.ts (one copy)

  function obsMatchesSubject(obs, subject) {
    const subjectsArr = Array.isArray(obs.subjects)
      ? obs.subjects
      : obs.subject
        ? [obs.subject]
        : [];
    if (subject === 'wi') return subjectsArr.some((s) => WI_VARIANTS.has(s));
    return subjectsArr.includes(subject);
  }

  function invalidateObsCache() {
    for (const key of Object.keys(cache)) {
      if (key.startsWith('obs/')) delete cache[key];
    }
  }

  // subjectFromGroupName, parseGroupName: src/domain/ids.ts

  // ── Year management ───────────────────────────────────────────────────────

  function listYearsSync() {
    return _years ?? [];
  }

  // ── Load functions (subject-scoped) ───────────────────────────────────────
  async function loadExams(year, subject) {
    const key = `${year}/exams/${subject}`;
    if (cache[key] !== undefined) return cache[key];
    const all = await window.maatwerk.readAllJson(`${year}/exams`);
    cache[key] = all.filter((e) => e.subject === subject);
    return cache[key];
  }

  async function loadGroups(year, subject) {
    const key = subject ? `${year}/groups/${subject}` : `${year}/groups/__all__`;
    if (cache[key] !== undefined) return cache[key];
    const all = await window.maatwerk.readAllJson(`${year}/groups`);
    cache[key] = subject ? all.filter((g) => g.subject === subject) : all;
    return cache[key];
  }

  async function loadObservaties(subject) {
    const key = `obs/${subject}`;
    if (cache[key] !== undefined) return cache[key];
    const all = await window.maatwerk.readAllJson('observaties');
    cache[key] = all.filter((o) => obsMatchesSubject(o, subject));
    return cache[key];
  }

  async function loadYear(year, subject = _activeSubject) {
    await window.maatwerk.ensureYear(year);
    const tasks = [load(ypStudents(year))];
    // subject === null means admin (all groups); subject === undefined means no subject yet
    if (subject !== undefined) tasks.push(loadGroups(year, subject));
    if (subject) tasks.push(loadExams(year, subject));
    await Promise.all(tasks);
    if (_years && !_years.includes(year)) {
      _years.push(year);
      _years.sort((a, b) => b.localeCompare(a));
    }
  }

  // ── Preload: warm config + year list before startup screen ────────────────
  async function preload() {
    _years = await window.maatwerk.listYears();
    await load('config.json');
    await load('school.json');
    _years = await window.maatwerk.listYears();
  }

  async function initSubject(subject) {
    const year = getConfigSync().activeYear ?? currentSchoolYear();
    // The watcher polls the year this teacher works in (ADR-0003 C7).
    void window.maatwerk.setWatchYear(year);
    if (isAdminActive()) {
      // Admin sees all subjects — only preload students and all groups
      await loadYear(year, null);
    } else {
      setActiveSubject(subject);
      await Promise.all([loadYear(year, subject), loadObservaties(subject)]);
    }
  }

  // ── Sync getters (safe after preload / loadYear / initSubject) ────────────
  function getConfigSync() {
    return cache['config.json'] ?? { activeYear: currentSchoolYear() };
  }
  function getSchoolSync() {
    return cache['school.json'] ?? {};
  }
  function getStudentsSync(year) {
    return cache[ypStudents(year)] ?? [];
  }
  function getGroupsSync(year, subject = isAdminActive() ? null : _activeSubject) {
    const key = subject ? `${year}/groups/${subject}` : `${year}/groups/__all__`;
    return cache[key] ?? [];
  }
  function getExamsSync(year, subject = _activeSubject) {
    return cache[`${year}/exams/${subject}`] ?? [];
  }
  function getObservatiesSync(subject = _activeSubject) {
    return cache[`obs/${subject}`] ?? [];
  }

  // ── Config ────────────────────────────────────────────────────────────────
  async function getConfig() {
    return (await load('config.json')) ?? { activeYear: currentSchoolYear() };
  }

  async function setActiveYear(year) {
    cache['config.json'] = await update(
      'config.json',
      // A missing config.json (still syncing) must not come back without schema_version
      // (review 7a m4): every PC would then offer the migration.
      (cfg) => Object.assign(cfg, { activeYear: year, schema_version: cfg.schema_version ?? 2 }),
      () => ({}),
    );
  }

  // currentSchoolYear: src/domain/ids.ts

  // ── Student helpers ───────────────────────────────────────────────────────
  // fullName, jaarlaagFromStamklas, sortStudents: src/domain/ids.ts

  // ── Students (year-scoped) ────────────────────────────────────────────────
  async function getStudents(year) {
    return (await load(ypStudents(year))) ?? [];
  }

  // The students file is one shared array per year, so every change is applied
  // to the latest version on disk (per student) instead of rewriting the cached list.
  async function updateStudents(year, mutator) {
    cache[ypStudents(year)] = await update(
      ypStudents(year),
      (list) => sortStudents(mutator(list)),
      () => [],
    );
  }

  function mergeStudent(list, student) {
    const flat = {
      id: asStudentId(student.id),
      voornaam: student.voornaam ?? '',
      tussenvoegsel: student.tussenvoegsel ?? '',
      achternaam: student.achternaam ?? student.name ?? '',
      stamklas: student.stamklas ?? '',
      geslacht: student.geslacht ?? '',
      jaarlaag: student.jaarlaag ?? '',
      schoolsoort: student.schoolsoort ?? [],
    };
    const idx = list.findIndex((s) => s.id === flat.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...flat };
    else list.push(flat);
  }

  async function upsertStudent(student, year) {
    await updateStudents(year, (list) => {
      mergeStudent(list, student);
      return list;
    });
  }

  async function upsertStudents(students, year) {
    await updateStudents(year, (list) => {
      for (const student of students) mergeStudent(list, student);
      return list;
    });
  }

  async function deleteStudent(id, year) {
    await updateStudents(year, (list) => list.filter((s) => s.id !== asStudentId(id)));
  }

  // ── Groups (year-scoped, subject-filtered) ────────────────────────────────
  async function getGroups(year, subject = isAdminActive() ? null : _activeSubject) {
    return loadGroups(year, subject);
  }

  async function upsertGroup(group, year, { force = false } = {}) {
    const subj = group.subject ?? subjectFromGroupName(group.name) ?? _activeSubject;
    const { academic_year: _ay, ...clean } = group;
    const updated = { ...clean, subject: subj };
    if (Array.isArray(updated.student_ids)) {
      updated.student_ids = [...new Set(updated.student_ids.map(asStudentId))]; // C8
    }
    const saved = await saveEntity(ypGroup(year, updated.id), updated, updated._meta?.rev, {
      force,
    });
    const key = `${year}/groups/${subj}`;
    cache[key] = cache[key] ?? [];
    for (const k of [key, `${year}/groups/__all__`]) {
      const arr = cache[k];
      if (!arr) continue;
      const i = arr.findIndex((g) => g.id === saved.id);
      if (i >= 0) arr[i] = saved;
      else arr.push(saved);
    }
  }

  // Bulk import: replaces existing groups with the same id.
  async function upsertGroups(groups, year) {
    for (const group of groups) {
      await upsertGroup(group, year, { force: true });
    }
  }

  async function deleteGroup(id, year) {
    const group = getGroupsSync(year).find((g) => g.id === id);
    if (!group) return;
    await window.maatwerk.deleteFile(ypGroup(year, id));
    changed();
    // The admin's list is the `__all__` cache; the reference only filtered the
    // subject cache, so the deleted group stayed on screen (quirk U21).
    for (const key of [
      `${year}/groups/${group.subject ?? _activeSubject}`,
      `${year}/groups/__all__`,
    ]) {
      if (cache[key]) cache[key] = cache[key].filter((g) => g.id !== id);
    }
  }

  function getGroupsByJaarlaag(year, jaarlaag) {
    return getGroupsSync(year).filter((g) => String(g.jaarlaag) === String(jaarlaag));
  }

  function getJaarlagenSync(year) {
    const set = new Set(
      getGroupsSync(year)
        .map((g) => String(g.jaarlaag ?? ''))
        .filter(Boolean),
    );
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  async function getJaarlagen(year) {
    await getGroups(year);
    return getJaarlagenSync(year);
  }

  function getStudentGroup(studentId, year) {
    const id = asStudentId(studentId);
    return getGroupsSync(year).find((g) => g.student_ids.includes(id)) ?? null;
  }

  // ── Exams (year-scoped, subject-filtered) ─────────────────────────────────
  async function getExams(year, subject = _activeSubject) {
    return loadExams(year, subject);
  }

  async function upsertExam(exam, year) {
    const subj = exam.subject ?? _activeSubject;
    const { academic_year: _ay, ...clean } = exam;
    const updated = { ...clean, subject: subj };
    const key = `${year}/exams/${subj}`;
    const arr = cache[key] ?? [];
    const i = arr.findIndex((e) => e.id === updated.id);
    let merged = updated;
    if (i >= 0) {
      updated.volgnummer = updated.volgnummer ?? arr[i].volgnummer;
      merged = { ...arr[i], ...updated };
    } else {
      if (!updated.volgnummer) {
        const seq = nextVolgnummer(arr, updated.jaarlaag);
        if (seq !== undefined) updated.volgnummer = seq;
      }
    }
    const saved = await saveEntity(ypExam(year, merged.id), merged, merged._meta?.rev);
    putCachedExam(key, saved);
    return saved;
  }

  function putCachedExam(key, exam) {
    const arr = cache[key] ?? [];
    const i = arr.findIndex((e) => e.id === exam.id);
    if (i >= 0) arr[i] = exam;
    else arr.push(exam);
    cache[key] = arr;
  }

  // The N-term is merged into the latest version on disk without a conflict
  // check: it is a single value, and other edits to the exam must not be lost.
  async function setExamNTerm(examId, nTerm, year, subject = _activeSubject) {
    const saved = await update(ypExam(year, examId), (exam, onDisk) => {
      if (!onDisk) throw new Error(`Toets ${examId} bestaat niet meer.`);
      exam.n_term = nTerm;
      return stampMeta(exam, onDisk);
    });
    putCachedExam(`${year}/exams/${saved.subject ?? subject}`, saved);
    return saved;
  }

  async function deleteExam(id, year) {
    const exam = getExamsSync(year).find((e) => e.id === id);
    if (!exam) return;
    if (examHasResits(id, year)) throw new Error('has_resits');
    await window.maatwerk.deleteFile(ypExam(year, id));
    changed();
    const key = `${year}/exams/${exam.subject ?? _activeSubject}`;
    cache[key] = (cache[key] ?? []).filter((e) => e.id !== id);
  }

  // ── Scores (year-scoped, subject-scoped) ──────────────────────────────────
  async function getStudentScores(studentId, year, subject = _activeSubject) {
    const file = ypScore(year, subject, studentId);
    // A folder read in flight brings this file too (or tells it is absent).
    const folderRead = scoreDirReads.get(`${year}/scores/${subject}`);
    if (folderRead && cache[file] === undefined) await folderRead.catch(() => {});
    return (await load(file)) ?? { student_id: asStudentId(studentId), scores: {} };
  }

  // Apply a change to the latest version of a student's score file on disk, so
  // scores another teacher saved in the meantime (other exams, other cells) are kept.
  async function updateStudentScores(studentId, year, subject, mutator) {
    const file = ypScore(year, subject, studentId);
    cache[file] = await update(
      file,
      (rec) => {
        if (!rec.scores) rec.scores = {};
        mutator(rec);
        return rec;
      },
      () => ({ student_id: asStudentId(studentId), scores: {} }),
    );
    return cache[file];
  }

  // `subject` defaults to the active one; the score grid passes the subject the
  // value was typed in, because its saves are queued (review 3b M1).
  async function setScore(studentId, examId, questionId, value, year, subject = _activeSubject) {
    await updateStudentScores(studentId, year, subject, (rec) => {
      if (!rec.scores[examId]) rec.scores[examId] = {};
      if (value === undefined) delete rec.scores[examId][questionId];
      else rec.scores[examId][questionId] = value;
    });
  }

  // Grade overwritten by the teacher: rec.overrides[examId] = { cijfer, berekend }.
  // `berekend` is the calculated grade (rounded to one decimal, or null) when the
  // override was set, so a later change of the calculated grade can be flagged.
  // cijfer === null removes the override.
  async function setGradeOverride(
    studentId,
    examId,
    cijfer,
    berekend,
    year,
    subject = _activeSubject,
  ) {
    await updateStudentScores(studentId, year, subject, (rec) => {
      if (cijfer === null) {
        if (rec.overrides) delete rec.overrides[examId];
        if (rec.overrides && !Object.keys(rec.overrides).length) delete rec.overrides;
      } else {
        rec.overrides ??= {};
        rec.overrides[examId] = { cijfer, berekend: berekend ?? null };
      }
    });
  }

  async function getStudentHistory(studentId, subject = _activeSubject) {
    const years = listYearsSync();
    const results = [];
    for (const year of years) {
      await loadYear(year, subject);
      const exams = getExamsSync(year, subject);
      const record = await getStudentScores(studentId, year, subject);
      const examIds = new Set([
        ...Object.keys(record.scores ?? {}),
        ...Object.keys(record.overrides ?? {}),
      ]);
      for (const examId of examIds) {
        const exam = exams.find((e) => e.id === examId);
        if (!exam) continue;
        results.push({
          exam: { ...exam, academic_year: year },
          questionScores: record.scores?.[examId] ?? {},
          override: record.overrides?.[examId],
        });
      }
    }
    results.sort(compareHistory);
    return results;
  }

  // RTTI calculations (calcResults, examResults, calcGrade): src/domain/grades.ts

  // examResults per (score record, exam), for the statistics on the list screens
  // (Step 7c). A cached record or exam that changes is replaced, never edited in
  // place, so its identity is its revision; n_term and the question list are
  // checked anyway (the score modal adjusts a copy's n_term). Results are read-only.
  const resultsMemo = new WeakMap();
  function examResultsMemo(rec, exam) {
    if (!rec || typeof rec !== 'object' || !exam) return examResults(rec, exam);
    let perExam = resultsMemo.get(rec);
    if (!perExam) resultsMemo.set(rec, (perExam = new WeakMap()));
    const hit = perExam.get(exam);
    if (hit && hit.nTerm === exam.n_term && hit.questions === exam.questions) return hit.value;
    const value = examResults(rec, exam);
    perExam.set(exam, { nTerm: exam.n_term, questions: exam.questions, value });
    return value;
  }

  // ── Utilities ─────────────────────────────────────────────────────────────
  // New ids are opaque (C10, quirk B26): the title is only data.
  function makeExamId() {
    return makeExamIdFor();
  }

  // ── Observaties (subject-scoped, individual files) ────────────────────────
  async function getObservaties(subject = _activeSubject) {
    return loadObservaties(subject);
  }

  async function upsertObservation(obs, subject = _activeSubject) {
    const subjects =
      Array.isArray(obs.subjects) && obs.subjects.length > 0
        ? obs.subjects
        : obs.subject
          ? [obs.subject]
          : [subject];
    const updated = { ...obs, subjects };
    delete updated.subject;
    await saveEntity(ypObs(updated.id), updated, updated._meta?.rev);
    // Other subjects' caches may be affected too (multi-subject obs), so drop
    // them all and reload the active one so sync getters stay populated.
    invalidateObsCache();
    await loadObservaties(subject);
  }

  async function deleteObservation(id, subject = _activeSubject) {
    await window.maatwerk.deleteFile(ypObs(id));
    changed();
    invalidateObsCache();
    await loadObservaties(subject);
  }

  async function setObservation(studentId, examId, obsId, checked, year, subject = _activeSubject) {
    await updateStudentScores(studentId, year, subject, (rec) => {
      if (!rec.observations) rec.observations = {};
      if (!rec.observations[examId]) rec.observations[examId] = [];
      if (checked) {
        if (!rec.observations[examId].includes(obsId)) rec.observations[examId].push(obsId);
      } else {
        rec.observations[examId] = rec.observations[examId].filter((id) => id !== obsId);
        if (rec.observations[examId].length === 0) delete rec.observations[examId];
      }
    });
  }

  // Every score file of a year and subject in one call (Step 7c): the list
  // screens' statistics need them all, and one IPC call per student kept the
  // main thread busy for seconds. Entries already cached are kept (they may be
  // newer than this read); `ids` without a file are cached as "no file", as a
  // single read would.
  const scoreDirReads = new Map(); // dir -> in-flight read
  async function preloadScores(
    year,
    subject = _activeSubject,
    ids = getStudentsSync(year).map((s) => s.id),
  ) {
    if (!subject) return; // admin without a vak filter: no score folder (review 7c n6)
    const dir = `${year}/scores/${subject}`;
    // Everything cached already (a repeat render): nothing to read (review 7c M3).
    // Absent files are cached as such and refreshed by the watcher like the others.
    if (ids.every((id) => cache[ypScore(year, subject, id)] !== undefined)) return;
    let read = scoreDirReads.get(dir);
    if (!read) {
      read = timed('store:readDir', () => window.maatwerk.readJsonDir(dir)).then((files) =>
        timed('store:decodeDir', () => {
          for (const { name, data } of files) {
            const rel = `${dir}/${name}`;
            if (cache[rel] === undefined) cache[rel] = decode(rel, data);
          }
        }),
      );
      scoreDirReads.set(dir, read);
      void read.finally(() => scoreDirReads.delete(dir)).catch(() => {});
    }
    await read;
    for (const id of ids) {
      const rel = ypScore(year, subject, id);
      if (cache[rel] === undefined) cache[rel] = null;
    }
  }

  // migrate() of the reference (legacy layouts -> per-year -> per-subject) is
  // not ported: no legacy data exists (ADR-0003 C2); Step 7 migrates v1 -> v2.

  async function examHasScores(examId, year, subject = _activeSubject) {
    const students = getStudentsSync(year);
    for (const s of students) {
      const rec = await getStudentScores(s.id, year, subject);
      const exScores = rec?.scores?.[examId];
      if (rec?.overrides?.[examId]) return true;
      if (!exScores) continue;
      if (Object.values(exScores).some((v) => v !== null && v !== undefined)) return true;
    }
    return false;
  }

  async function studentHasScores(studentId, year, subject = _activeSubject) {
    const rec = await getStudentScores(studentId, year, subject);
    if (Object.keys(rec.overrides ?? {}).length) return true;
    return Object.values(rec.scores ?? {}).some((exScores) =>
      Object.values(exScores ?? {}).some((v) => v !== null && v !== undefined),
    );
  }

  // Check all years × all subjects — used by admin to guard deletion.
  async function studentHasAnyScores(studentId) {
    const years = listYearsSync();
    const subjects = Object.keys(SUBJECT_DISPLAY);
    for (const year of years) {
      for (const subject of subjects) {
        if (await studentHasScores(studentId, year, subject)) return true;
      }
    }
    return false;
  }

  function obsIsUsedInAnyExam(obsId) {
    return Object.entries(cache).some(
      ([key, val]) =>
        key.includes('/exams/') &&
        Array.isArray(val) &&
        val.some((e) => (e.obs_ids ?? []).includes(obsId)),
    );
  }

  // ── Resit helpers ─────────────────────────────────────────────────────────
  function getResitsSync(parentId, year, subject = _activeSubject) {
    return resitsOf(getExamsSync(year, subject), parentId);
  }

  function examHasResits(examId, year, subject = _activeSubject) {
    return getExamsSync(year, subject).some((e) => e.parent_id === examId);
  }

  async function computeBestGradeMap(parentId, year, subject = _activeSubject) {
    const parentExam = getExamsSync(year, subject).find((e) => e.id === parentId);
    if (!parentExam) return {};
    const allAttempts = [parentExam, ...getResitsSync(parentId, year, subject)];
    const students = getStudentsSync(year);
    const bestMap = {};
    for (const s of students) {
      const rec = await getStudentScores(s.id, year, subject);
      const bestEntry = bestAttempt(rec, allAttempts);
      if (bestEntry) bestMap[s.id] = bestEntry;
    }
    return bestMap;
  }

  // resolveBestAttempts: src/domain/attempts.ts

  async function removeObsFromExamScores(obsId, examId, year, subject = _activeSubject) {
    const students = getStudentsSync(year);
    await Promise.all(
      students.map(async (s) => {
        const rec = await getStudentScores(s.id, year, subject);
        if (!rec.observations?.[examId]?.includes(obsId)) return;
        await updateStudentScores(s.id, year, subject, (fresh) => {
          const arr = fresh.observations?.[examId];
          if (arr) fresh.observations[examId] = arr.filter((id) => id !== obsId);
        });
      }),
    );
  }

  // ── Opdrachten ────────────────────────────────────────────────────────────

  // One folder per opdracht (C14): opdrachten/<id>/opdracht.json with
  // main.typ, opdracht.typ, lib.typ and images/ next to it.
  const ypOpdracht = (id) => `opdrachten/${id}/opdracht.json`;

  async function loadOpdrachten() {
    if (cache['opdrachten'] !== undefined) return cache['opdrachten'];
    const all = await window.maatwerk.readOpdrachten();
    cache['opdrachten'] = all.filter((o) => o && o.id);
    return cache['opdrachten'];
  }

  function getOpdrachtenSync() {
    return cache['opdrachten'] ?? [];
  }

  async function getOpdrachten() {
    return loadOpdrachten();
  }

  async function upsertOpdracht(opdracht) {
    const baseRev =
      opdracht._meta?.rev ?? getOpdrachtenSync().find((o) => o.id === opdracht.id)?._meta?.rev;
    const { typFile: _v1, ...clean } = opdracht; // v1 field; the text is always opdracht.typ
    await saveEntity(ypOpdracht(opdracht.id), clean, baseRev);
    cache['opdrachten'] = undefined;
    await loadOpdrachten();
  }

  // Copy an opdracht: its folder (Typst files and images; the images are
  // relative to the folder, so no paths change) and a fresh opdracht.json.
  // Returns the new opdracht.
  async function copyOpdracht(id) {
    const original = getOpdrachtenSync().find((o) => o.id === id);
    if (!original) throw new Error('Opdracht niet gevonden.');
    const newId = `opdracht_${Date.now()}`;
    await window.maatwerk.copyOpdrachtFolder(id, newId);
    changed();
    const { _meta, ...rest } = JSON.parse(JSON.stringify(original));
    const copy = { ...rest, id: newId, naam: `${original.naam} (kopie)` };
    await upsertOpdracht(copy);
    return copy;
  }

  async function deleteOpdracht(id) {
    cache['opdrachten'] = undefined;
    await window.maatwerk.deleteFile(ypOpdracht(id));
    changed();
    await window.maatwerk.deleteOpdrachtFolder(id);
    changed();
    await loadOpdrachten();
  }

  // ── Opdrachten genereren (per exam) ───────────────────────────────────────
  // exam.opdrachten = { [obsId]: [opdrachtId, …] } couples the observaties of an
  // exam to remedial opdrachten. Observaties without a saved coupling fall back
  // to the matching opdrachten that list the observatie in their observaties[].

  // Coupling rules: src/domain/opdrachten.ts. These wrappers supply the
  // active subject and the cached opdrachten.
  function opdrachtMatchesExam(opdracht, exam) {
    return opdrachtMatchesExamFor(opdracht, exam, _activeSubject);
  }

  function getOpdrachtCoupling(exam) {
    return opdrachtCoupling(exam, getOpdrachtenSync(), _activeSubject);
  }

  function getOpdrachtCijferCards(exam) {
    return opdrachtCijferCards(exam, getOpdrachtenSync());
  }

  // Saves the coupling (and the grade cards) into the latest version of the exam
  // on disk (like the N-term: only these fields, so other edits are never lost).
  async function setExamOpdrachten(
    examId,
    coupling,
    year,
    subject = _activeSubject,
    cijferCards = [],
  ) {
    const saved = await update(ypExam(year, examId), (exam, onDisk) => {
      if (!onDisk) throw new Error(`Toets ${examId} bestaat niet meer.`);
      exam.opdrachten = coupling;
      if (cijferCards.length) exam.opdrachtenCijfer = cijferCards;
      else delete exam.opdrachtenCijfer;
      return stampMeta(exam, onDisk);
    });
    putCachedExam(`${year}/exams/${saved.subject ?? subject}`, saved);
    return saved;
  }

  /**
   * Who gets which opdracht for `exam`, given `coupling` ({ obsId: [opdrachtId] })
   * and the grade cards `cijferCards` ([{ id, onder, opdrachten }]).
   * Returns {
   *   students: [{ student, group, items: [{ opdracht, obs: [reason, …] }] }]
   *             — only students that receive something, sorted by group then name;
   *             a reason is an observatie or a grade card ({ icon, naam });
   *   obsStudents: { [obsId]: [studentId, …] } — every student with that observatie;
   *   cijferStudents: { [cardId]: [studentId, …] } — every student below that grade.
   * }
   * An opdracht coupled to several reasons of one student is listed once.
   */
  async function getOpdrachtAssignments(exam, year, coupling, cijferCards = []) {
    const subject = exam.subject ?? _activeSubject;
    await Promise.all([
      loadYear(year, subject),
      // A failed folder read falls back to single reads below (review 7c m2).
      preloadScores(year, subject).catch(() => {}),
      getObservaties(subject),
      loadOpdrachten(),
    ]);
    const students = getStudentsSync(year);
    const records = new Map();
    for (const s of students) records.set(s.id, await getStudentScores(s.id, year, subject));
    return assignOpdrachten({
      exam,
      students,
      recordOf: (id) => records.get(id),
      observaties: getObservatiesSync(subject),
      opdrachten: getOpdrachtenSync(),
      groups: getGroupsSync(year, subject),
      coupling,
      cijferCards,
    });
  }

  // ── External changes (other teachers, reported by the watcher in main.js) ──
  // Brings the cache up to date for one changed file and describes the change:
  //   { type, kind, relPath, year, subject, id, before, after, meta, inScope }
  // type: 'scores' | 'exam' | 'group' | 'students' | 'observatie' | 'opdracht'
  //       | 'opdrachtTyp' | 'gebruikers' | 'school' | 'presence' | 'other'
  // Only data that is already cached is re-read; the rest loads lazily as before.
  // inScope: the change concerns the active subject (admin: any) and active year.
  const YEAR = '(\\d{4}-\\d{4})';
  const EXTERNAL_PATTERNS = [
    ['scores', new RegExp(`^${YEAR}/scores/([^/]+)/([^/]+)\\.json$`)],
    ['exam', new RegExp(`^${YEAR}/exams/([^/]+)\\.json$`)],
    ['group', new RegExp(`^${YEAR}/groups/([^/]+)\\.json$`)],
    ['students', new RegExp(`^${YEAR}/students-\\d{4}-\\d{4}\\.json$`)],
    ['observatie', /^observaties\/([^/]+)\.json$/],
    ['opdracht', /^opdrachten\/([^/]+)\/opdracht\.json$/],
    ['opdrachtTyp', /^opdrachten\/([^/]+)\/[^/]+\.typ$/],
    ['gebruikers', /^gebruikers\/([^/]+)\.json$/],
    ['school', /^school\.json$/],
    ['presence', /^users\/([^/]+)\.json$/],
  ];

  // Replace (or remove, when `item` is null) the entry with this id in every
  // loaded cache array whose key starts with prefix; add it to the arrays in
  // `targetKeys` that are loaded but don't contain it yet. Returns the old entry.
  function patchCachedArrays(prefix, id, item, targetKeys) {
    let before = null;
    for (const key of Object.keys(cache)) {
      if (!key.startsWith(prefix) || !Array.isArray(cache[key])) continue;
      const arr = cache[key];
      const i = arr.findIndex((x) => x.id === id);
      if (i < 0) continue;
      before = before ?? arr[i];
      if (item && targetKeys.includes(key)) arr[i] = item;
      else arr.splice(i, 1);
      changed();
    }
    if (item) {
      for (const key of targetKeys) {
        const arr = cache[key];
        if (Array.isArray(arr) && !arr.some((x) => x.id === id)) {
          arr.push(item);
          changed();
        }
      }
    }
    return before;
  }

  async function applyExternalChange({ relPath, kind, meta }) {
    let type = 'other';
    let match = null;
    for (const [t, re] of EXTERNAL_PATTERNS) {
      match = relPath.match(re);
      if (match) {
        type = t;
        break;
      }
    }
    const ev = { type, kind, relPath, meta, year: null, subject: null, id: null };
    ev.before = null;
    ev.after = null;
    const readFresh = async () =>
      kind === 'deleted' ? null : decode(relPath, await window.maatwerk.readJson(relPath));

    // Serialised with own writes to the same file, so a refresh can never put an
    // older version in the cache than one this app just wrote.
    await serialize(relPath, async () => {
      switch (type) {
        case 'scores': {
          [, ev.year, ev.subject, ev.id] = match;
          if (cache[relPath] === undefined) break;
          ev.before = cache[relPath];
          ev.after = await readFresh();
          cache[relPath] = ev.after;
          break;
        }
        case 'exam': {
          [, ev.year, ev.id] = match;
          ev.after = await readFresh();
          const subj = ev.after?.subject;
          ev.before = patchCachedArrays(
            `${ev.year}/exams/`,
            ev.id,
            ev.after,
            subj ? [`${ev.year}/exams/${subj}`] : [],
          );
          ev.subject = subj ?? ev.before?.subject ?? null;
          break;
        }
        case 'group': {
          [, ev.year, ev.id] = match;
          ev.after = await readFresh();
          const subj = ev.after?.subject;
          ev.before = patchCachedArrays(
            `${ev.year}/groups/`,
            ev.id,
            ev.after,
            [subj && `${ev.year}/groups/${subj}`, `${ev.year}/groups/__all__`].filter(Boolean),
          );
          ev.subject = subj ?? ev.before?.subject ?? null;
          break;
        }
        case 'students': {
          ev.year = match[1];
          if (cache[relPath] === undefined) break;
          ev.before = cache[relPath];
          ev.after = (await readFresh()) ?? [];
          cache[relPath] = ev.after;
          break;
        }
        case 'observatie': {
          ev.id = match[1];
          ev.before = getObservatiesSync().find((o) => o.id === ev.id) ?? null;
          ev.after = await readFresh();
          invalidateObsCache();
          if (_activeSubject) await loadObservaties(_activeSubject);
          changed(); // a render between the drop and the reload saw no observaties (review 7c m4)
          break;
        }
        case 'opdracht': {
          ev.id = match[1];
          ev.before = getOpdrachtenSync().find((o) => o.id === ev.id) ?? null;
          ev.after = await readFresh();
          if (cache['opdrachten'] !== undefined) {
            cache['opdrachten'] = undefined;
            await loadOpdrachten();
            changed(); // as for observaties (review 7c m4)
          }
          break;
        }
        case 'opdrachtTyp':
          ev.id = match[1];
          break;
        case 'presence':
          ev.id = match[1];
          ev.after = await readFresh();
          break;
        case 'gebruikers': {
          ev.id = match[1];
          ev.after = await readFresh();
          ev.before = (cache['gebruikers'] ?? []).find((u) => u.id === ev.id) ?? null;
          const users = cache['gebruikers'];
          if (users) {
            const i = users.findIndex((u) => u.id === ev.id);
            if (i >= 0 && ev.after) users[i] = ev.after;
            else if (i >= 0) users.splice(i, 1);
            else if (ev.after) users.push(ev.after);
            changed();
          }
          break;
        }
        case 'school':
          if (cache[relPath] === undefined) break;
          ev.before = cache[relPath];
          ev.after = await readFresh();
          cache[relPath] = ev.after;
          break;
      }
    });

    // `generation` grew above only where cached data changed (review 7c M2): a
    // colleague's save in another vak or of an unread file keeps the kept screens.
    ev.inScope = changeIsInScope(ev);
    return ev;
  }

  function changeIsInScope(ev) {
    if (ev.year && ev.year !== getConfigSync().activeYear) return false;
    if (!_activeSubject) return true; // admin (or not logged in): every subject
    if (ev.type === 'observatie') {
      return [ev.before, ev.after].some((o) => o && obsMatchesSubject(o, _activeSubject));
    }
    return !ev.subject || ev.subject === _activeSubject;
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    applyExternalChange,
    /** Grows whenever cached data changes (own writes, external changes). */
    generation: () => generation,
    invalidateSchool,
    preload,
    initSubject,
    loadYear,
    preloadScores,
    listYearsSync,
    getConfigSync,
    getStudentsSync,
    getGroupsSync,
    getExamsSync,
    getObservatiesSync,
    getActiveSubject,
    setActiveSubject,
    getActiveUser,
    setActiveUser,
    getActiveRole,
    isVoorzitterActive,
    voorzitterOf,
    isAdminActive,
    loadUsers,
    upsertUser,
    cacheUser,
    forgetFile,
    loadSchool,
    updateSchool,
    loadInstellingen,
    saveInstellingen,
    getSchoolSync,
    saveLastSession,
    loadLastSession,
    saveFilterState,
    loadFilterState,
    SUBJECT_DISPLAY,
    subjectFromGroupName,
    parseGroupName,
    getConfig,
    setActiveYear,
    loadVersioned,
    saveVersioned,
    currentSchoolYear,
    fullName,
    jaarlaagFromStamklas,
    sortStudents,
    getStudents,
    upsertStudent,
    upsertStudents,
    deleteStudent,
    getGroups,
    upsertGroup,
    upsertGroups,
    deleteGroup,
    getGroupsByJaarlaag,
    getJaarlagenSync,
    getJaarlagen,
    getStudentGroup,
    getExams,
    upsertExam,
    setExamNTerm,
    deleteExam,
    getStudentScores,
    setScore,
    getStudentHistory,
    calcResults,
    examResults: examResultsMemo,
    calcGrade,
    setGradeOverride,
    makeExamId,
    makeGroupId,
    getObservaties,
    upsertObservation,
    deleteObservation,
    setObservation,
    examHasScores,
    studentHasScores,
    studentHasAnyScores,
    obsIsUsedInAnyExam,
    removeObsFromExamScores,
    getResitsSync,
    examHasResits,
    computeBestGradeMap,
    resolveBestAttempts,
    getOpdrachtenSync,
    getOpdrachten,
    upsertOpdracht,
    copyOpdracht,
    deleteOpdracht,
    opdrachtMatchesExam,
    getOpdrachtCoupling,
    getOpdrachtCijferCards,
    cijferCardReason,
    setExamOpdrachten,
    getOpdrachtAssignments,
  };
})();

export { Store };

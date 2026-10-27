// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * store.js — Central data access layer.
 *
 * Per-subject file layout:
 *
 *   data/
 *   ├── config.json                          { activeYear }
 *   ├── observaties/
 *   │   └── <obsId>.json                     { id, naam, icon, jaarlagen[], subject }
 *   └── YYYY-YYYY/
 *       ├── students-YYYY-YYYY.json          [{ id, voornaam, … }]
 *       ├── exams/
 *       │   └── <examId>.json                { id, subject, title, jaarlaag, … }
 *       ├── groups/
 *       │   └── <groupId>.json               { id, subject, name, jaarlaag, student_ids[] }
 *       └── scores/
 *           ├── nat/  bio/  schk/  wi/
 *           │   └── <studentId>.json
 *
 * Subject field inside each JSON file is authoritative (not derived from path).
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

const Store = (() => {
  // ── Cache ─────────────────────────────────────────────────────────────────
  // Exam/group/obs entries keyed as: `${year}/exams/${subject}`, `obs/${subject}`, etc.
  const cache = {};
  let _years = null;
  let _activeSubject = null;
  let _activeUser = null;

  async function load(relPath) {
    if (cache[relPath] !== undefined) return cache[relPath];
    const data = await window.maatwerk.readJson(relPath);
    cache[relPath] = data;
    return data;
  }

  async function save(relPath, data) {
    cache[relPath] = data;
    const result = await window.maatwerk.writeJson(relPath, data);
    if (!result?.ok) throw new Error(`Save failed for ${relPath}: ${result?.reason}`);
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
        const next = mutator(read.data ?? fallback(), read.data);
        const result = await window.maatwerk.writeJson(relPath, next, {
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
  function setActiveUser(user) {
    _activeUser = user;
  }
  function getActiveUser() {
    return _activeUser;
  }
  function isAdminActive() {
    return _activeUser?.isAdmin === true;
  }

  // ── Users ──────────────────────────────────────────────────────────────────
  async function loadUsers() {
    return (await load('gebruikers.json')) ?? [];
  }

  // ── School ─────────────────────────────────────────────────────────────────
  async function loadSchool() {
    return await load('school.json');
  }

  async function saveSchool(data) {
    await save('school.json', data);
  }

  async function upsertUser(user) {
    cache['gebruikers.json'] = await update(
      'gebruikers.json',
      (users) => {
        const idx = users.findIndex((u) => u.id === user.id);
        if (idx >= 0) users[idx] = user;
        else users.push(user);
        return users;
      },
      () => [],
    );
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
    const cfg = await getConfig();
    cfg.activeYear = year;
    await save('config.json', cfg);
  }

  // currentSchoolYear: src/domain/ids.ts

  // ── Student helpers ───────────────────────────────────────────────────────
  // fullName, jaarlaagFromStamklas, sortStudents: src/domain/ids.ts

  // ── Students (year-scoped) ────────────────────────────────────────────────
  async function getStudents(year) {
    return (await load(ypStudents(year))) ?? [];
  }

  async function saveStudents(list, year) {
    sortStudents(list);
    await save(ypStudents(year), list);
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
      id: student.id,
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
    await updateStudents(year, (list) => list.filter((s) => s.id !== id));
  }

  // ── Groups (year-scoped, subject-filtered) ────────────────────────────────
  async function getGroups(year, subject = isAdminActive() ? null : _activeSubject) {
    return loadGroups(year, subject);
  }

  async function upsertGroup(group, year, { force = false } = {}) {
    const subj = group.subject ?? subjectFromGroupName(group.name) ?? _activeSubject;
    const { academic_year: _ay, ...clean } = group;
    const updated = { ...clean, subject: subj };
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
    const key = `${year}/groups/${group.subject ?? _activeSubject}`;
    cache[key] = (cache[key] ?? []).filter((g) => g.id !== id);
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
    return getGroupsSync(year).find((g) => g.student_ids.includes(studentId)) ?? null;
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
    const key = `${year}/exams/${exam.subject ?? _activeSubject}`;
    cache[key] = (cache[key] ?? []).filter((e) => e.id !== id);
  }

  // ── Scores (year-scoped, subject-scoped) ──────────────────────────────────
  async function getStudentScores(studentId, year, subject = _activeSubject) {
    const file = ypScore(year, subject, studentId);
    return (await load(file)) ?? { student_id: studentId, scores: {} };
  }

  async function saveStudentScores(record, year, subject = _activeSubject) {
    const file = ypScore(year, subject, record.student_id);
    invalidate(file);
    await save(file, record);
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
      () => ({ student_id: studentId, scores: {} }),
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

  // ── Utilities ─────────────────────────────────────────────────────────────
  function makeExamId(title, year, subject = _activeSubject) {
    return makeExamIdFor(title, year, subject);
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

  async function preloadScores(year, subject = _activeSubject) {
    const students = getStudentsSync(year);
    await Promise.all(students.map((s) => getStudentScores(s.id, year, subject)));
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

  async function loadOpdrachten() {
    if (cache['opdrachten'] !== undefined) return cache['opdrachten'];
    const all = await window.maatwerk.readAllJson('opdrachten');
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
    await saveEntity(`opdrachten/${opdracht.id}.json`, opdracht, baseRev);
    cache['opdrachten'] = undefined;
    await loadOpdrachten();
  }

  // Copy an opdracht with its Typst file and images; image paths in the copy
  // point to the copy's own images folder. Returns the new opdracht.
  async function copyOpdracht(id) {
    const original = getOpdrachtenSync().find((o) => o.id === id);
    if (!original) throw new Error('Opdracht niet gevonden.');
    const newId = `opdracht_${Date.now()}`;
    const typFile = `${newId}.typ`;
    const content = original.typFile
      ? await window.maatwerk.readTextFile(`opdrachten/${original.typFile}`)
      : null;
    if (content == null) await window.maatwerk.createAssignmentTypFile(typFile);
    else
      await window.maatwerk.writeTextFile(
        `opdrachten/${typFile}`,
        content.split(`images/${id}/`).join(`images/${newId}/`),
      );
    await window.maatwerk.copyOpdrachtImages(id, newId);
    const { _meta, ...rest } = JSON.parse(JSON.stringify(original));
    const copy = { ...rest, id: newId, naam: `${original.naam} (kopie)`, typFile };
    await upsertOpdracht(copy);
    return copy;
  }

  async function deleteOpdracht(id) {
    const opdracht = getOpdrachtenSync().find((o) => o.id === id);
    cache['opdrachten'] = undefined;
    await window.maatwerk.deleteFile(`opdrachten/${id}.json`);
    if (opdracht?.typFile) {
      await window.maatwerk.deleteFile(`opdrachten/${opdracht.typFile}`);
    }
    await window.maatwerk.deleteOpdrachtImages(id);
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
      preloadScores(year, subject),
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
    ['opdracht', /^opdrachten\/([^/]+)\.json$/],
    ['opdrachtTyp', /^opdrachten\/([^/]+)\.typ$/],
    ['gebruikers', /^gebruikers\.json$/],
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
    }
    if (item) {
      for (const key of targetKeys) {
        const arr = cache[key];
        if (Array.isArray(arr) && !arr.some((x) => x.id === id)) arr.push(item);
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
    const readFresh = async () => (kind === 'deleted' ? null : window.maatwerk.readJson(relPath));

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
          break;
        }
        case 'opdracht': {
          ev.id = match[1];
          ev.before = getOpdrachtenSync().find((o) => o.id === ev.id) ?? null;
          ev.after = await readFresh();
          if (cache['opdrachten'] !== undefined) {
            cache['opdrachten'] = undefined;
            await loadOpdrachten();
          }
          break;
        }
        case 'opdrachtTyp':
        case 'presence':
          ev.id = match[1];
          ev.after = await readFresh();
          break;
        case 'gebruikers':
        case 'school':
          if (cache[relPath] === undefined) break;
          ev.before = cache[relPath];
          ev.after = await readFresh();
          cache[relPath] = ev.after;
          break;
      }
    });

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
    isAdminActive,
    loadUsers,
    upsertUser,
    loadSchool,
    saveSchool,
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
    currentSchoolYear,
    fullName,
    jaarlaagFromStamklas,
    sortStudents,
    getStudents,
    saveStudents,
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
    saveStudentScores,
    setScore,
    getStudentHistory,
    calcResults,
    examResults,
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

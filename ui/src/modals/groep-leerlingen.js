// SPDX-License-Identifier: AGPL-3.0-or-later

// ── Group students modal ──────────────────────────────────────────────────────
import {
  showModal,
  closeModal,
  escHtml,
  formatGrade,
  onModalSync,
  showReloadNotice,
  changedByName,
  modalRefresher,
} from '../app.js';
import { examTypeColor, isFail } from '../utils/colors.js';
import { gradeTextColor, gradeBorderColor } from '../utils/grades.js';
import { openProfielModal } from './profiel.js';

// The version of one student in a students-file change (before, after), as JSON.
function studentVersions(ev, id) {
  const find = (list) => JSON.stringify((list ?? []).find((s) => s.id === id) ?? null);
  return [find(ev.before), find(ev.after)];
}

// Grade pill of an average; colours via style data (src/legacy/style-data.ts).
function gradePill(g) {
  const fail = isFail(g) ? ' grade-pill--fail' : '';
  return `<span class="grade-pill${fail}" data-border-color="${gradeBorderColor(g)}" data-color="${gradeTextColor(g)}">${formatGrade(g)}</span>`;
}

export async function openGroupStudentsModal(groupId, year) {
  const group = Store.getGroupsSync(year).find((g) => g.id === groupId);
  if (!group) return;
  const allStudents = Store.getStudentsSync(year);
  const students = allStudents
    .filter((s) => group.student_ids.includes(s.id))
    .sort((a, b) => (a.achternaam ?? '').localeCompare(b.achternaam ?? ''));

  // All exams for this jaarlaag with a volgnummer, sorted (current year — for column display)
  const exams = Store.getExamsSync(year)
    .filter((e) => String(e.jaarlaag) === String(group.jaarlaag ?? '') && e.volgnummer)
    .sort((a, b) => (a.volgnummer ?? 0) - (b.volgnummer ?? 0));

  // Group into families: one column per original exam, with resits attached
  const _resitMap = {};
  exams
    .filter((e) => e.parent_id)
    .forEach((e) => {
      (_resitMap[e.parent_id] ??= []).push(e);
    });
  const examFamilies = exams
    .filter((e) => !e.parent_id)
    .map((e) => ({
      original: e,
      resits: (_resitMap[e.id] ?? []).sort((a, b) => (a.attempt ?? 1) - (b.attempt ?? 1)),
    }));

  // Load current-year scores for grade cells
  const scoreMap = {};
  for (const s of students) {
    const rec = await Store.getStudentScores(s.id, year);
    scoreMap[s.id] = rec;
  }

  // Per-student dossier (SE) average from full history — mirrors openProfielModal
  const dossierAvgMap = {};
  for (const s of students) {
    const history = Store.resolveBestAttempts(await Store.getStudentHistory(s.id));
    const ptaResults = history.filter((h) => h.exam.type === 'pta');
    let sumW = 0,
      sumWG = 0;
    for (const { exam, questionScores, override } of ptaResults) {
      const res = Store.calcResults(exam, questionScores, override);
      if (res.grade === null) continue;
      const w = Number(exam.weging_se ?? exam.weging ?? 1);
      sumW += w;
      sumWG += w * res.grade;
    }
    dossierAvgMap[s.id] = sumW > 0 ? sumWG / sumW : null;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function studentGrade(s, exam) {
    return Store.examResults(scoreMap[s.id], exam)?.grade ?? null;
  }

  function bestGradeForFamily(s, family) {
    const candidates = [family.original, ...family.resits]
      .map((e) => ({ exam: e, grade: studentGrade(s, e) }))
      .filter((x) => x.grade !== null);
    if (candidates.length === 0) return { grade: null, exam: null };
    return candidates.reduce((a, b) => (b.grade > a.grade ? b : a));
  }

  function calcWeightedAvg(pairs) {
    // pairs: [{grade, weging}]
    let sumW = 0,
      sumWG = 0;
    for (const { grade, weging } of pairs) {
      if (grade === null) continue;
      const w = Number(weging ?? 1);
      sumW += w;
      sumWG += w * grade;
    }
    return sumW > 0 ? sumWG / sumW : null;
  }

  // ── Group exams by Periode ─────────────────────────────────────────────────
  const periodes = [...new Set(examFamilies.map((f) => f.original.periode ?? '—'))].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true }),
  );
  const byPeriode = periodes.map((p) => ({
    p,
    families: examFamilies.filter((f) => (f.original.periode ?? '—') === p),
  }));

  // ── Header rows ────────────────────────────────────────────────────────────
  const yearShort = year
    .split('-')
    .map((y) => y.slice(-2))
    .join('');
  // Row 1: Naam | Periode N (colspan) | ... | Jaar | PTA
  // The reference gave these headers a second style="" (border-right per
  // periode, border-left on Gemiddelde); browsers ignore a duplicate attribute,
  // so only .gl-th ever applied. Kept as rendered (quirk U18).
  const nameTh = `<th rowspan="2" class="gl-name-th">Naam</th>`;

  const periodeCols =
    byPeriode
      .map(
        ({ p, families }) =>
          `<th colspan="${families.reduce((sum, f) => sum + 2, 0)}" class="gl-th">
      Periode ${escHtml(String(p))}</th>`,
      )
      .join('') + `<th colspan="2" class="gl-th">Gemiddelde</th>`;

  // Row 2: exam badges per periode | Jaar | Dossier
  const examBadgeCols =
    byPeriode
      .map(({ families }, pi) =>
        families
          .map(
            (f, fi) =>
              `<th class="u-text-right u-p-4-6 u-border-b-2">
        <span class="volgnummer u-text-center u-mr-0" data-bg="${examTypeColor(f.original)}">${f.original.volgnummer}</span></th>
        <th class="gl-badge-th${fi === families.length - 1 ? ' u-border-r-light' : ''}"></th>`,
          )
          .join(''),
      )
      .join('') +
    `<th class="u-text-center u-p-4-6 u-border-b-2 u-border-l-2 u-fs-11 u-fw-600 u-text-muted u-nowrap">${yearShort}</th>` +
    `<th class="u-text-center u-p-4-6 u-border-b-2 u-fs-11 u-fw-600 u-text-muted u-nowrap">SE</th>`;

  // ── Student rows ───────────────────────────────────────────────────────────
  const rows = students
    .map((s, si) => {
      const rowBg = si % 2 === 0 ? 'gl-bg-even' : 'gl-bg-odd';

      const nameCell = `<td class="gl-name-td ${rowBg}">
      <button class="u-fs-13 student-name-btn group-name-btn" data-action="open-student-from-group"
        data-id="${s.id}" data-groupid="${escHtml(groupId)}" data-year="${escHtml(year)}"
       >${escHtml(Store.fullName(s))}</button>
      <span class="u-mx-4 card-sep">·</span>
      <span class="student-id-inline">${s.id}</span></td>`;

      const examCells = byPeriode
        .map(({ families }, pi) =>
          families
            .map((f, fi) => {
              const { grade: g, exam: fromExam } = bestGradeForFamily(s, f);
              const label = g !== null ? formatGrade(g) : '—';
              const bc = gradeBorderColor(g);
              const tc = gradeTextColor(g);
              const fw = g !== null && isFail(g) ? 'bold' : '500';
              const borderR = fi === families.length - 1 ? ' u-border-r-light' : '';
              const badgeLetter = fromExam?.parent_id
                ? (fromExam.description ?? '').trim().charAt(0).toUpperCase() || '?'
                : '';
              const badgeCell =
                `<td class="gl-badge-td ${rowBg}${borderR}">` +
                (badgeLetter
                  ? `<span class="attempt-badge" title="${(fromExam.description ?? '').trim()}">${badgeLetter}</span>`
                  : '') +
                `</td>`;
              return (
                `<td class="gl-grade-td ${rowBg}">` +
                `<span class="grade-pill grade-pill--wide${fw === 'bold' ? ' grade-pill--fail' : ''}" data-border-color="${bc}" data-color="${tc}">${label}</span></td>` +
                badgeCell
              );
            })
            .join(''),
        )
        .join('');

      // Weighted averages
      const yearPairs = examFamilies.map((f) => ({
        grade: bestGradeForFamily(s, f).grade,
        weging: f.original.weging,
      }));
      const yearAvg = calcWeightedAvg(yearPairs);
      const dossierAvg = dossierAvgMap[s.id];

      const avgCells =
        `<td class="gl-avg-td u-border-l-2 ${rowBg}">${
          yearAvg !== null ? gradePill(yearAvg) : `<span class="u-text-faint">—</span>`
        }</td>` +
        `<td class="gl-avg-td ${rowBg}">${
          dossierAvg !== null ? gradePill(dossierAvg) : `<span class="u-text-faint">—</span>`
        }</td>`;

      return `<tr>${nameCell}${examCells}${avgCells}</tr>`;
    })
    .join('');

  // ── Averages footer row ────────────────────────────────────────────────────
  const avgRowExamCells = byPeriode
    .map(({ families }) =>
      families
        .map((f, fi) => {
          const grades = students
            .map((s) => bestGradeForFamily(s, f).grade)
            .filter((g) => g !== null);
          const avg = grades.length > 0 ? grades.reduce((a, b) => a + b, 0) / grades.length : null;
          const label = avg !== null ? formatGrade(avg) : '—';
          const bc = gradeBorderColor(avg);
          const tc = gradeTextColor(avg);
          const fw = avg !== null && isFail(avg) ? 'bold' : '500';
          const borderR = fi === families.length - 1 ? ' u-border-r-light' : '';
          return (
            `<td class="u-text-right u-p-3-4 u-bg-highlight">` +
            `<span class="grade-pill grade-pill--wide${fw === 'bold' ? ' grade-pill--fail' : ''}" data-border-color="${bc}" data-color="${tc}">${label}</span></td>` +
            `<td class="u-bg-highlight${borderR}"></td>`
          );
        })
        .join(''),
    )
    .join('');

  const yearAvgs = students
    .map((s) => {
      const pairs = examFamilies.map((f) => ({
        grade: bestGradeForFamily(s, f).grade,
        weging: f.original.weging,
      }));
      return calcWeightedAvg(pairs);
    })
    .filter((g) => g !== null);
  const yearAvgOfAvgs =
    yearAvgs.length > 0 ? yearAvgs.reduce((a, b) => a + b, 0) / yearAvgs.length : null;

  const seAvgs = students.map((s) => dossierAvgMap[s.id]).filter((g) => g !== null);
  const seAvgOfAvgs = seAvgs.length > 0 ? seAvgs.reduce((a, b) => a + b, 0) / seAvgs.length : null;

  const avgRowSummary =
    `<td class="u-text-center u-p-3-4 u-bg-highlight u-border-l-2">${
      yearAvgOfAvgs !== null ? gradePill(yearAvgOfAvgs) : `<span class="u-text-faint">—</span>`
    }</td>` +
    `<td class="u-text-center u-p-3-4 u-bg-highlight">${
      seAvgOfAvgs !== null ? gradePill(seAvgOfAvgs) : `<span class="u-text-faint">—</span>`
    }</td>`;

  const avgRow =
    `<tr class="u-border-t-2">` +
    `<td class="gl-foot-label">Gemiddelde</td>` +
    avgRowExamCells +
    avgRowSummary +
    `</tr>`;

  showModal(
    `
    <h3>${escHtml(group.name)}</h3>
    <p class="u-mb-10 muted">${students.length} leerlingen &mdash; klik een naam om het leerlingprofiel te openen</p>
    <div class="u-overflow-x-auto">
      <table class="u-collapse u-w-full u-fs-13">
        <thead>
          <tr>${nameTh}${periodeCols}</tr>
          <tr>${examBadgeCols}</tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>${avgRow}</tfoot>
      </table>
    </div>
  `,
    (el) => {
      // Background changes: new scores and exam edits refresh this overview
      // silently; changes to the group or its students need a notice.
      const reopen = () => openGroupStudentsModal(groupId, year);
      const refresh = modalRefresher(reopen);
      onModalSync('scores', (ev) => {
        if (ev.year !== year || ev.subject !== Store.getActiveSubject()) return;
        if (group.student_ids.some((id) => String(id) === ev.id)) refresh();
      });
      onModalSync('exam', (ev) => {
        if (ev.year === year) refresh();
      });
      onModalSync('group', async (ev) => {
        if (ev.id !== groupId || ev.year !== year) return;
        const who = await changedByName(ev);
        if (!ev.after) showReloadNotice(`Deze groep is verwijderd door ${who}.`, closeModal);
        else {
          showReloadNotice(
            `Deze groep is gewijzigd door ${who}. Het venster wordt opnieuw geladen.`,
            reopen,
          );
        }
      });
      onModalSync('students', (ev) => {
        if (ev.year !== year) return;
        const changed = group.student_ids.some((id) => {
          const [before, after] = studentVersions(ev, id);
          return before !== after;
        });
        if (!changed) return;
        showReloadNotice(
          'Leerlinggegevens zijn gewijzigd door een collega. Het venster wordt opnieuw geladen.',
          reopen,
        );
      });

      el.querySelectorAll('[data-action="open-student-from-group"]').forEach((b) =>
        b.addEventListener('click', () =>
          openProfielModal(
            Number(b.dataset.id),
            () => openGroupStudentsModal(b.dataset.groupid, b.dataset.year),
            students,
          ),
        ),
      );
    },
    true,
  ); // wide modal
}

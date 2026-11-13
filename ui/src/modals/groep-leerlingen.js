// SPDX-License-Identifier: AGPL-3.0-or-later

// ── Group students modal ──────────────────────────────────────────────────────
import {
  openModal,
  closeModal,
  escHtml,
  onModalSync,
  showReloadNotice,
  changedByName,
  modalRefresher,
} from '../app.js';
import { testBadgeClass } from '../domain/test-type';
import { bestAttempt } from '../domain/attempts';
import { mean, meanOfAverages, seAverage } from '../domain/statistics';
import { gradePillHtml } from '../utils/grades';
import { openProfielModal } from './profiel.js';

// The version of one student in a students-file change (before, after), as JSON.
function studentVersions(ev, id) {
  const find = (list) => JSON.stringify((list ?? []).find((s) => s.id === id) ?? null);
  return [find(ev.before), find(ev.after)];
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

  // Per-student dossier (SE) average from the full history (decision 10).
  const dossierAvgMap = {};
  for (const s of students) {
    const history = await Store.getStudentHistory(s.id);
    dossierAvgMap[s.id] = seAverage(history, Store.getAllExamsSync());
  }
  // All the student's tests of the year, also without a column here (decision 25).
  const yearAvgOf = (s) => Store.studentYearAverage(scoreMap[s.id], year);

  // ── Helpers ────────────────────────────────────────────────────────────────
  function bestGradeForFamily(s, family) {
    const best = bestAttempt(scoreMap[s.id], [family.original, ...family.resits]);
    return best ? { grade: best.grade, exam: best.exam } : { grade: null, exam: null };
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
  // A line after every periode and before Gemiddelde, as the columns below
  // have them (V-02; the reference meant these but never showed them, quirk U18).
  const nameTh = `<th rowspan="2" class="gl-name-th">Naam</th>`;

  const periodeCols =
    byPeriode
      .map(
        ({ p, families }) =>
          `<th colspan="${families.reduce((sum, f) => sum + 2, 0)}" class="gl-th u-border-r-light">
      Periode ${escHtml(String(p))}</th>`,
      )
      .join('') + `<th colspan="2" class="gl-th u-border-l-2">Gemiddelde</th>`;

  // Row 2: exam badges per periode | Jaar | Dossier
  const examBadgeCols =
    byPeriode
      .map(({ families }, pi) =>
        families
          .map(
            (f, fi) =>
              `<th class="u-text-right u-p-4-6 u-border-b-2">
        <span class="${testBadgeClass(f.original)}">${f.original.volgnummer}</span></th>
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
        data-id="${escHtml(s.id)}" data-groupid="${escHtml(groupId)}" data-year="${escHtml(year)}"
       >${escHtml(Store.fullName(s))}</button>
      <span class="u-mx-4 card-sep">·</span>
      <span class="student-id-inline">${escHtml(s.id)}</span></td>`;

      const examCells = byPeriode
        .map(({ families }, pi) =>
          families
            .map((f, fi) => {
              const { grade: g, exam: fromExam } = bestGradeForFamily(s, f);
              const borderR = fi === families.length - 1 ? ' u-border-r-light' : '';
              const badgeLetter = fromExam?.parent_id
                ? (fromExam.description ?? '').trim().charAt(0).toUpperCase() || '?'
                : '';
              const badgeCell =
                `<td class="gl-badge-td ${rowBg}${borderR}">` +
                (badgeLetter
                  ? `<span class="attempt-badge" title="${escHtml((fromExam.description ?? '').trim())}">${escHtml(badgeLetter)}</span>`
                  : '') +
                `</td>`;
              return (
                `<td class="gl-grade-td ${rowBg}">` +
                `${gradePillHtml(g, 'grade-pill--wide')}</td>` +
                badgeCell
              );
            })
            .join(''),
        )
        .join('');

      // Weighted averages
      const yearAvg = yearAvgOf(s);
      const dossierAvg = dossierAvgMap[s.id];

      const avgCells =
        `<td class="gl-avg-td u-border-l-2 ${rowBg}">${
          yearAvg !== null ? gradePillHtml(yearAvg) : `<span class="u-text-faint">—</span>`
        }</td>` +
        `<td class="gl-avg-td ${rowBg}">${
          dossierAvg !== null ? gradePillHtml(dossierAvg) : `<span class="u-text-faint">—</span>`
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
          const avg = mean(grades);
          const borderR = fi === families.length - 1 ? ' u-border-r-light' : '';
          return (
            `<td class="u-text-right u-p-3-4 u-bg-highlight">` +
            `${gradePillHtml(avg, 'grade-pill--wide')}</td>` +
            `<td class="u-bg-highlight${borderR}"></td>`
          );
        })
        .join(''),
    )
    .join('');

  // Decision 21: the means of the year and SE averages as shown.
  const yearAvgOfAvgs = meanOfAverages(students.map(yearAvgOf).filter((g) => g !== null));
  const seAvgOfAvgs = meanOfAverages(
    students.map((s) => dossierAvgMap[s.id]).filter((g) => g !== null),
  );

  const avgRowSummary =
    `<td class="u-text-center u-p-3-4 u-bg-highlight u-border-l-2">${
      yearAvgOfAvgs !== null ? gradePillHtml(yearAvgOfAvgs) : `<span class="u-text-faint">—</span>`
    }</td>` +
    `<td class="u-text-center u-p-3-4 u-bg-highlight">${
      seAvgOfAvgs !== null ? gradePillHtml(seAvgOfAvgs) : `<span class="u-text-faint">—</span>`
    }</td>`;

  const avgRow =
    `<tr class="u-border-t-2">` +
    `<td class="gl-foot-label">Gemiddelde</td>` +
    avgRowExamCells +
    avgRowSummary +
    `</tr>`;

  openModal({
    title: group.name,
    subtitle: `${students.length} leerlingen · klik een naam om het leerlingprofiel te openen`,
    size: 'xl',
    key: 'group-overview',
    fixedHeight: true,
    body: `
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
    onShow: (el) => {
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
          // Stacks on this overview: closing the profile returns here.
          openProfielModal(b.dataset.id, students),
        ),
      );
    },
  }); // wide modal
}

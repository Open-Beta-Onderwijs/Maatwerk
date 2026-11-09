// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  GRADE_BAR,
  gradeBarColor,
  gradeCellColor,
  pctBarColor,
  rttiPctCellColor,
} from '../domain/grade-colors';
import { formatFixed, formatGrade, formatNumber, parseDecimalLoose } from '../domain/format';
import {
  boxStats,
  histogram,
  pooledRtti,
  questionStats,
  rttiByGradeGroup,
  rttiPercents,
  stats,
  studentGroup,
} from '../domain/statistics';
import { round0 } from '../domain/core';
import { chartInk } from '../theme';
import { gradeGroupIdx, GRADE_GROUP_LABELS, GRADE_GROUP_MIDPOINTS } from '../utils/grades';
import {
  openModal,
  closeModal,
  escHtml,
  pushModalChart,
  onModalSync,
  showReloadNotice,
  modalRefresher,
} from '../app.js';
import { examGroups, groupStudentsOf } from '../screens/scores.js';

const GROUP_PALETTE = [
  '#4A90D9',
  '#E8823A',
  '#2ECC71',
  '#9B59B6',
  '#E67E22',
  '#1ABC9C',
  '#E74C3C',
  '#F39C12',
];

/** @param {Record<string, any> | null} [scoreOverride] per student: the attempt that counts */
export async function openExamOverviewModal(
  examId,
  year,
  scoreOverride = null,
  isSummary = false,
  initialTab = 'resultaten',
) {
  const all = await Store.getExams(year);
  const exam = all.find((e) => e.id === examId);
  if (!exam) return;

  const RTTI_CATS = ['R', 'T1', 'T2', 'I'];
  const students = Store.getStudentsSync(year);
  const grades = [];
  // Every student's attempt, read with its own questions (decision 17, B14).
  const attempts = [];

  const groups = Store.getGroupsSync(year);
  const groupsById = new Map(groups.map((g) => [g.id, g]));
  const groupOf = (s) => groupsById.get(studentGroup(s.id, exam, groups));
  const groupStatsMap = new Map();

  // The class's points per question of this exam, for the charts per question.
  const qStatsOf = (list) => {
    const byId = new Map(questionStats(list).map((s) => [s.question, s.points]));
    return exam.questions.map((q) => ({
      q,
      totalScored: byId.get(q.id)?.scored ?? 0,
      totalMax: byId.get(q.id)?.max ?? 0,
    }));
  };
  const hasPoints = (list) => questionStats(list).some((s) => s.points.max > 0);

  const allObs = Store.getObservatiesSync();
  // The summary also lists what only an attempt has (migrated resits: original's + own).
  const allAttempts = isSummary ? [exam, ...Store.getResitsSync(exam.id, year)] : [exam];
  const examObsIds = [...new Set(allAttempts.flatMap((e) => e.obs_ids ?? []))];
  const examObsObjects = examObsIds.map((id) => allObs.find((o) => o.id === id)).filter(Boolean);
  // obsAccum[obsId] = { count, byGroup: {groupId: n}, byGradeGroup: [6] }
  const obsAccum = {};
  for (const o of examObsObjects) {
    obsAccum[o.id] = { count: 0, byGroup: {}, byGradeGroup: Array(6).fill(0) };
  }
  // studentData[studentId] = { examScores, studentObs, overrideEntry, gradeOverride }
  // for the Resultaten tab (gradeOverride: grade overwritten by the teacher)
  const studentData = new Map();

  for (const s of students) {
    const rec = await Store.getStudentScores(s.id, year);
    const overrideEntry = scoreOverride ? (scoreOverride[s.id] ?? null) : null;
    // overrideEntry may be { questionScores, exam, grade } (from computeBestGradeMap)
    let examScores = overrideEntry
      ? (overrideEntry.questionScores ?? overrideEntry)
      : rec?.scores?.[exam.id];
    const gradeOverride = overrideEntry ? overrideEntry.override : rec?.overrides?.[exam.id];
    // Track observations even if no scores. In the summary: those of the attempt that counts,
    // like the grade (B-05); without a grade no attempt counts, so those of all of them.
    const studentObs = overrideEntry?.exam
      ? (rec?.observations?.[overrideEntry.exam.id] ?? [])
      : [...new Set(allAttempts.flatMap((e) => rec?.observations?.[e.id] ?? []))];
    const grpForObs = groupOf(s);
    studentData.set(String(s.id), { examScores, studentObs, overrideEntry, gradeOverride });
    if ((!examScores || Object.keys(examScores).length === 0) && !gradeOverride) {
      for (const obsId of studentObs) {
        if (!obsAccum[obsId]) continue;
        obsAccum[obsId].count++;
        if (grpForObs)
          obsAccum[obsId].byGroup[grpForObs.id] = (obsAccum[obsId].byGroup[grpForObs.id] ?? 0) + 1;
      }
      continue;
    }
    examScores ??= {};

    // The attempt that counts is read with its own questions, not the original's (B14).
    const evalExam = overrideEntry?.exam ?? exam;
    const qs = {};
    evalExam.questions.forEach((q) => {
      const v = examScores[q.id];
      if (v !== undefined) qs[q.id] = v;
    });
    // Use pre-computed grade from bestMap if available, otherwise calculate it.
    let grade = overrideEntry?.grade ?? null;
    if (grade === null && (Object.keys(qs).length > 0 || gradeOverride)) {
      const res = Store.calcResults(evalExam, qs, gradeOverride);
      if (res.grade !== null) grade = res.grade;
    }
    if (grade !== null) grades.push(grade);
    const attempt = { exam: evalExam, questionScores: qs, grade };
    attempts.push(attempt);

    if (grpForObs) {
      if (!groupStatsMap.has(grpForObs.id)) {
        groupStatsMap.set(grpForObs.id, { group: grpForObs, grades: [], attempts: [] });
      }
      const entry = groupStatsMap.get(grpForObs.id);
      if (grade !== null) entry.grades.push(grade);
      entry.attempts.push(attempt);
    }

    for (const obsId of studentObs) {
      if (!obsAccum[obsId]) continue;
      obsAccum[obsId].count++;
      if (grpForObs)
        obsAccum[obsId].byGroup[grpForObs.id] = (obsAccum[obsId].byGroup[grpForObs.id] ?? 0) + 1;
      if (grade !== null) obsAccum[obsId].byGradeGroup[gradeGroupIdx(grade)]++;
    }
  }

  const qStats = qStatsOf(attempts);
  const rttiAccum = rttiByGradeGroup(attempts).map((group) => RTTI_CATS.map((c) => group[c]));
  const hasGrades = grades.length > 0;
  const hasQStats = hasPoints(attempts);
  const groupEntries = [...groupStatsMap.values()]
    .filter((e) => hasPoints(e.attempts))
    .map((e) => ({ ...e, qStats: qStatsOf(e.attempts) }))
    .sort((a, b) => a.group.name.localeCompare(b.group.name));
  const hasGroupData = groupEntries.length > 0;
  const hasRttiData = rttiAccum.some((grp) => grp.some((cat) => cat.max > 0));
  const hasObsData = examObsObjects.length > 0 && Object.values(obsAccum).some((a) => a.count > 0);

  let summaryHtml = '<p class="u-m-0 hint">Nog geen scores ingevoerd.</p>';
  if (hasGrades) {
    const { mean, sd, fails } = stats(grades);
    const dot = `<svg width="10" height="10" viewBox="0 0 10 10" class="u-align-middle u-mx-3 u-shrink-0"><circle cx="5" cy="5" r="5" fill="${gradeBarColor(mean)}"/></svg>`;
    summaryHtml = `<span class="u-d-flex u-items-center u-flex-wrap u-gap-0 muted">${grades.length} leerlingen &nbsp;·&nbsp; ${dot} ${formatFixed(mean)} ± ${formatFixed(sd)} &nbsp;·&nbsp; ${fails}% onvoldoende</span>`;
  }

  const qChartHeight = Math.max(180, exam.questions.length * 22 + 60);
  const groupQHeight = hasGroupData ? Math.round(qChartHeight * groupEntries.length * 0.8) : 0;

  // Build a 2-column grid of group chart containers with card styling
  function groupGrid(idFn, heightPx) {
    if (!hasGroupData) return '';
    let html = '';
    const card = (j) =>
      `<div class="u-flex-1 u-min-w-0 u-border u-rounded u-p-8 u-bg-surface">` +
      `<div class="u-relative" data-h="${heightPx}px"><canvas id="${idFn(j)}"></canvas></div></div>`;
    for (let i = 0; i < groupEntries.length; i += 2) {
      html += `<div class="u-d-flex u-gap-14 u-mb-14">${card(i)}${
        i + 1 < groupEntries.length ? card(i + 1) : '<div class="u-flex-1 u-min-w-0"></div>'
      }</div>`;
    }
    return html;
  }

  // ── Resultaten tab: one table per group, students ordered like the score grid ──
  function resultatenHtml() {
    const fmtNum = formatNumber;
    const resObs = [...examObsObjects].sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
    // Fixed column widths, so every group's table lines up; Naam takes the rest.
    // The badge column (best attempt was a resit) only exists in the resit summary.
    const COL_W = { totaal: 85, cijfer: 50, badge: 26, obs: 32, rtti: 50 };
    const cols = [
      COL_W.totaal,
      COL_W.cijfer,
      ...(isSummary ? [COL_W.badge] : []),
      ...resObs.map(() => COL_W.obs),
      ...RTTI_CATS.map(() => COL_W.rtti),
    ];
    const colgroup = `<colgroup><col />${cols.map((w) => `<col data-w="${w}px" />`).join('')}</colgroup>`;
    const tableMinWidth = 200 + cols.reduce((a, b) => a + b, 0);
    const studentRow = (s) => {
      const d = studentData.get(String(s.id)) ?? {};
      const scores = d.examScores ?? {};
      const evalExam = d.overrideEntry?.exam ?? exam;
      const qs = {};
      evalExam.questions.forEach((q) => {
        if (scores[q.id] !== undefined) qs[q.id] = scores[q.id];
      });
      const hasScores = Object.keys(qs).length > 0;
      const res =
        hasScores || d.gradeOverride ? Store.calcResults(evalExam, qs, d.gradeOverride) : null;
      const grade = d.overrideEntry?.grade ?? res?.grade ?? null;

      const totaal = hasScores
        ? `${fmtNum(res.scored)} / ${fmtNum(res.normalMax)}${res.hasBonus && res.scored > res.normalMax ? ' (+)' : ''}`
        : '';
      const gradeTxt = grade !== null ? formatGrade(grade) : '';
      // Same badge as the Groepen overview: first letter of the resit's description.
      const attempt = d.overrideEntry?.exam;
      const badgeCell = !isSummary
        ? ''
        : attempt?.parent_id
          ? (() => {
              const desc = (attempt.description ?? '').trim();
              const letter = desc.charAt(0).toUpperCase() || '?';
              return `<td><span class="attempt-badge" title="${escHtml(desc)}">${escHtml(letter)}</span></td>`;
            })()
          : '<td></td>';

      const obsCells = resObs
        .map((o, i) => {
          const marked = (d.studentObs ?? []).includes(o.id);
          return `<td class="${i === 0 ? 'res-sep' : ''}"${marked ? ` title="${escHtml(o.naam)}"` : ''}>${marked ? escHtml(o.icon) : ''}</td>`;
        })
        .join('');

      const rttiCells = RTTI_CATS.map((cat, i) => {
        const v = hasScores ? res[cat] : null;
        const text = v == null ? '' : v === 'NVT' ? 'NVT' : `${v}%`;
        const bg = rttiPctCellColor(text && text !== 'NVT' ? parseDecimalLoose(text) : null);
        return `<td class="${i === 0 ? 'res-sep' : ''}"${bg ? ` data-bg="${bg}"` : ''}>${text}</td>`;
      }).join('');

      const gbg = gradeCellColor(gradeTxt ? parseDecimalLoose(gradeTxt) : null);
      const overridden = !!res?.overridden;
      const gradeTitle = overridden
        ? `Met de hand overschreven cijfer. Berekend cijfer: ${formatGrade(res.calculatedGrade)}.` +
          (res.overrideStale ? '\nHet berekende cijfer is gewijzigd sinds het overschrijven.' : '')
        : '';
      const gradeClass = `res-grade${overridden ? ' grade-override' : ''}${res?.overrideStale ? ' grade-override-stale' : ''}`;
      return (
        `<tr><td class="res-name">${escHtml(Store.fullName(s))}</td>` +
        `<td class="res-sep">${totaal}</td>` +
        `<td class="${gradeClass}"${gbg ? ` data-bg="${gbg}"` : ''}${gradeTitle ? ` title="${escHtml(gradeTitle)}"` : ''}>${gradeTxt}</td>${badgeCell}` +
        `${obsCells}${rttiCells}</tr>`
      );
    };

    const head =
      `<tr><th class="res-name">Naam</th>` +
      `<th class="res-sep">Totaal</th><th>Cijfer</th>${isSummary ? '<th></th>' : ''}` +
      resObs
        .map(
          (o, i) =>
            `<th class="${i === 0 ? 'res-sep' : ''}" title="${escHtml(o.naam)}">${escHtml(o.icon)}</th>`,
        )
        .join('') +
      RTTI_CATS.map((c, i) => `<th class="${i === 0 ? 'res-sep' : ''}">${c}%</th>`).join('') +
      `</tr>`;

    const sections = examGroups(exam, year)
      .map((g) => {
        const gStudents = groupStudentsOf(g, students);
        if (gStudents.length === 0) return '';
        return (
          `<h3 class="group-heading">${escHtml(g.name)}</h3>` +
          `<div class="results-table-wrap"><table class="results-table" data-min-w="${tableMinWidth}px">${colgroup}<thead>${head}</thead>` +
          `<tbody>${gStudents.map(studentRow).join('')}</tbody></table></div>`
        );
      })
      .join('');
    return sections || '<p class="hint">Geen groepen gevonden voor deze toets.</p>';
  }

  const onlyIndividual =
    'Dit tabblad is alleen beschikbaar voor individuele toetsen, niet voor het verzameloverzicht.';
  const tabs = [
    { id: 'resultaten', label: 'Resultaten' },
    { id: 'cijferverdeling', label: 'Cijferverdeling' },
    { id: 'boxplots', label: 'Boxplot cijfers' },
    { id: 'vraaganalyse', label: 'Vraaganalyse' },
    { id: 'rtti-analyse', label: 'RTTI-analyse' },
    { id: 'observaties', label: 'Observaties' },
  ].map((t, i) => (isSummary && i >= 3 ? { ...t, disabled: true, title: onlyIndividual } : t));

  let switchTabRef = null; // set by initOverview; the dialog calls onTab on open
  const dialog = openModal({
    key: 'exam-overview',
    title: `Overzicht: ${exam.title}`,
    subtitle: `Jaarlaag ${exam.jaarlaag} · ${year}`,
    size: 'lg',
    fixedHeight: true,
    className: 'modal-overview',
    bodyClass: 'dlg-body--tinted',
    tabs,
    activeTab: initialTab,
    body: `
    <div class="u-mb-10">${summaryHtml}</div>

    <div class="tab-pane" id="tab-resultaten">
      ${resultatenHtml()}
    </div>

    <div class="tab-pane hidden" id="tab-cijferverdeling">
      ${
        hasGrades
          ? `
        <div class="u-border u-rounded u-p-panel u-mb-20 u-bg-surface">
          <div class="u-h-200 u-relative u-mb-12"><canvas id="chart-hist"></canvas></div>
          <div class="u-d-flex u-justify-end u-items-center u-gap-8">
            <span class="u-fs-13 u-text-muted">Stapgrootte:</span>
            <div class="btn-toggle-group">
              <button class="u-min-w-90 tog-btn hist-bin-btn selected" data-bin="0.5">0,5 punten</button>
              <button class="u-min-w-90 tog-btn hist-bin-btn" data-bin="1">1 punt</button>
            </div>
          </div>
        </div>
        ${groupGrid((i) => `chart-hist-grp-${i}`, 150)}
      `
          : '<p class="hint">Nog geen scores ingevoerd.</p>'
      }
    </div>

    <div class="tab-pane hidden" id="tab-boxplots">
      ${
        hasGrades
          ? `
        <div class="u-border u-rounded u-p-10 u-bg-surface">
          <div class="u-relative" data-h="${Math.max(200, (groupEntries.length + 1) * 55 + 60)}px">
            <canvas id="chart-box-combined"></canvas>
          </div>
        </div>
      `
          : '<p class="hint">Nog geen scores ingevoerd.</p>'
      }
    </div>

    <div class="tab-pane hidden" id="tab-vraaganalyse">
      ${
        hasQStats
          ? `
        <div class="u-border u-rounded u-p-8 u-mb-16 u-bg-surface">
          <div class="u-relative" data-h="${qChartHeight}px"><canvas id="chart-q-all"></canvas></div>
        </div>
        ${
          hasGroupData
            ? `
          <div class="u-border u-rounded u-p-8 u-bg-surface">
            <div class="u-relative" data-h="${groupQHeight}px"><canvas id="chart-q-groups"></canvas></div>
          </div>
        `
            : ''
        }
      `
          : '<p class="hint">Geen vraagdata beschikbaar.</p>'
      }
    </div>

    <div class="tab-pane hidden" id="tab-rtti-analyse">
      ${
        hasRttiData
          ? `
        <div class="u-border u-rounded u-p-10 u-mb-16 u-bg-surface">
          <div class="u-h-240 u-relative"><canvas id="chart-rtti"></canvas></div>
        </div>
        <div class="u-border u-rounded u-p-10 u-mb-16 u-bg-surface">
          <div class="u-h-240 u-relative"><canvas id="chart-rtti-groups"></canvas></div>
        </div>
        <div id="rtti-history-container"><p class="u-m-0 hint">Laden\u2026</p></div>
      `
          : '<p class="hint">Geen RTTI data beschikbaar.</p>'
      }
    </div>

    <div class="tab-pane hidden" id="tab-observaties">
      ${
        examObsObjects.length === 0
          ? '<p class="hint">Geen observaties gekoppeld aan deze toets.</p>'
          : !hasObsData
            ? '<p class="hint">Nog geen observaties ingevoerd voor deze toets.</p>'
            : `
        <div class="u-border u-rounded u-p-10 u-mb-16 u-bg-surface">
          <div class="u-h-220 u-relative"><canvas id="chart-obs-hist"></canvas></div>
        </div>
        ${
          hasGroupData
            ? `
        <div class="u-border u-rounded u-p-10 u-mb-16 u-bg-surface">
          <div class="u-h-220 u-relative"><canvas id="chart-obs-groups"></canvas></div>
        </div>
        `
            : ''
        }
        <div class="u-border u-rounded u-p-10 u-mb-16 u-bg-surface">
          <div class="u-h-220 u-relative"><canvas id="chart-obs-grades"></canvas></div>
        </div>
      `
      }
    </div>
    `,
    onTab: (id) => switchTabRef?.(id),
  });
  initOverview(dialog.body);

  function initOverview(el) {
    const qLabels = exam.questions.map((q) =>
      q.section ? `${q.section}${q.number}` : String(q.number),
    );

    // ── Inline data-label plugins ─────────────────────────────────────────
    // Shows count/value above vertical bars (skips zero or very short bars)
    const dlAbove = {
      id: '_dlAbove',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        chart.data.datasets.forEach((ds, i) => {
          chart.getDatasetMeta(i).data.forEach((bar, j) => {
            const v = ds.data[j];
            if (v == null || v === 0) return;
            if (bar.y >= bar.base - 12) return;
            ctx.save();
            ctx.fillStyle = chartInk().text;
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(String(v), bar.x, bar.y - 1);
            ctx.restore();
          });
        });
      },
    };

    // Same as dlAbove but appends '%'
    const dlAbovePct = {
      id: '_dlAbovePct',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        chart.data.datasets.forEach((ds, i) => {
          chart.getDatasetMeta(i).data.forEach((bar, j) => {
            const v = ds.data[j];
            if (v == null) return;
            const isZero = v === 0;
            if (!isZero && bar.y >= bar.base - 12) return;
            ctx.save();
            ctx.fillStyle = chartInk().text;
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(v + '%', bar.x, isZero ? bar.base - 4 : bar.y - 1);
            ctx.restore();
          });
        });
      },
    };

    // NVT support: grey half-height bar + 'NVT' label; otherwise shows 'X%'
    const NVT_CLR = '#c0c8d4';
    const dlAbovePctNvt = {
      id: '_dlAbovePctNvt',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        chart.data.datasets.forEach((ds, i) => {
          chart.getDatasetMeta(i).data.forEach((bar, j) => {
            const v = ds.data[j];
            if (v == null) return;
            const isNvt = ds.nvtArr?.[j] === true;
            if (!isNvt && (v === 0 || bar.y >= bar.base - 12)) return;
            ctx.save();
            ctx.fillStyle = isNvt ? chartInk().disabled : chartInk().text;
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(isNvt ? 'NVT' : v + '%', bar.x, bar.y - 1);
            ctx.restore();
          });
        });
      },
    };

    // Shows 'X%' to the right of horizontal bars (skips very short bars)
    const dlRight = {
      id: '_dlRight',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        chart.data.datasets.forEach((ds, i) => {
          chart.getDatasetMeta(i).data.forEach((bar, j) => {
            const v = ds.data[j];
            if (v == null) return;
            if (bar.x <= bar.base + 8) return;
            ctx.save();
            ctx.fillStyle = chartInk().text;
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(v + '%', bar.x + 3, bar.y);
            ctx.restore();
          });
        });
      },
    };

    // Shared: nudges legend up so it doesn't overlap chart area
    const lgUp = {
      id: '_lgUp',
      afterLayout(chart) {
        const lg = chart.legend;
        if (!lg) return;
        lg.top -= 10;
        lg.bottom -= 10;
      },
    };

    // ── Histogram helpers ─────────────────────────────────────────────────
    function makeHistBins(step, gradeArr) {
      const start = step === 0.5 ? 1.0 : 0.5;
      const { bins, upper, passBin: passBinIndex } = histogram(gradeArr, step);
      const binLabels = upper.map(
        (bound, i) => (i === upper.length - 1 ? '\u2264' : '<') + formatFixed(bound),
      );
      const barColors = bins.map((_, i) => gradeBarColor(start + (i + 0.5) * step));
      return { data: bins, binLabels, barColors, passBinIndex };
    }

    function buildHistChart(canvas, bins, title) {
      return new Chart(canvas, {
        type: 'bar',
        plugins: [dlAbove],
        data: {
          labels: bins.binLabels,
          datasets: [
            {
              data: bins.data,
              backgroundColor: bins.barColors,
              borderRadius: 3,
              borderSkipped: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            title: { display: true, text: title, font: { size: 13 }, padding: { bottom: 14 } },
            annotation: {
              annotations: {
                passLine: {
                  type: 'line',
                  xMin: bins.passBinIndex - 0.5,
                  xMax: bins.passBinIndex - 0.5,
                  borderColor: chartInk().muted,
                  borderWidth: 2,
                  borderDash: [4, 4],
                },
              },
            },
          },
          scales: {
            x: { ticks: { font: { size: 10 }, maxRotation: 0, minRotation: 0 } },
            y: {
              beginAtZero: true,
              ticks: { stepSize: 1, precision: 0 },
              afterFit(s) {
                s.paddingTop = 35;
              },
            },
          },
        },
      });
    }

    // ── Boxplot helpers ───────────────────────────────────────────────────
    function makeBoxPlugin(statsArr, colors) {
      return {
        id: '_box',
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          const meta = chart.getDatasetMeta(0);
          statsArr.forEach((stats, i) => {
            if (!stats) return;
            const bar = meta.data[i];
            if (!bar) return;
            const rawH = bar.height > 0 ? bar.height : chart.chartArea.height / statsArr.length;
            const bh = Math.min(rawH * 0.55, 60);
            const capH = bh * 0.35;
            const xS = chart.scales.x;
            const y = bar.y;
            const xMin = xS.getPixelForValue(stats.min);
            const xMax = xS.getPixelForValue(stats.max);
            const xQ1 = xS.getPixelForValue(stats.q1);
            const xQ3 = xS.getPixelForValue(stats.q3);
            const xMed = xS.getPixelForValue(stats.median);
            const color = colors[i] || '#4A90D9';
            ctx.save();
            ctx.strokeStyle = color;
            ctx.fillStyle = color + '44';
            ctx.lineWidth = 1.5;
            // IQR box (horizontal)
            ctx.fillRect(xQ1, y - bh / 2, xQ3 - xQ1, bh);
            ctx.strokeRect(xQ1, y - bh / 2, xQ3 - xQ1, bh);
            // Median line (vertical)
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(xMed, y - bh / 2);
            ctx.lineTo(xMed, y + bh / 2);
            ctx.stroke();
            // Whiskers (horizontal) + caps (vertical)
            ctx.lineWidth = 1.5;
            [
              [xQ1, xMin],
              [xQ3, xMax],
            ].forEach(([from, to]) => {
              ctx.beginPath();
              ctx.moveTo(from, y);
              ctx.lineTo(to, y);
              ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(to, y - capH / 2);
              ctx.lineTo(to, y + capH / 2);
              ctx.stroke();
            });
            // Value labels above each key position
            ctx.font = '9px sans-serif';
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            const yt = y - bh / 2 - 2;
            [
              [xMin, stats.min],
              [xQ1, stats.q1],
              [xMed, stats.median],
              [xQ3, stats.q3],
              [xMax, stats.max],
            ].forEach(([xPos, val]) => ctx.fillText(formatFixed(val), xPos, yt));
            ctx.restore();
          });
        },
      };
    }

    function buildBoxChart(canvas, labels, gradeArrays, colors, title) {
      const statsArr = gradeArrays.map(boxStats);
      return new Chart(canvas, {
        type: 'bar',
        plugins: [makeBoxPlugin(statsArr, colors)],
        data: {
          labels,
          datasets: [
            {
              data: statsArr.map((s) => (s ? s.median : null)),
              backgroundColor: 'transparent',
              borderColor: 'transparent',
              borderWidth: 0,
            },
          ],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            title: { display: !!title, text: title ?? '', font: { size: 13 } },
            annotation: {},
          },
          scales: {
            x: { min: 0, max: 11, ticks: { stepSize: 1 } },
            y: {
              ticks: { font: { size: 11 } },
              afterFit(s) {
                s.paddingTop = 18;
              },
            },
          },
        },
      });
    }

    // ── % correct chart helper ────────────────────────────────────────────
    function buildQChart(canvas, pcts, title) {
      const colors = pcts.map((p) => {
        return pctBarColor(p);
      });
      return new Chart(canvas, {
        type: 'bar',
        plugins: [dlRight],
        data: {
          labels: qLabels,
          datasets: [{ data: pcts, backgroundColor: colors, borderRadius: 3 }],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            title: { display: true, text: title, font: { size: 13 } },
          },
          scales: {
            x: {
              beginAtZero: true,
              max: 100,
              ticks: { callback: (v) => v + '%', font: { size: 10 } },
              afterFit(s) {
                s.paddingRight = 35;
              },
            },
            y: { ticks: { font: { size: 10 } } },
          },
        },
      });
    }

    // ── Tab: Cijferverdeling ──────────────────────────────────────────────
    function initCijferverdeling() {
      if (!hasGrades) return;
      let histChart = null;
      function renderHistogram(step) {
        if (histChart) {
          histChart.destroy();
          histChart = null;
        }
        const canvas = el.querySelector('#chart-hist');
        if (!canvas) return;
        histChart = buildHistChart(canvas, makeHistBins(step, grades), 'Cijferverdeling');
        pushModalChart(histChart);
      }
      renderHistogram(0.5);
      el.querySelectorAll('.hist-bin-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          el.querySelectorAll('.hist-bin-btn').forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
          renderHistogram(parseFloat(btn.dataset.bin));
        });
      });
      groupEntries.forEach((entry, i) => {
        const canvas = el.querySelector(`#chart-hist-grp-${i}`);
        if (!canvas || !entry.grades.length) return;
        pushModalChart(buildHistChart(canvas, makeHistBins(1, entry.grades), entry.group.name));
      });
    }

    // ── Tab: Boxplots ─────────────────────────────────────────────────────
    function initBoxplots() {
      if (!hasGrades) return;
      const canvas = el.querySelector('#chart-box-combined');
      if (!canvas) return;
      const labels = ['Alle', ...groupEntries.map((e) => e.group.name)];
      const gradeArrays = [grades, ...groupEntries.map((e) => e.grades)];
      const colors = [
        '#9e9e9e',
        ...groupEntries.map((_, i) => GROUP_PALETTE[i % GROUP_PALETTE.length]),
      ];
      pushModalChart(buildBoxChart(canvas, labels, gradeArrays, colors, null));
    }

    // ── Tab: Vraaganalyse ─────────────────────────────────────────────────
    function initVraaganalyse() {
      if (!hasQStats) return;
      const qPcts = qStats.map((s) =>
        s.totalMax > 0 ? round0((s.totalScored / s.totalMax) * 100) : null,
      );
      const allCanvas = el.querySelector('#chart-q-all');
      if (allCanvas)
        pushModalChart(buildQChart(allCanvas, qPcts, '% correct \u2014 alle leerlingen'));
      if (hasGroupData) {
        const groupsCanvas = el.querySelector('#chart-q-groups');
        if (groupsCanvas) {
          pushModalChart(
            new Chart(groupsCanvas, {
              type: 'bar',
              plugins: [dlRight],
              data: {
                labels: qLabels,
                datasets: groupEntries.map((entry, i) => ({
                  label: entry.group.name,
                  data: entry.qStats.map((s) =>
                    s.totalMax > 0 ? round0((s.totalScored / s.totalMax) * 100) : null,
                  ),
                  backgroundColor: GROUP_PALETTE[i % GROUP_PALETTE.length],
                  borderRadius: 2,
                })),
              },
              options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    display: true,
                    position: 'top',
                    labels: { font: { size: 11 }, boxWidth: 12, padding: 10 },
                  },
                  title: { display: true, text: '% correct per groep', font: { size: 13 } },
                },
                scales: {
                  x: {
                    beginAtZero: true,
                    max: 100,
                    ticks: { callback: (v) => v + '%', font: { size: 10 } },
                    afterFit(s) {
                      s.paddingRight = 35;
                    },
                  },
                  y: { ticks: { font: { size: 10 } } },
                },
              },
            }),
          );
        }
      }
    }

    // ── Tab: RTTI-analyse ─────────────────────────────────────────────────
    function initRttiAnalyse() {
      // generateLabels that always uses the dataset's intended color, ignoring per-bar NVT grey
      const rttiGenLabels = (chart) =>
        chart.data.datasets.map((ds, i) => ({
          text: ds.label,
          fillStyle: ds._legendColor,
          strokeStyle: 'transparent',
          lineWidth: 0,
          borderRadius: 2,
          hidden: !chart.isDatasetVisible(i),
          datasetIndex: i,
        }));

      // Draws a thin 2 px coloured line at the baseline for bars with value === 0
      const zeroBar = {
        id: '_zeroBar',
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          chart.data.datasets.forEach((ds, i) => {
            const meta = chart.getDatasetMeta(i);
            if (meta.hidden) return;
            meta.data.forEach((bar, j) => {
              if (ds.data[j] !== 0) return;
              const color = Array.isArray(ds.backgroundColor)
                ? ds.backgroundColor[j]
                : ds.backgroundColor;
              ctx.save();
              ctx.fillStyle = color;
              ctx.fillRect(bar.x - bar.width / 2, bar.base - 2, bar.width, 2);
              ctx.restore();
            });
          });
        },
      };

      // Chart 1: RTTI per cijfergroep (synchronous)
      const rttiCanvas = el.querySelector('#chart-rtti');
      if (rttiCanvas && hasRttiData) {
        pushModalChart(
          new Chart(rttiCanvas, {
            type: 'bar',
            plugins: [dlAbovePct, lgUp, zeroBar],
            data: {
              labels: RTTI_CATS,
              datasets: GRADE_GROUP_LABELS.map((label, gi) => ({
                label,
                data: RTTI_CATS.map((_, ci) => {
                  const { scored, max } = rttiAccum[gi][ci];
                  return max > 0 ? round0((scored / max) * 100) : null;
                }),
                backgroundColor:
                  gi === 0 ? GRADE_BAR.deepFail : gradeBarColor(GRADE_GROUP_MIDPOINTS[gi]),
                borderRadius: 2,
              })),
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  display: true,
                  position: 'top',
                  labels: { font: { size: 11 }, boxWidth: 12, padding: 10 },
                },
                title: { display: true, text: 'RTTI-scores per cijfergroep', font: { size: 13 } },
              },
              scales: {
                x: { ticks: { font: { size: 12 } } },
                y: {
                  beginAtZero: true,
                  max: 100,
                  ticks: { callback: (v) => v + '%' },
                  afterFit(s) {
                    s.paddingTop = 35;
                  },
                },
              },
            },
          }),
        );
      }

      // Chart 2: RTTI per groep (synchronous)
      const rttiGroupsCanvas = el.querySelector('#chart-rtti-groups');
      if (rttiGroupsCanvas && hasQStats) {
        const rttiPctsFor = (list) => rttiPercents(pooledRtti(list), RTTI_CATS);
        const mkDs = (label, pcts, color) => ({
          label,
          data: pcts.map((v) => (v === null ? 50 : v)),
          backgroundColor: pcts.map((v) => (v === null ? NVT_CLR : color)),
          borderRadius: 2,
          nvtArr: pcts.map((v) => v === null),
          _legendColor: color,
        });
        const rttiColors = ['#5cb85c', '#5bc0de', '#f0ad4e', '#d9534f'];
        const groupSources = [
          { label: 'Alle', pcts: rttiPctsFor(attempts) },
          ...groupEntries.map((entry) => ({
            label: entry.group.name,
            pcts: rttiPctsFor(entry.attempts),
          })),
        ];
        pushModalChart(
          new Chart(rttiGroupsCanvas, {
            type: 'bar',
            plugins: [dlAbovePctNvt, lgUp],
            data: {
              labels: groupSources.map((s) => s.label),
              datasets: RTTI_CATS.map((cat, ci) =>
                mkDs(
                  cat,
                  groupSources.map((s) => s.pcts[ci]),
                  rttiColors[ci],
                ),
              ),
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  display: true,
                  position: 'top',
                  labels: {
                    font: { size: 11 },
                    boxWidth: 12,
                    padding: 10,
                    generateLabels: rttiGenLabels,
                  },
                },
                title: { display: true, text: 'RTTI-scores per groep', font: { size: 13 } },
              },
              scales: {
                x: { ticks: { font: { size: 12 } } },
                y: {
                  beginAtZero: true,
                  max: 100,
                  ticks: { callback: (v) => v + '%' },
                  afterFit(s) {
                    s.paddingTop = 35;
                  },
                },
              },
            },
          }),
        );
      }

      // Chart 3: RTTI comparison across exams in this year (async, uses cached scores)
      (async () => {
        const container = el.querySelector('#rtti-history-container');
        if (!container) return;
        const allExams = await Store.getExams(year);
        const examRttiRows = [];
        for (const ex of allExams.filter((ex) => String(ex.jaarlaag) === String(exam.jaarlaag))) {
          const entries = [];
          for (const s of students) {
            const rec = await Store.getStudentScores(s.id, year);
            const exScores = rec?.scores?.[ex.id];
            if (exScores) entries.push({ exam: ex, questionScores: exScores });
          }
          const pcts = rttiPercents(pooledRtti(entries), RTTI_CATS);
          if (pcts.some((p) => p !== null)) examRttiRows.push({ title: ex.title, id: ex.id, pcts });
        }
        if (!el.isConnected) return;
        if (!examRttiRows.length) {
          container.innerHTML = '<p class="hint">Geen data voor vergelijking.</p>';
          return;
        }
        container.innerHTML =
          '<div class="u-border u-rounded u-p-10 u-bg-surface"><div class="u-h-240 u-relative"><canvas id="chart-rtti-history"></canvas></div></div>';
        const histCanvas = el.querySelector('#chart-rtti-history');
        if (!histCanvas) return;
        const RTTI_PALETTE = ['#5cb85c', '#5bc0de', '#f0ad4e', '#d9534f'];
        pushModalChart(
          new Chart(histCanvas, {
            type: 'bar',
            plugins: [dlAbovePctNvt, lgUp],
            data: {
              labels: examRttiRows.map((ex) => ex.title),
              datasets: RTTI_CATS.map((cat, ci) => {
                const raw = examRttiRows.map((ex) => ex.pcts[ci]);
                return {
                  label: cat,
                  data: raw.map((v) => (v === null ? 50 : v)),
                  backgroundColor: raw.map((v) => (v === null ? NVT_CLR : RTTI_PALETTE[ci])),
                  borderRadius: 2,
                  nvtArr: raw.map((v) => v === null),
                  _legendColor: RTTI_PALETTE[ci],
                };
              }),
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  display: true,
                  position: 'top',
                  labels: {
                    font: { size: 11 },
                    boxWidth: 12,
                    padding: 10,
                    generateLabels: rttiGenLabels,
                  },
                },
                title: { display: true, text: 'RTTI-scores per toets', font: { size: 13 } },
              },
              scales: {
                x: {
                  ticks: {
                    maxRotation: 30,
                    color: (ctx) =>
                      examRttiRows[ctx.index]?.id === exam.id ? '#4a90d9' : undefined,
                    font: (ctx) => ({
                      size: 11,
                      weight: examRttiRows[ctx.index]?.id === exam.id ? 'bold' : 'normal',
                    }),
                  },
                },
                y: {
                  beginAtZero: true,
                  max: 100,
                  ticks: { callback: (v) => v + '%' },
                  afterFit(s) {
                    s.paddingTop = 35;
                  },
                },
              },
            },
          }),
        );
      })();
    }

    // ── Tab: Observaties ──────────────────────────────────────────────────
    function initObservaties() {
      if (!hasObsData) return;
      const obsLabels = examObsObjects.map((o) => `${o.icon} ${o.naam}`);
      const obsCounts = examObsObjects.map((o) => obsAccum[o.id]?.count ?? 0);
      const obsBarColors = examObsObjects.map((_, i) => GROUP_PALETTE[i % GROUP_PALETTE.length]);

      // Chart 1: histogram
      const histCanvas = el.querySelector('#chart-obs-hist');
      if (histCanvas) {
        pushModalChart(
          new Chart(histCanvas, {
            type: 'bar',
            plugins: [dlAbove, lgUp],
            data: {
              labels: obsLabels,
              datasets: [{ data: obsCounts, backgroundColor: obsBarColors, borderRadius: 3 }],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                title: { display: true, text: 'Observaties', font: { size: 13 } },
              },
              scales: {
                x: { ticks: { font: { size: 11 }, maxRotation: 20 } },
                y: {
                  beginAtZero: true,
                  ticks: { stepSize: 1, precision: 0 },
                  afterFit(s) {
                    s.paddingTop = 30;
                  },
                },
              },
            },
          }),
        );
      }

      // Chart 2: per group
      if (hasGroupData) {
        const grpCanvas = el.querySelector('#chart-obs-groups');
        if (grpCanvas) {
          pushModalChart(
            new Chart(grpCanvas, {
              type: 'bar',
              plugins: [dlAbove, lgUp],
              data: {
                labels: obsLabels,
                datasets: groupEntries.map((entry, i) => ({
                  label: entry.group.name,
                  data: examObsObjects.map((o) => obsAccum[o.id]?.byGroup[entry.group.id] ?? 0),
                  backgroundColor: GROUP_PALETTE[i % GROUP_PALETTE.length],
                  borderRadius: 2,
                })),
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    display: true,
                    position: 'top',
                    labels: { font: { size: 11 }, boxWidth: 12, padding: 10 },
                  },
                  title: { display: true, text: 'Observaties per groep', font: { size: 13 } },
                },
                scales: {
                  x: { ticks: { font: { size: 11 }, maxRotation: 20 } },
                  y: {
                    beginAtZero: true,
                    ticks: { stepSize: 1, precision: 0 },
                    afterFit(s) {
                      s.paddingTop = 30;
                    },
                  },
                },
              },
            }),
          );
        }
      }

      // Chart 3: per cijfergroep (same structure as RTTI-per-cijfergroep)
      const gradeCanvas = el.querySelector('#chart-obs-grades');
      if (gradeCanvas) {
        pushModalChart(
          new Chart(gradeCanvas, {
            type: 'bar',
            plugins: [dlAbove, lgUp],
            data: {
              labels: obsLabels,
              datasets: GRADE_GROUP_LABELS.map((label, gi) => ({
                label,
                data: examObsObjects.map((o) => obsAccum[o.id]?.byGradeGroup[gi] ?? 0),
                backgroundColor:
                  gi === 0 ? GRADE_BAR.deepFail : gradeBarColor(GRADE_GROUP_MIDPOINTS[gi]),
                borderRadius: 2,
              })),
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  display: true,
                  position: 'top',
                  labels: { font: { size: 11 }, boxWidth: 12, padding: 10 },
                },
                title: { display: true, text: 'Observaties per cijfergroep', font: { size: 13 } },
              },
              scales: {
                x: { ticks: { font: { size: 11 }, maxRotation: 20 } },
                y: {
                  beginAtZero: true,
                  ticks: { stepSize: 1, precision: 0 },
                  afterFit(s) {
                    s.paddingTop = 30;
                  },
                },
              },
            },
          }),
        );
      }
    }

    // ── Tab switching ─────────────────────────────────────────────────────
    const tabInited = new Set(['resultaten']);
    function switchTab(name) {
      el.querySelectorAll('.tab-pane').forEach((p) =>
        p.classList.toggle('hidden', p.id !== `tab-${name}`),
      );
      if (!tabInited.has(name)) {
        tabInited.add(name);
        if (name === 'cijferverdeling') initCijferverdeling();
        else if (name === 'boxplots') initBoxplots();
        else if (name === 'vraaganalyse') initVraaganalyse();
        else if (name === 'rtti-analyse') initRttiAnalyse();
        else if (name === 'observaties') initObservaties();
      }
    }
    switchTabRef = switchTab;

    if (initialTab !== 'resultaten') switchTab(initialTab);

    // Background changes: new scores or edits of this exam refresh the
    // overview silently on the same tab. (The resit summary is computed by
    // the caller, so it is not refreshed.)
    if (!scoreOverride) {
      const currentTab = () => dialog.activeTab ?? 'resultaten';
      const refresh = modalRefresher(() =>
        openExamOverviewModal(examId, year, null, isSummary, currentTab()),
      );
      onModalSync('scores', (ev) => {
        if (ev.year === year && ev.subject === Store.getActiveSubject()) refresh();
      });
      onModalSync('exam', (ev) => {
        if (ev.id !== examId || ev.year !== year) return;
        if (ev.after) refresh();
        else showReloadNotice('Deze toets is verwijderd door een collega.', closeModal);
      });
    }
  }
}

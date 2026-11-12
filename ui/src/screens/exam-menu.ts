// SPDX-License-Identifier: AGPL-3.0-or-later

// The ⋮ menu of an exam card.

import { esc } from '../components/dialog';
import { openExamModal, deleteExam } from '../modals/toets-edit';
import { openResitModal, openSummaryEditModal } from '../modals/herkansing';
import { openOpdrachtenGenererenModal } from '../modals/opdrachten-genereren.js';
import { openRapportModal } from '../modals/rapport';
import { examObsIds } from '../domain/opdrachten';
import { isPo } from '../domain/po';
import type { Exam } from '../domain/types';
import { openPoEditModal } from '../modals/po-gegevens';
import { openPoGrading } from '../modals/po-beoordelen';
import { openPoResitModal, openProjectgroepenModal } from '../modals/po-groepen';
import { openPoScoresModal } from '../modals/po-scores';
import { Store } from '../store.js';
import { ICONS } from '../utils/icons.js';
import { perfSpan } from '../utils/perf';
import type { CardKind } from './exam-cards';
import { openScoreModal, prebuildScoreModal } from './scores.js';
import { renderToetsenList } from './toetsen';

interface MenuAction {
  icon: string;
  label: string;
  danger?: boolean;
  /** Why it cannot be used now; shown as its tooltip. */
  disabled?: string | null;
  run?: () => unknown;
}
type MenuItem = MenuAction | 'sep';

let openMenu: { el: HTMLElement; btn: HTMLElement; cleanup: () => void } | null = null;

function closeExamMenu(): void {
  if (!openMenu) return;
  openMenu.cleanup();
  openMenu.el.remove();
  openMenu.btn.setAttribute('aria-expanded', 'false');
  openMenu.btn.classList.remove('active');
  openMenu = null;
}

/** Returns the reason the exam cannot be deleted, or null if it can. */
async function deleteBlockReason(examId: string, year: string): Promise<string | null> {
  if (Store.examHasResits(examId, year))
    return 'Er zijn herkansingen gekoppeld aan deze toets, verwijder die eerst.';
  if (await Store.examHasScores(examId, year))
    return 'Er zijn scores ingevoerd voor deze toets, de toets kan dus niet worden verwijderd.';
  return null;
}

/**
 * A PO's menu (spec 4.13): the test's items, Nieuwe poging is a herkansing only, and
 * Projectgroepen. Scores invoeren is the PO's score table (step 23); Rapport the PO rapport
 * (step 24).
 */
async function poMenuItems(examId: string, kind: CardKind, year: string): Promise<MenuItem[]> {
  const summary = kind === 'summary';
  const exam = Store.getExamsSync(year).find((e: Exam) => e.id === examId) as Exam | undefined;
  const items: MenuItem[] = [
    summary
      ? {
          icon: ICONS.scores,
          label: 'Scores invoeren',
          disabled: 'Voer de scores in per poging (origineel of herkansing).',
        }
      : {
          icon: ICONS.scores,
          label: 'Scores invoeren',
          run: () => openPoScoresModal(examId, year, openPoGrading),
        },
    summary
      ? {
          icon: ICONS.rapport,
          label: 'Rapport genereren',
          disabled: 'Genereer het rapport per poging (origineel of herkansing).',
        }
      : {
          icon: ICONS.rapport,
          label: 'Rapport genereren',
          // The PO rapport (step 24): every graded student of the PO.
          run: () => openRapportModal(examId, year),
        },
    {
      icon: ICONS.opdrachten,
      label: 'Opdrachten genereren',
      // The rubric's general and category observaties (step 23).
      disabled: summary
        ? 'Genereer de opdrachten per poging (origineel of herkansing).'
        : exam && examObsIds(exam).length
          ? null
          : 'Er zijn geen observaties gekoppeld aan deze PO of zijn rubric.',
      run: () => openOpdrachtenGenererenModal(examId, year),
    },
    'sep',
  ];
  if (kind !== 'attempt') {
    items.push({
      icon: ICONS.plus,
      label: 'Herkansing toevoegen',
      run: () => openPoResitModal(examId, year),
    });
  }
  if (summary) {
    items.push(
      {
        icon: ICONS.pen,
        label: 'Verzamelkaart bewerken',
        run: () => openSummaryEditModal(examId, year),
      },
      {
        icon: ICONS.trash,
        label: 'PO verwijderen',
        danger: true,
        disabled:
          'Deze PO bestaat uit meerdere pogingen. De individuele pogingen moeten eerst worden verwijderd.',
      },
    );
  } else {
    items.push(
      {
        icon: ICONS.users,
        label: 'Projectgroepen',
        run: () => openProjectgroepenModal(examId, year),
      },
      { icon: ICONS.pen, label: 'PO bewerken', run: () => openPoEditModal(examId, year) },
      {
        icon: ICONS.trash,
        label: 'PO verwijderen',
        danger: true,
        disabled: (await deleteBlockReason(examId, year))?.replaceAll('toets', 'PO') ?? null,
        run: () => deleteExam(examId),
      },
    );
  }
  return items;
}

async function buildMenuItems(examId: string, kind: CardKind, year: string): Promise<MenuItem[]> {
  const summary = kind === 'summary';
  const exam = Store.getExamsSync(year).find((e: { id: string }) => e.id === examId);
  if (isPo(exam)) return poMenuItems(examId, kind, year);
  const items: MenuItem[] = [
    summary
      ? {
          icon: ICONS.scores,
          label: 'Scores invoeren',
          disabled: 'Voer de scores in per poging (origineel, inhaal of herkansing).',
        }
      : {
          icon: ICONS.scores,
          label: 'Scores invoeren',
          run: () => openScoreModal(examId, year, { openExamModal, renderToetsenList }),
        },
    summary
      ? {
          icon: ICONS.rapport,
          label: 'Rapport genereren',
          disabled: 'Genereer het rapport per poging (origineel, inhaal of herkansing).',
        }
      : {
          icon: ICONS.rapport,
          label: 'Rapport genereren',
          run: () => openRapportModal(examId, year),
        },
    {
      icon: ICONS.opdrachten,
      label: 'Opdrachten genereren',
      disabled: summary
        ? 'Genereer de opdrachten per poging (origineel, inhaal of herkansing).'
        : (exam?.obs_ids ?? []).length
          ? null
          : 'Er zijn geen observaties gekoppeld aan deze toets.',
      run: () => openOpdrachtenGenererenModal(examId, year),
    },
    'sep',
  ];

  if (kind !== 'attempt') {
    items.push({
      icon: ICONS.plus,
      label: 'Inhaal / herkansing toevoegen',
      run: () => openResitModal(examId, year),
    });
  }

  if (summary) {
    items.push(
      {
        icon: ICONS.pen,
        label: 'Verzamelkaart bewerken',
        run: () => openSummaryEditModal(examId, year),
      },
      {
        icon: ICONS.trash,
        label: 'Toets verwijderen',
        danger: true,
        disabled:
          'Deze toets bestaat uit meerdere pogingen. De individuele pogingen moeten eerst worden verwijderd.',
      },
    );
  } else {
    items.push(
      { icon: ICONS.pen, label: 'Toets bewerken', run: () => openExamModal(examId) },
      {
        icon: ICONS.trash,
        label: 'Toets verwijderen',
        danger: true,
        disabled: await deleteBlockReason(examId, year),
        run: () => deleteExam(examId),
      },
    );
  }
  return items;
}

export async function toggleExamMenu(btn: HTMLElement, year: string): Promise<void> {
  if (openMenu?.btn === btn) {
    closeExamMenu();
    return;
  }
  closeExamMenu();
  const examId = btn.dataset.id ?? '';
  const kind = (btn.dataset.kind ?? 'solo') as CardKind;
  // Most menus lead to "Scores invoeren": build its grids now, out of sight (Step 7c).
  const po = isPo(Store.getExamsSync(year).find((e: { id: string }) => e.id === examId));
  if (kind !== 'summary' && !po) prebuildScoreModal(examId, year);

  const endMenu = perfSpan('menu:exam');
  const items = await buildMenuItems(examId, kind, year);
  endMenu();
  if (!btn.isConnected) return;
  closeExamMenu(); // another menu may have opened while awaiting

  const menu = document.createElement('div');
  menu.className = 'exam-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = items
    .map((it, i) =>
      it === 'sep'
        ? '<div class="exam-menu-sep" role="separator"></div>'
        : `<button class="exam-menu-item${it.danger ? ' exam-menu-item--danger' : ''}" role="menuitem" data-idx="${i}"${it.disabled ? ` aria-disabled="true" title="${esc(it.disabled)}"` : ''}><span class="exam-menu-icon">${it.icon}</span><span>${esc(it.label)}</span></button>`,
    )
    .join('');
  document.body.appendChild(menu);

  // Position below the button, right-aligned; flip up if there's no room below
  const r = btn.getBoundingClientRect();
  const mh = menu.offsetHeight;
  const top = r.bottom + 4 + mh > window.innerHeight - 8 ? r.top - 4 - mh : r.bottom + 4;
  menu.style.top = `${Math.max(8, top)}px`;
  menu.style.left = `${Math.max(8, r.right - menu.offsetWidth)}px`;

  menu.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('.exam-menu-item');
    if (!el || el.getAttribute('aria-disabled') === 'true') return;
    const item = items[Number(el.dataset.idx)];
    closeExamMenu();
    if (item && item !== 'sep') item.run?.();
  });

  const onDocDown = (e: MouseEvent) => {
    const target = e.target as Node;
    if (!menu.contains(target) && !btn.contains(target)) closeExamMenu();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeExamMenu();
      btn.focus();
    }
  };
  const onScrollResize = () => closeExamMenu();
  document.addEventListener('mousedown', onDocDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onScrollResize);
  window.addEventListener('scroll', onScrollResize, true);

  btn.setAttribute('aria-expanded', 'true');
  btn.classList.add('active');
  openMenu = {
    el: menu,
    btn,
    cleanup: () => {
      document.removeEventListener('mousedown', onDocDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onScrollResize);
      window.removeEventListener('scroll', onScrollResize, true);
    },
  };
}

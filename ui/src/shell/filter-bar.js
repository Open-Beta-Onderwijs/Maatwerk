// SPDX-License-Identifier: AGPL-3.0-or-later

// The filter bar under the screen titles (split from app.js in step 15, R-05):
// the admin's vak filter, schoolsoort, jaarlaag, jaarlaag-klas (wi), the
// observatie filter (Opdrachten) and the "eigen" toggle. One bar element moves
// to the active screen's filter row (app.js navigateTo). The selection is kept
// per user on this PC (Store.saveFilterState). Stays JS until Store is typed
// (step 19).

import { renderScreen } from '../app.js';

/** Bumped on every filter change: kept screens render again (app.js viewKey). */
let _filterGeneration = 0;
export function filterGeneration() {
  return _filterGeneration;
}

// ── Admin vakken filter (popover, single-select) ──────────────────────────────
let _adminSubjectFilter = null; // null = show all

export function getAdminSubjectFilter() {
  return _adminSubjectFilter;
}

const VAKKEN_OPTIONS = [
  { code: 'bio', label: 'Biologie' },
  { code: 'nat', label: 'Natuurkunde' },
  { code: 'schk', label: 'Scheikunde' },
  { code: 'wi', label: 'Wiskunde' },
];

function updateVakLabel() {
  const found = VAKKEN_OPTIONS.find((v) => v.code === _adminSubjectFilter);
  document.getElementById('lbl-filter-vak').textContent = found ? found.label : 'Alle vakken';
  document.getElementById('btn-filter-vak').classList.toggle('filter-btn-active', !!found);
}

function buildVakkenPopover() {
  const container = document.getElementById('pop-vak-toggles');
  container.innerHTML = '';
  for (const { code, label } of VAKKEN_OPTIONS) {
    const btn = document.createElement('button');
    btn.className = 'filter-pop-toggle' + (_adminSubjectFilter === code ? ' selected' : '');
    btn.textContent = label;
    btn.dataset.vakCode = code;
    btn.addEventListener('click', () => {
      _adminSubjectFilter = _adminSubjectFilter === code ? null : code;
      container
        .querySelectorAll('.filter-pop-toggle')
        .forEach((b) => b.classList.toggle('selected', b.dataset.vakCode === _adminSubjectFilter));
      updateVakLabel();
      rebuildJaarlagPopover(_adminSubjectFilter);
      rerenderActive();
    });
    container.appendChild(btn);
  }
  document.getElementById('pop-vak-alles').onclick = () => {
    _adminSubjectFilter = null;
    container.querySelectorAll('.filter-pop-toggle').forEach((b) => b.classList.remove('selected'));
    updateVakLabel();
    rebuildJaarlagPopover(null);
    rerenderActive();
  };
}

document.getElementById('btn-filter-vak').addEventListener('click', (e) => {
  e.stopPropagation();
  closeAllPopovers('pop-vak');
  document.getElementById('pop-vak').classList.toggle('hidden');
});

// ── Filter bar (schoolsoort + jaarlaag + eigen) ───────────────────────────────
export const filterBar = document.getElementById('filter-bar');

// Filter state
let _filterState = {
  schoolsoorten: new Set(),
  jaarlagen: new Set(),
  jaarlagenKlas: new Set(),
  eigenOnly: false,
};
let _activeUserId = null;

// The jaarlaag options depend on current subject
const WI_JAARLAG_OPTIONS = [
  { key: 'OB', label: 'Onderbouw' },
  { key: 'WisA', label: 'Wiskunde A' },
  { key: 'WisB', label: 'Wiskunde B' },
  { key: 'WisC', label: 'Wiskunde C' },
  { key: 'WisD', label: 'Wiskunde D' },
];
const KLAS_JAARLAG_OPTIONS = [
  { key: '1', label: 'Klas 1' },
  { key: '2', label: 'Klas 2' },
  { key: '3', label: 'Klas 3' },
  { key: '4', label: 'Klas 4' },
  { key: '5', label: 'Klas 5' },
  { key: '6', label: 'Klas 6' },
];

export function getSchoolsoortFilter() {
  return _filterState.schoolsoorten;
}
export function getJaarlagFilter() {
  return _filterState.jaarlagen;
}
export function getJaarlagKlasFilter() {
  return _filterState.jaarlagenKlas;
}
export function getEigenOnly() {
  return _filterState.eigenOnly;
}

/**
 * True when an item with these jaarlagen passes the jaarlaag filter(s).
 * Items without jaarlagen always pass. For wiskunde the OB/WisX filter maps
 * to klas 1-3 / 4-6 and is combined with the Klas 1-6 filter.
 */
export function matchesJaarlaagFilter(jaarlagen) {
  const jls = (jaarlagen ?? []).map(String);
  if (jls.length === 0) return true;
  if (_jaarlagOptions !== WI_JAARLAG_OPTIONS) {
    return jls.some((jl) => _filterState.jaarlagen.has(jl));
  }
  const allowed = new Set();
  if (_filterState.jaarlagen.has('OB')) ['1', '2', '3'].forEach((k) => allowed.add(k));
  if (['WisA', 'WisB', 'WisC', 'WisD'].some((k) => _filterState.jaarlagen.has(k))) {
    ['4', '5', '6'].forEach((k) => allowed.add(k));
  }
  return jls.some((jl) => allowed.has(jl) && _filterState.jaarlagenKlas.has(jl));
}

// ── Label helpers ─────────────────────────────────────────────────────────────
function schoolsoortLabel(selected, allOptions) {
  if (selected.size === allOptions.length) return 'Alle schoolsoorten';
  const arr = allOptions.filter((s) => selected.has(s));
  if (arr.length === 0) return 'Geen schoolsoorten';
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]} & ${arr[1]}`;
  return `${arr[0]}, ${arr[1]} +${arr.length - 2}`;
}

function jaarlagLabel(selected, options) {
  const allKeys = options.map((o) => o.key);
  if (selected.size === allKeys.length && allKeys.every((k) => selected.has(k))) {
    // All selected
    if (options === WI_JAARLAG_OPTIONS) return 'Onder- & bovenbouw';
    return 'Alle jaarlagen';
  }
  if (options === WI_JAARLAG_OPTIONS) {
    const hasOB = selected.has('OB');
    const wisKeys = ['WisA', 'WisB', 'WisC', 'WisD'];
    const selWis = wisKeys.filter((k) => selected.has(k));
    if (selected.size === 0) return 'Geen';
    if (!hasOB && selWis.length === wisKeys.length) return 'Bovenbouw';
    if (hasOB && selWis.length === 0) return 'Onderbouw';
    const wisLetters = selWis.map((k) => k.replace('Wis', ''));
    const wisStr = wisLetters.length === 0 ? '' : listLabel(wisLetters, 'Wis ');
    if (hasOB && selWis.length > 0) return `OB & ${wisStr}`;
    return wisStr;
  }
  // Klas 1-6
  const klassen = [...selected].sort((a, b) => Number(a) - Number(b));
  if (klassen.length === 0) return 'Geen klassen';
  return 'Klas ' + listLabel(klassen);
}

function listLabel(items, prefix = '') {
  if (items.length === 1) return prefix + items[0];
  return prefix + items.slice(0, -1).join(', ') + ' & ' + items[items.length - 1];
}

const EIGEN_LABELS = {
  leerlingen: { alle: 'Alle leerlingen', eigen: 'Eigen leerlingen' },
  groepen: { alle: 'Alle groepen', eigen: 'Eigen groepen' },
  toetsen: { alle: 'Alle toetsen', eigen: 'Eigen toetsen' },
  observaties: { alle: 'Alle observaties', eigen: 'Observaties eigen groepen' },
};

export function updateEigenLabel(screenName) {
  const map = EIGEN_LABELS[screenName];
  if (!map) return;
  const lbl = _filterState.eigenOnly ? map.eigen : map.alle;
  document.getElementById('lbl-filter-eigen').textContent = lbl;
  document
    .getElementById('btn-filter-eigen')
    .classList.toggle('filter-btn-active', _filterState.eigenOnly);
}

// ── Popover open/close ────────────────────────────────────────────────────────
const FILTER_POPOVER_IDS = ['pop-vak', 'pop-ss', 'pop-jl-klas', 'pop-jl', 'pop-obs'];

function closeAllPopovers(except) {
  FILTER_POPOVER_IDS.filter((id) => id !== except).forEach((id) =>
    document.getElementById(id).classList.add('hidden'),
  );
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.filter-popover-wrap')) closeAllPopovers();
});

for (const [btnId, popId] of [
  ['btn-filter-ss', 'pop-ss'],
  ['btn-filter-jl-klas', 'pop-jl-klas'],
  ['btn-filter-jl', 'pop-jl'],
  ['btn-filter-obs', 'pop-obs'],
]) {
  document.getElementById(btnId).addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllPopovers(popId);
    document.getElementById(popId).classList.toggle('hidden');
  });
}

// ── Schoolsoort popover builder ───────────────────────────────────────────────
let _schoolsoortOptions = []; // list of strings from school.json

function buildSchoolsoortPopover(options, savedSelection) {
  _schoolsoortOptions = options;
  const selection = savedSelection ?? new Set(options);
  _filterState.schoolsoorten = selection;

  const container = document.getElementById('pop-ss-toggles');
  container.innerHTML = '';
  for (const ss of options) {
    const btn = document.createElement('button');
    btn.className = 'filter-pop-toggle' + (selection.has(ss) ? ' selected' : '');
    btn.textContent = ss;
    btn.addEventListener('click', () => {
      btn.classList.toggle('selected');
      if (btn.classList.contains('selected')) {
        _filterState.schoolsoorten.add(ss);
      } else {
        _filterState.schoolsoorten.delete(ss);
      }
      updateSchoolsoortLabel();
      persistFilters();
      rerenderActive();
    });
    container.appendChild(btn);
  }

  document.getElementById('pop-ss-alles').onclick = () => {
    _filterState.schoolsoorten = new Set(_schoolsoortOptions);
    container.querySelectorAll('.filter-pop-toggle').forEach((b) => b.classList.add('selected'));
    updateSchoolsoortLabel();
    persistFilters();
    rerenderActive();
  };
  document.getElementById('pop-ss-niets').onclick = () => {
    _filterState.schoolsoorten = new Set();
    container.querySelectorAll('.filter-pop-toggle').forEach((b) => b.classList.remove('selected'));
    updateSchoolsoortLabel();
    persistFilters();
    rerenderActive();
  };

  updateSchoolsoortLabel();
}

function updateSchoolsoortLabel() {
  document.getElementById('lbl-filter-ss').textContent = schoolsoortLabel(
    _filterState.schoolsoorten,
    _schoolsoortOptions,
  );
}

// ── Jaarlaag popover builder ──────────────────────────────────────────────────
let _jaarlagOptions = KLAS_JAARLAG_OPTIONS;

function rebuildJaarlagPopover(subject, savedSelection) {
  _jaarlagOptions = subject === 'wi' ? WI_JAARLAG_OPTIONS : KLAS_JAARLAG_OPTIONS;
  const allKeys = _jaarlagOptions.map((o) => o.key);
  const selection = savedSelection ?? new Set(allKeys);
  _filterState.jaarlagen = selection;

  const container = document.getElementById('pop-jl-toggles');
  container.innerHTML = '';
  for (const { key, label } of _jaarlagOptions) {
    const btn = document.createElement('button');
    btn.className = 'filter-pop-toggle' + (selection.has(key) ? ' selected' : '');
    btn.textContent = label;
    btn.dataset.jlKey = key;
    btn.addEventListener('click', () => {
      btn.classList.toggle('selected');
      if (btn.classList.contains('selected')) {
        _filterState.jaarlagen.add(key);
      } else {
        _filterState.jaarlagen.delete(key);
      }
      updateJaarlagLabel();
      persistFilters();
      rerenderActive();
    });
    container.appendChild(btn);
  }

  // One handler per button, replaced on every build (U11: listeners piled up per login).
  document.getElementById('pop-jl-alles').onclick = () => {
    _filterState.jaarlagen = new Set(_jaarlagOptions.map((o) => o.key));
    container.querySelectorAll('.filter-pop-toggle').forEach((b) => b.classList.add('selected'));
    updateJaarlagLabel();
    persistFilters();
    rerenderActive();
  };

  document.getElementById('pop-jl-niets').onclick = () => {
    _filterState.jaarlagen = new Set();
    container.querySelectorAll('.filter-pop-toggle').forEach((b) => b.classList.remove('selected'));
    updateJaarlagLabel();
    persistFilters();
    rerenderActive();
  };

  updateJaarlagLabel();

  // Show/hide the Klas 1-6 popover (only for wiskunde)
  const jlKlasWrap = document.getElementById('jl-klas-wrap');
  const isWi = subject === 'wi';
  jlKlasWrap.classList.toggle('hidden', !isWi);
  if (isWi) {
    buildJaarlagKlasPopover();
  } else {
    _filterState.jaarlagenKlas = new Set(KLAS_JAARLAG_OPTIONS.map((o) => o.key));
  }
}

function updateJaarlagLabel() {
  document.getElementById('lbl-filter-jl').textContent = jaarlagLabel(
    _filterState.jaarlagen,
    _jaarlagOptions,
  );
}

// ── Jaarlaag-klas popover builder (wiskunde only, Klas 1–6) ──────────────────
function buildJaarlagKlasPopover(savedSelection) {
  const allKeys = KLAS_JAARLAG_OPTIONS.map((o) => o.key);
  const selection = savedSelection ?? new Set(allKeys);
  _filterState.jaarlagenKlas = selection;

  const container = document.getElementById('pop-jl-klas-toggles');
  container.innerHTML = '';
  for (const { key, label } of KLAS_JAARLAG_OPTIONS) {
    const btn = document.createElement('button');
    btn.className = 'filter-pop-toggle' + (selection.has(key) ? ' selected' : '');
    btn.textContent = label;
    btn.dataset.jlklasKey = key;
    btn.addEventListener('click', () => {
      btn.classList.toggle('selected');
      if (btn.classList.contains('selected')) {
        _filterState.jaarlagenKlas.add(key);
      } else {
        _filterState.jaarlagenKlas.delete(key);
      }
      updateJaarlagKlasLabel();
      persistFilters();
      rerenderActive();
    });
    container.appendChild(btn);
  }

  document.getElementById('pop-jl-klas-alles').onclick = () => {
    _filterState.jaarlagenKlas = new Set(KLAS_JAARLAG_OPTIONS.map((o) => o.key));
    container.querySelectorAll('.filter-pop-toggle').forEach((b) => b.classList.add('selected'));
    updateJaarlagKlasLabel();
    persistFilters();
    rerenderActive();
  };

  document.getElementById('pop-jl-klas-niets').onclick = () => {
    _filterState.jaarlagenKlas = new Set();
    container.querySelectorAll('.filter-pop-toggle').forEach((b) => b.classList.remove('selected'));
    updateJaarlagKlasLabel();
    persistFilters();
    rerenderActive();
  };

  updateJaarlagKlasLabel();
}

function updateJaarlagKlasLabel() {
  document.getElementById('lbl-filter-jl-klas').textContent = jaarlagLabel(
    _filterState.jaarlagenKlas,
    KLAS_JAARLAG_OPTIONS,
  );
}

// ── Observatie popover (opdrachten only) ──────────────────────────────────────
// Options are supplied by the opdrachten screen (observaties matching the current
// schoolsoort/jaarlaag filters). The selection is kept across option changes so
// that narrowing and widening the other filters does not lose it.
let _obsFilter = null; // null = alle observaties (no filtering), else Set of obs ids
let _obsFilterOptions = []; // [{ id, naam, icon }]

/** Effective observatie filter: null (no filtering) or the selected ids among the current options. */
export function getObservatieFilter() {
  if (!_obsFilter) return null;
  return new Set(_obsFilterOptions.map((o) => o.id).filter((id) => _obsFilter.has(id)));
}

export function setObservatieFilterOptions(options) {
  const sameOptions =
    options.length === _obsFilterOptions.length &&
    options.every((o, i) => o.id === _obsFilterOptions[i].id);
  _obsFilterOptions = options;
  if (!sameOptions) buildObservatiePopover();
  updateObservatieLabel();
}

function obsIsSelected(id) {
  return !_obsFilter || _obsFilter.has(id);
}

function buildObservatiePopover() {
  const container = document.getElementById('pop-obs-toggles');
  container.innerHTML = '';
  if (_obsFilterOptions.length === 0) {
    container.innerHTML =
      '<div class="filter-pop-empty">Geen observaties voor deze schoolsoort en jaarlagen.</div>';
    return;
  }
  for (const obs of _obsFilterOptions) {
    const btn = document.createElement('button');
    btn.className = 'filter-pop-toggle' + (obsIsSelected(obs.id) ? ' selected' : '');
    btn.textContent = `${obs.icon ?? ''} ${obs.naam ?? ''}`.trim();
    btn.title = obs.naam ?? '';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!_obsFilter) _obsFilter = new Set(_obsFilterOptions.map((o) => o.id));
      if (_obsFilter.has(obs.id)) _obsFilter.delete(obs.id);
      else _obsFilter.add(obs.id);
      // Everything selected again → back to "no filtering"
      if (_obsFilterOptions.every((o) => _obsFilter.has(o.id))) _obsFilter = null;
      btn.classList.toggle('selected', obsIsSelected(obs.id));
      updateObservatieLabel();
      rerenderActive();
    });
    container.appendChild(btn);
  }
}

function updateObservatieLabel() {
  const sel = getObservatieFilter();
  let label = 'Alle observaties';
  if (sel && sel.size === 0) label = 'Geen observaties';
  else if (sel && sel.size === 1) {
    const obs = _obsFilterOptions.find((o) => sel.has(o.id));
    label = `${obs.icon ?? ''} ${obs.naam ?? ''}`.trim();
  } else if (sel) label = `${sel.size} observaties`;
  document.getElementById('lbl-filter-obs').textContent = label;
  document.getElementById('btn-filter-obs').classList.toggle('filter-btn-active', !!sel);
}

document.getElementById('pop-obs-alles').addEventListener('click', () => {
  _obsFilter = null;
  buildObservatiePopover();
  updateObservatieLabel();
  rerenderActive();
});
document.getElementById('pop-obs-niets').addEventListener('click', () => {
  _obsFilter = new Set();
  buildObservatiePopover();
  updateObservatieLabel();
  rerenderActive();
});

// ── Eigen toggle ──────────────────────────────────────────────────────────────
document.getElementById('btn-filter-eigen').addEventListener('click', () => {
  _filterState.eigenOnly = !_filterState.eigenOnly;
  const active = document.querySelector('.screen.active');
  const screenName = active?.id.replace('screen-', '') ?? 'leerlingen';
  updateEigenLabel(screenName);
  persistFilters();
  rerenderActive();
});

// ── Persist & re-render helpers ───────────────────────────────────────────────
function persistFilters() {
  if (_activeUserId) Store.saveFilterState(_activeUserId, _filterState);
}

function rerenderActive() {
  _filterGeneration++;
  const active = document.querySelector('.screen.active');
  if (active && active.id !== 'screen-startup') {
    renderScreen(active.id.replace('screen-', ''));
  }
}

// ── Init filter bar on login ──────────────────────────────────────────────────
export async function initFilterBar(user, subject) {
  _activeUserId = user.id;
  const school = Store.getSchoolSync();
  const schoolSoorten = school.schoolsoort ?? [];
  const saved = await Store.loadFilterState(user.id);

  // Admin vakken popover (single-select, not persisted per-user — always starts at null)
  if (user.isAdmin) {
    _adminSubjectFilter = null;
    buildVakkenPopover();
    updateVakLabel();
  }

  // Schoolsoort popover
  const savedSS = saved?.schoolsoorten ? new Set(saved.schoolsoorten) : null;
  buildSchoolsoortPopover(schoolSoorten, savedSS);

  // Jaarlaag popover (for admin: subject is null initially)
  const savedJL = saved?.jaarlagen ? new Set(saved.jaarlagen) : null;
  rebuildJaarlagPopover(user.isAdmin ? null : subject, savedJL);

  // Jaarlaag klas popover (wi only) — re-apply saved selection on top of default
  if (!user.isAdmin && subject === 'wi' && saved?.jaarlagenKlas) {
    buildJaarlagKlasPopover(new Set(saved.jaarlagenKlas));
  }

  // Eigen
  _filterState.eigenOnly = saved?.eigenOnly ?? false;
}

/** After logout: the next user starts with their own filters. */
export function resetFilterBar() {
  _adminSubjectFilter = null;
  _activeUserId = null;
  _obsFilter = null;
}

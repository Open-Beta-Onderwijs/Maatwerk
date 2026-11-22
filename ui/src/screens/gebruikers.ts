// SPDX-License-Identifier: AGPL-3.0-or-later

// SCREEN: Gebruikers (admin; design spec 4.9, board 12): sections BEHEERDER,
// ACTIEVE GEBRUIKERS (cards: 52 px avatar, name, vakken, an amber pill
// "Nog geen pincode"; actions "Pincode resetten" when a PIN exists, edit,
// deactivate), GEDEACTIVEERDE GEBRUIKERS and SECTIEVOORZITTERS (one card, a
// row per vak). PIN reset and sectievoorzitters: Step 7b.

import { toast, escHtml, getAdminSubjectFilter, confirmDialog as confirmDialogJs } from '../app.js';
import { ICONS } from '../utils/icons.js';
import { avatarHtml, loadAvatarPhotos } from '../components/avatar';
import { VAK_EMOJI } from '../domain/login';
import { SUBJECT_DISPLAY } from '../domain/rapport';
import { openUserModal, type EditableUser } from '../modals/gebruiker-edit';
import { Store } from '../store.js';

const SUBJECTS = ['nat', 'bio', 'schk', 'wi'];
const SUBJECT_LABEL = SUBJECT_DISPLAY as Record<string, string>;

const confirmDialog = confirmDialogJs as (
  message: string,
  opts: { title: string; okLabel: string; danger?: boolean },
) => Promise<boolean>;
const upsertUser = Store.upsertUser as (u: EditableUser, rev?: number) => Promise<unknown>;

const fullName = (u: EditableUser) =>
  [u.voornaam, u.tussenvoegsel, u.achternaam].filter(Boolean).join(' ');

async function loadUsers(): Promise<EditableUser[]> {
  return (await Store.loadUsers()) as EditableUser[];
}

export async function renderGebruikers(): Promise<void> {
  const container = document.getElementById('screen-gebruikers') as HTMLElement;
  container.innerHTML = `
    <div class="screen-header">
      <h2>Gebruikers</h2>
      <div class="header-actions">
        <button class="btn btn--primary" id="btn-add-user">+ Gebruiker toevoegen</button>
      </div>
    </div>
    <div id="user-list" class="card-list users"></div>
    <h3 class="list-section-header">Sectiebestuur</h3>
    <p class="hint">De sectievoorzitter en de sectiesecretaris van een vak wijzigen alle scores van
       dat vak en de leerlingen en docenten van de groepen. Ze loggen daarvoor in met de eigen
       pincode via de aparte badge "Sectievoorzitter" of "Sectiesecretaris". Met "Gastaccount"
       toont het inlogscherm van dat vak een Gast: zonder pincode, leest alles van het vak (ook
       leerlinggegevens) en wijzigt niets.</p>
    <div id="voorzitter-list" class="card voorzitter-list"></div>`;

  await renderUserList();
  await renderVoorzitters();

  container
    .querySelector('#btn-add-user')!
    .addEventListener('click', () => void openUserModal(null, renderAll));
}

async function renderAll(): Promise<void> {
  await renderUserList();
  await renderVoorzitters();
}

function userCard(user: EditableUser): string {
  const id = escHtml(user.id);
  const vakken = (user.vakken ?? []).map((v) => SUBJECT_LABEL[v] ?? v).join(', ') || '—';
  const pill = user.pinHash
    ? ''
    : `<span class="pill pill--amber" title="Stelt die in bij de volgende aanmelding">Nog geen pincode</span>`;
  // Order (spec 4.9): Pincode resetten (only with a PIN), edit, deactivate.
  const actions = user.isAdmin
    ? ''
    : `
        ${user.pinHash ? `<button class="btn btn--secondary btn--sm" data-action="reset-pin" data-id="${id}" title="De gebruiker kiest bij de volgende aanmelding een nieuwe pincode">Pincode resetten</button>` : ''}
        <button class="btn btn--icon" data-action="edit-user" data-id="${id}" title="Gebruiker bewerken" aria-label="Gebruiker bewerken">${ICONS.pen}</button>
        <button class="btn btn--icon${user.actief ? ' btn--icon-danger' : ''}" data-action="toggle-user" data-id="${id}"
                title="${user.actief ? 'Gebruiker deactiveren' : 'Gebruiker activeren'}"
                aria-label="${user.actief ? 'Gebruiker deactiveren' : 'Gebruiker activeren'}">
          ${user.actief ? ICONS.ban : ICONS.check}
        </button>`;
  return `
      <div class="card gebruiker-card">
        ${avatarHtml(user, { size: 52 })}
        <div class="gebruiker-card-body">
          <div class="gebruiker-card-name"><b>${escHtml(fullName(user))}</b>${pill}</div>
          <div class="gebruiker-card-vakken">${escHtml(vakken)}</div>
        </div>
        <div class="card-actions">${actions}</div>
      </div>`;
}

async function renderUserList(): Promise<void> {
  const container = document.getElementById('user-list');
  if (!container) return;

  const users = await loadUsers();
  const subjFilter = getAdminSubjectFilter() as string | null;
  const matchesFilter = (u: EditableUser) => !subjFilter || (u.vakken ?? []).includes(subjFilter);
  const active = users.filter((u) => u.actief && !u.isAdmin && matchesFilter(u));
  const inactive = users.filter((u) => !u.actief && !u.isAdmin && matchesFilter(u));
  const adminUser = users.find((u) => u.isAdmin);

  let html = '';
  if (adminUser) html += `<h3 class="list-section-header">Beheerder</h3>${userCard(adminUser)}`;
  if (active.length)
    html += `<h3 class="list-section-header">Actieve gebruikers</h3>${active.map(userCard).join('')}`;
  if (inactive.length)
    html += `<h3 class="list-section-header muted">Gedeactiveerde gebruikers</h3>${inactive.map(userCard).join('')}`;
  if (!active.length && !adminUser) html = `<p class="hint">Nog geen gebruikers aangemaakt.</p>`;

  container.innerHTML = html;
  void loadAvatarPhotos(container, (rel) => window.maatwerk.readPhotoAsDataUrl(rel));

  container.onclick = async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!btn || !container.contains(btn)) return;
    const user = (await loadUsers()).find((u) => u.id === btn.dataset.id);
    if (!user) return;
    if (btn.dataset.action === 'edit-user') {
      void openUserModal(user, renderAll);
    } else if (btn.dataset.action === 'reset-pin') {
      const ok = await confirmDialog(
        `${user.voornaam} kiest bij de volgende aanmelding een nieuwe pincode.`,
        { title: 'Pincode resetten', okLabel: 'Resetten', danger: true },
      );
      if (!ok) return;
      try {
        Store.cacheUser(await window.maatwerk.resetPin(user.id));
        toast(`Pincode van ${user.voornaam} gereset.`, 'success');
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'error');
      }
      await renderUserList();
    } else if (btn.dataset.action === 'toggle-user') {
      user.actief = !user.actief;
      await upsertUser(user);
      toast(
        user.actief ? `${user.voornaam} geactiveerd.` : `${user.voornaam} gedeactiveerd.`,
        'success',
      );
      await renderAll();
    }
  };
}

// ── Sectiebestuur (school.json `secties`, decision 13; secretaris step 35) ─
type SectieRole = 'voorzitter' | 'secretaris';
type Secties = Record<
  string,
  { voorzitter?: string | null; secretaris?: string | null; gast?: boolean }
>;

const ROLE_NAME: Record<SectieRole, string> = {
  voorzitter: 'Sectievoorzitter',
  secretaris: 'Sectiesecretaris',
};

/** One dropdown: the active teachers of the vak, without the one holding the other role. */
function roleSelect(
  vak: string,
  role: SectieRole,
  teachers: EditableUser[],
  current: string,
  other: string,
): string {
  const offered = teachers.filter((u) => u.id !== other);
  const options = [
    `<option value="">Geen</option>`,
    ...offered.map(
      (u) =>
        `<option value="${escHtml(u.id)}"${u.id === current ? ' selected' : ''}>${escHtml(fullName(u))}</option>`,
    ),
  ];
  // Someone who no longer teaches the vak (or left) stays visible until changed.
  if (current && !offered.some((u) => u.id === current)) {
    options.push(
      `<option value="${escHtml(current)}" selected>(niet meer actief voor dit vak)</option>`,
    );
  }
  const id = `${role === 'voorzitter' ? 'vz' : 'sec'}-${vak}`;
  return `
    <div class="voorzitter-field">
      <label class="voorzitter-field-label" for="${id}">${ROLE_NAME[role]}</label>
      <select id="${id}" data-vak="${vak}" data-role="${role}">${options.join('')}</select>
    </div>`;
}

async function renderVoorzitters(): Promise<void> {
  const container = document.getElementById('voorzitter-list');
  if (!container) return;
  const [users, school] = (await Promise.all([loadUsers(), Store.loadSchool()])) as [
    EditableUser[],
    { secties?: Secties } | null,
  ];
  const secties = school?.secties ?? {};
  container.innerHTML = SUBJECTS.map((vak) => {
    const teachers = users.filter((u) => u.actief && !u.isAdmin && (u.vakken ?? []).includes(vak));
    const vz = secties[vak]?.voorzitter ?? '';
    const sec = secties[vak]?.secretaris ?? '';
    return `
      <div class="voorzitter-row">
        <span class="voorzitter-vak"><span aria-hidden="true">${VAK_EMOJI[vak] ?? ''}</span>${escHtml(SUBJECT_LABEL[vak] ?? vak)}</span>
        ${roleSelect(vak, 'voorzitter', teachers, vz, sec)}
        ${roleSelect(vak, 'secretaris', teachers, sec, vz)}
        <label class="voorzitter-gast" title="Een gast logt zonder pincode in, leest alles van dit vak (ook leerlinggegevens) en kan niets wijzigen.">
          <input type="checkbox" data-gast-vak="${vak}"${secties[vak]?.gast === true ? ' checked' : ''} />
          Gastaccount
        </label>
      </div>`;
  }).join('');
  // Step 36 (decision 81): the admin switches the sectie's gast on knowingly.
  container.querySelectorAll<HTMLInputElement>('input[data-gast-vak]').forEach((box) => {
    box.addEventListener('change', async () => {
      const vak = box.dataset.gastVak!;
      const on = box.checked;
      try {
        await Store.updateSchool((s: { secties?: Secties }) => {
          const next = { ...(s.secties ?? {}) };
          const sectie = { ...(next[vak] ?? {}) };
          if (on) sectie.gast = true;
          else delete sectie.gast;
          if (Object.keys(sectie).length) next[vak] = sectie;
          else delete next[vak];
          s.secties = next;
        });
        toast(`Gastaccount ${SUBJECT_LABEL[vak]} ${on ? 'aangezet' : 'uitgezet'}.`, 'success');
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error');
        await renderVoorzitters();
      }
    });
  });
  container.querySelectorAll<HTMLSelectElement>('select[data-vak]').forEach((select) => {
    select.addEventListener('change', async () => {
      const vak = select.dataset.vak!;
      const role = select.dataset.role as SectieRole;
      const id = select.value || null;
      try {
        await Store.updateSchool((s: { secties?: Secties }) => {
          const next = { ...(s.secties ?? {}) };
          const sectie = { ...(next[vak] ?? {}) };
          if (id) sectie[role] = id;
          else delete sectie[role];
          // One person holds one role (the other dropdown does not offer them).
          const otherRole: SectieRole = role === 'voorzitter' ? 'secretaris' : 'voorzitter';
          if (id && sectie[otherRole] === id) delete sectie[otherRole];
          if (Object.keys(sectie).length) next[vak] = sectie;
          else delete next[vak];
          s.secties = next;
        });
        toast(`${ROLE_NAME[role]} ${SUBJECT_LABEL[vak]} opgeslagen.`, 'success');
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error');
      }
      // The other dropdown leaves out whoever this one holds now.
      await renderVoorzitters();
    });
  });
}

// SPDX-License-Identifier: AGPL-3.0-or-later

// ── Group add/edit & CSV import modals ────────────────────────────────────────
import {
  openModal,
  closeModal,
  toast,
  escHtml,
  SEL,
  onModalSync,
  showReloadNotice,
  changedByName,
  confirmDialog,
} from '../app.js';
import { decodeCsv, parseCSV, askSchoolYear } from '../utils/csv.js';
import { CSV_EXAMPLES, csvExampleHtml, wireCsvExample } from '../utils/csv-example';
import { groupOverwrites, withImportIds } from '../domain/groups';
import { renderGroepen } from '../screens/groepen';

export async function openGroupModal(id) {
  const year = SEL.groupsYear.getValue() || Store.getConfigSync().activeYear;
  const [students, users] = await Promise.all([Store.getStudents(year), Store.loadUsers()]);
  students.sort((a, b) => {
    const scmp = (a.stamklas ?? '').localeCompare(b.stamklas ?? '');
    if (scmp !== 0) return scmp;
    return (a.achternaam ?? '').localeCompare(b.achternaam ?? '');
  });

  let group = { id: '', name: '', jaarlaag: '', schoolsoort: [], docenten: [], student_ids: [] };
  let groupsInJaarlaag = [];

  if (id) {
    const all = await Store.getGroups(year);
    group = JSON.parse(JSON.stringify(all.find((g) => g.id === id) ?? group));
    groupsInJaarlaag = Store.getGroupsSync(year)
      .filter((g) => String(g.jaarlaag) === String(group.jaarlaag) && g.subject === group.subject)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const hasStudents = group.student_ids.length > 0;
  const isEdit = !!id;
  // Step 7b, decision 13: the sectievoorzitter changes only the composition
  // and the teachers of the groups of their vak; the other fields stay locked.
  const voorzitter = isEdit && !Store.isAdminActive() && Store.isVoorzitterActive(group.subject);
  if (!Store.isAdminActive() && !voorzitter) return;
  const locked = hasStudents || voorzitter;

  const JAARLAGEN = ['1', '2', '3', '4', '5', '6'];
  const SCHOOLSOORTEN = ['Vmbo-bb', 'Vmbo-kb', 'Vmbo-gl', 'Vmbo-tl', 'Havo', 'Vwo', 'Gymnasium'];
  const VAKKEN = [
    { code: 'bio', label: 'Biologie' },
    { code: 'nat', label: 'Natuurkunde' },
    { code: 'schk', label: 'Scheikunde' },
    { code: 'wi', label: 'Wiskunde' },
  ];
  const jlDisabled = isEdit && locked;
  const ssDisabled = isEdit && locked;
  const vakDisabled = isEdit && locked;

  const jaarlaagHtml = JAARLAGEN.map((jl) => {
    const sel = String(group.jaarlaag) === jl;
    const cls = `tog-btn jl-btn jl-toggle${sel ? ' selected' : ''}${jlDisabled ? ' tog-btn-disabled' : ''}`;
    return `<button type="button" class="${cls}" data-jl="${jl}"${jlDisabled ? ' disabled' : ''}>${jl}</button>`;
  }).join('');

  const schoolSS = Store.getSchoolSync().schoolsoort ?? [];
  const schoolSSFilter = schoolSS.length > 0;
  const schoolsoortHtml = SCHOOLSOORTEN.map((ss) => {
    const sel = (group.schoolsoort ?? []).includes(ss);
    const disabled = ssDisabled || (schoolSSFilter && !schoolSS.includes(ss));
    const cls = `tog-btn ss-toggle${sel ? ' selected' : ''}${disabled ? ' tog-btn-disabled' : ''}`;
    return `<button type="button" class="${cls}" data-ss="${ss}"${disabled ? ' disabled' : ''}>${ss}</button>`;
  }).join('');

  const vakHtml = VAKKEN.map(({ code, label }) => {
    const sel = group.subject === code;
    const cls = `tog-btn vak-g-btn${sel ? ' selected' : ''}${vakDisabled ? ' tog-btn-disabled' : ''}`;
    return `<button type="button" class="${cls}" data-vak="${code}"${vakDisabled ? ' disabled' : ''}>${label}</button>`;
  }).join('');

  const nonAdminUsers = users.filter((u) => !u.isAdmin && u.actief);

  function buildDocentHtml(selectedSS, selectedDocentIds, selectedSubject) {
    const subjectFilter = selectedSubject || Store.getActiveSubject() || null;
    const filtered = nonAdminUsers.filter((u) => {
      const teachesSubject = !subjectFilter || (u.vakken ?? []).includes(subjectFilter);
      const hasSSOverlap =
        selectedSS.length === 0 || (u.schoolsoort ?? []).some((ss) => selectedSS.includes(ss));
      return teachesSubject && hasSSOverlap;
    });
    if (filtered.length === 0) {
      return `<span class="form-hint muted">Geen docenten beschikbaar voor dit vak en deze schoolsoort.</span>`;
    }
    return filtered
      .map((u) => {
        const uName = [u.voornaam, u.tussenvoegsel, u.achternaam].filter(Boolean).join(' ');
        const sel = (selectedDocentIds ?? []).includes(u.id);
        return `<button type="button" class="tog-btn docent-toggle${sel ? ' selected' : ''}" data-docent-id="${escHtml(u.id)}">${escHtml(uName)}</button>`;
      })
      .join('');
  }

  let studentsSection;
  if (isEdit) {
    const headerCols = groupsInJaarlaag
      .map((g) => `<th class="gst-group-th">${escHtml(g.name)}</th>`)
      .join('');
    const rows = students
      .map((s) => {
        const jl = Store.jaarlaagFromStamklas(s.stamklas);
        const cols = groupsInJaarlaag
          .map((g) => {
            const checked = g.student_ids.includes(s.id) ? 'checked' : '';
            return `<td class="gst-check-td"><input type="checkbox"
              data-student-id="${escHtml(s.id)}"
              data-group-id="${escHtml(g.id)}"
              data-subcategory="${escHtml(g.subcategory ?? '')}"
              ${checked} /></td>`;
          })
          .join('');
        return `<tr data-student-id="${escHtml(s.id)}" data-stamklas-jl="${escHtml(jl)}">
          <td>${escHtml(Store.fullName(s))}</td>
          <td class="gst-stamklas">${escHtml(s.stamklas ?? '')}</td>
          ${cols}
        </tr>`;
      })
      .join('');

    studentsSection = `
      <div class="gst-label-row">
        <label>Leerlingen</label>
        ${group.jaarlaag ? `<button type="button" id="f-g-jl-filter" class="btn btn--primary btn--sm" data-active="1">Alleen leerlingen van jaarlaag ${escHtml(String(group.jaarlaag))} tonen</button>` : ''}
      </div>
      <div class="gst-scroll">
        <table class="gst-table">
          <thead>
            <tr>
              <th>Naam</th>
              <th>Stamklas</th>
              ${headerCols}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  const initialSS = group.schoolsoort ?? [];
  const initialDocenten = group.docenten ?? [];
  const initialDocentHtml = buildDocentHtml(initialSS, initialDocenten, group.subject);

  const fieldsHtml = isEdit
    ? `
    <div class="u-gap-20 form-row">
      <div class="u-flex-1 u-min-w-0 form-group">
        <label>Naam (bijv. 6nat4 of 2anat)</label>
        <input id="f-gname" type="text" value="${escHtml(group.name)}" ${locked ? 'disabled' : ''} />
      </div>
      <div class="u-flex-none form-group">
        <label>Schoolsoort</label>
        <div class="vak-toggle-group vak-toggle-group--nowrap">${schoolsoortHtml}</div>
      </div>
    </div>
    <div class="u-gap-20 u-mt-4 form-row">
      <div class="u-flex-auto u-mb-0 form-group">
        <label>Vak</label>
        <div class="btn-toggle-group">${vakHtml}</div>
      </div>
      <div class="u-flex-auto u-mb-0 form-group">
        <label>Leerjaar</label>
        <div class="btn-toggle-group">${jaarlaagHtml}</div>
      </div>
      <div class="u-flex-1 u-min-w-0 u-mb-0 form-group">
        <label>Docent(en)</label>
        <div class="vak-toggle-group" id="f-g-docenten">${initialDocentHtml}</div>
      </div>
    </div>
  `
    : `
    <div class="form-group">
      <label>Naam (bijv. 6nat4 of 2anat)</label>
      <input id="f-gname" type="text" value="${escHtml(group.name)}" ${hasStudents ? 'disabled' : ''} />
    </div>
    <div class="form-group">
      <label>Schoolsoort</label>
      <div class="vak-toggle-group">${schoolsoortHtml}</div>
    </div>
    <div class="form-group">
      <label>Vak</label>
      <div class="btn-toggle-group">${vakHtml}</div>
    </div>
    <div class="form-group">
      <label>Leerjaar</label>
      <div class="btn-toggle-group">${jaarlaagHtml}</div>
    </div>
  `;

  let save = null; // set below; the footer's Opslaan calls it
  const dialog = openModal({
    key: 'group-edit',
    title: id ? 'Groep bewerken' : 'Groep toevoegen',
    subtitle: id ? `${group.name} · ${year}` : year,
    size: 'lg',
    fixedHeight: isEdit,
    footer: [
      { label: 'Annuleren', variant: 'secondary', onClick: 'close' },
      { label: 'Opslaan', variant: 'primary', id: 'save', onClick: () => save?.() },
    ],
    body: `
    ${fieldsHtml}
    ${
      !isEdit
        ? `
    <div class="u-mb-0 form-group">
      <label>Docent(en)</label>
      <div class="vak-toggle-group" id="f-g-docenten">${initialDocentHtml}</div>
    </div>`
        : ''
    }
    ${
      voorzitter
        ? '<span class="u-d-block u-mt-8 form-hint muted">Als sectievoorzitter wijzig je de leerlingen en docenten van de groep. Naam, leerjaar, schoolsoort en vak wijzigt de beheerder.</span>'
        : hasStudents
          ? '<span class="u-d-block u-mt-8 form-hint muted">Naam, leerjaar, schoolsoort en vak kunnen niet worden gewijzigd zolang er leerlingen in de groep zitten.</span>'
          : ''
    }
    ${isEdit ? `<div class="u-mt-16 form-group">${studentsSection}</div>` : ''}
  `,
  });
  {
    const el = dialog.body;
    // Someone else changed or removed this group while it is being edited.
    if (id) {
      onModalSync('group', async (ev) => {
        if (ev.id !== id || ev.year !== year) return;
        const who = await changedByName(ev);
        if (!ev.after) {
          showReloadNotice(`Deze groep is verwijderd door ${who}.`, () => {
            closeModal();
            renderGroepen();
          });
        } else {
          showReloadNotice(
            `Deze groep is gewijzigd door ${who}. Het venster wordt opnieuw geladen.`,
            () => openGroupModal(id),
          );
        }
      });
    }

    // Helper to refresh docent section
    const updateDocentSection = () => {
      const selectedSS = [...el.querySelectorAll('.ss-toggle.selected')].map((b) => b.dataset.ss);
      const selectedDocenten = [...el.querySelectorAll('.docent-toggle.selected')].map(
        (b) => b.dataset.docentId,
      );
      const selectedVak = el.querySelector('.vak-g-btn.selected')?.dataset.vak ?? null;
      const docentContainer = el.querySelector('#f-g-docenten');
      docentContainer.innerHTML = buildDocentHtml(selectedSS, selectedDocenten, selectedVak);
      docentContainer.querySelectorAll('.docent-toggle').forEach((btn) => {
        btn.addEventListener('click', () => btn.classList.toggle('selected'));
      });
    };

    // Vak single-select + update docents
    el.querySelectorAll('.vak-g-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('.vak-g-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        updateDocentSection();
      });
    });

    // Jaarlaag single-select
    el.querySelectorAll('.jl-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('.jl-toggle').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });

    // Schoolsoort multi-select + update docents
    el.querySelectorAll('.ss-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('selected');
        updateDocentSection();
      });
    });

    // Initial docent toggle listeners
    el.querySelectorAll('.docent-toggle').forEach((btn) => {
      btn.addEventListener('click', () => btn.classList.toggle('selected'));
    });

    // Filter button: toggle showing only students from this group's jaarlaag
    const filterBtn = el.querySelector('#f-g-jl-filter');
    const applyFilter = (active) => {
      el.querySelectorAll('tbody tr').forEach((row) => {
        row.style.display =
          !active || row.dataset.stamklasJl === String(group.jaarlaag) ? '' : 'none';
      });
    };
    if (filterBtn) {
      applyFilter(true);
      filterBtn.addEventListener('click', () => {
        const isActive = filterBtn.dataset.active === '1';
        filterBtn.dataset.active = isActive ? '0' : '1';
        filterBtn.classList.toggle('btn--primary', !isActive);
        filterBtn.classList.toggle('btn--secondary', isActive);
        applyFilter(!isActive);
      });
    }

    // Conflict resolution: checking a box may uncheck others for the same student
    if (isEdit) {
      el.querySelector('tbody')?.addEventListener('change', (e) => {
        if (e.target.type !== 'checkbox' || !e.target.checked) return;
        const sid = e.target.dataset.studentId;
        const sub = e.target.dataset.subcategory;
        el.querySelectorAll(`tbody input[type="checkbox"][data-student-id="${sid}"]`).forEach(
          (cb) => {
            if (cb === e.target) return;
            if (group.subject === 'wi') {
              if (sub && cb.dataset.subcategory === sub) cb.checked = false;
            } else {
              cb.checked = false;
            }
          },
        );
      });
    }

    save = async () => {
      const name = locked ? group.name : el.querySelector('#f-gname').value.trim();
      if (!name) {
        toast('Vul een naam in.', 'error');
        return;
      }

      const jlSelected = el.querySelector('.jl-toggle.selected');
      if (!jlSelected) {
        toast('Selecteer een jaarlaag.', 'error');
        return;
      }
      const jaarlaag = jlSelected.dataset.jl;

      const schoolsoort = [...el.querySelectorAll('.ss-toggle.selected')].map((b) => b.dataset.ss);
      if (schoolsoort.length === 0) {
        toast('Selecteer minimaal één schoolsoort.', 'error');
        return;
      }

      const docenten = [...el.querySelectorAll('.docent-toggle.selected')].map(
        (b) => b.dataset.docentId,
      );

      const vakSelected = el.querySelector('.vak-g-btn.selected');
      if (!vakSelected) {
        toast('Selecteer een vak.', 'error');
        return;
      }
      const resolvedSubject = vakSelected.dataset.vak;
      const parsed = Store.parseGroupName(name, resolvedSubject);
      if (resolvedSubject === 'wi' && !parsed.subcategory) {
        toast(
          'Kan de subcategorie niet afleiden uit de naam. Gebruik bijv. 4wisa1, 5wisb2 of 3wi1 voor onderbouw.',
          'error',
        );
        return;
      }

      if (isEdit) {
        const byGroup = {};
        groupsInJaarlaag.forEach((g) => (byGroup[g.id] = []));
        el.querySelectorAll('tbody input[type="checkbox"]:checked').forEach((cb) => {
          if (byGroup[cb.dataset.groupId]) byGroup[cb.dataset.groupId].push(cb.dataset.studentId);
        });

        const allGroups = await Store.getGroups(year);
        for (const g of groupsInJaarlaag) {
          const existing = allGroups.find((ag) => ag.id === g.id);
          if (!existing) continue;
          const newIds = byGroup[g.id] ?? [];
          const isTarget = g.id === id;
          const nameChanged = isTarget && !locked && name !== existing.name;
          const idsChanged =
            [...existing.student_ids].sort((a, b) => a - b).join(',') !==
            [...newIds].sort((a, b) => a - b).join(',');
          const fieldsChanged =
            isTarget &&
            (JSON.stringify(existing.schoolsoort ?? []) !== JSON.stringify(schoolsoort) ||
              JSON.stringify(existing.docenten ?? []) !== JSON.stringify(docenten) ||
              (!locked && String(existing.jaarlaag) !== jaarlaag));
          if (!idsChanged && !nameChanged && !fieldsChanged) continue;

          let updated = { ...existing, student_ids: newIds };
          if (isTarget) {
            updated = { ...updated, schoolsoort, docenten };
            if (!locked) {
              updated = {
                ...updated,
                name,
                jaarlaag,
                subject: resolvedSubject,
                subcategory: parsed.subcategory ?? undefined,
              };
            }
          }
          await Store.upsertGroup(updated, year);
        }
      } else {
        const gid = Store.makeGroupId();
        await Store.upsertGroup(
          {
            id: gid,
            name,
            jaarlaag,
            subject: resolvedSubject,
            schoolsoort,
            docenten,
            subcategory: parsed.subcategory ?? undefined,
            student_ids: [],
          },
          year,
        );
      }

      dialog.close();
      toast('Groep opgeslagen.', 'success');
      renderGroepen();
    };
  }
}

export async function deleteGroup(id) {
  if (!(await confirmDialog('Groep verwijderen?', { okLabel: 'Verwijderen', danger: true })))
    return;
  const year = SEL.groupsYear.getValue() || Store.getConfigSync().activeYear;
  await Store.deleteGroup(id, year);
  toast('Groep verwijderd.', 'info');
  renderGroepen();
}

const VALID_SCHOOLSOORTEN = [
  'Vmbo-bb',
  'Vmbo-kb',
  'Vmbo-gl',
  'Vmbo-tl',
  'Havo',
  'Vwo',
  'Gymnasium',
];
const VAKKEN_MAP = {
  bio: 'bio',
  biologie: 'bio',
  nat: 'nat',
  natuurkunde: 'nat',
  schk: 'schk',
  scheikunde: 'schk',
  wi: 'wi',
  wiskunde: 'wi',
};
const VALID_JAARLAGEN = ['1', '2', '3', '4', '5', '6'];

const GROUP_FIELD_LABELS = {
  name: 'Naam',
  jaarlaag: 'Leerjaar',
  subject: 'Vak',
  schoolsoort: 'Schoolsoort',
  subcategory: 'Subcategorie',
  docenten: 'Docenten',
};

// Overview of old vs new per overwritten group (D34): changed fields, then
// removed students (red) and added students (green).
function groupOverwritesHtml(overwrites, students, users) {
  const studentName = (id) => {
    const s = students.find((x) => String(x.id) === String(id));
    return s ? Store.fullName(s) : '(onbekende leerling)';
  };
  const show = (field, v) => {
    const list = Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v];
    const names =
      field === 'docenten'
        ? list.map((id) => {
            const u = users.find((x) => x.id === id);
            return u ? Store.fullName(u) : String(id);
          })
        : list.map(String);
    return names.length ? escHtml(names.join(', ')) : '—';
  };
  return overwrites
    .map(
      (o) => `
      <h5 class="group-diff-title">${escHtml(o.name)}</h5>
      <table class="preview-table group-diff"><tbody>
        ${o.fields
          .map(
            (f) =>
              `<tr class="diff-field"><td>${GROUP_FIELD_LABELS[f.field]}</td><td><span class="diff-old">${show(f.field, f.before)}</span> → ${show(f.field, f.after)}</td></tr>`,
          )
          .join('')}
        ${o.removedStudentIds
          .map(
            (id) =>
              `<tr class="diff-removed"><td>− ${escHtml(String(id))}</td><td>${escHtml(studentName(id))}</td></tr>`,
          )
          .join('')}
        ${o.addedStudentIds
          .map(
            (id) =>
              `<tr class="diff-added"><td>+ ${escHtml(String(id))}</td><td>${escHtml(studentName(id))}</td></tr>`,
          )
          .join('')}
      </tbody></table>`,
    )
    .join('');
}

export async function openGroupCSVImport() {
  const cfg = await Store.getConfig();
  const existingYears = Store.listYearsSync();
  const ui = { openModal, closeModal, toast };
  const year = await askSchoolYear(cfg.activeYear, existingYears, ui);
  if (!year) return;

  const users = await Store.loadUsers();

  openModal({
    title: 'Groepen importeren',
    key: 'group-import',
    subtitle: year,
    footerHtml: `
      <button class="btn btn--primary" id="f-csv-grp-import" disabled>Importeren</button>
      <button class="btn btn--secondary" data-close-modal="1">Annuleren</button>
    `,
    body: `
    ${csvExampleHtml(CSV_EXAMPLES.groups)}
    <div class="form-group">
      <label>CSV-bestand</label>
      <input type="file" id="f-csv-groups" accept=".csv,.txt" />
    </div>
    <div id="csv-grp-preview"></div>
    `,
    onShow: (el) => {
      wireCsvExample(el, CSV_EXAMPLES.groups, window.maatwerk, toast);
      let toImport = null;

      el.querySelector('#f-csv-groups').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const { rows } = parseCSV(decodeCsv(new Uint8Array(await file.arrayBuffer())));
        toImport = [];

        for (const r of rows) {
          const naam = (r['Naam'] ?? '').trim();
          const schoolsoortRaw = (r['Schoolsoort'] ?? '').trim();
          const vakRaw = (r['Vak'] ?? '').trim();
          const leerjaarRaw = (r['Leerjaar'] ?? '').trim();
          const docentRaw = (r['Docent'] ?? '').trim();

          if (!naam) {
            toast('Rij overgeslagen: Naam is verplicht.', 'error');
            continue;
          }

          const matchedSS = VALID_SCHOOLSOORTEN.find(
            (ss) => ss.toLowerCase() === schoolsoortRaw.toLowerCase(),
          );
          if (!matchedSS) {
            toast(
              `Rij overgeslagen (${escHtml(naam)}): ongeldige Schoolsoort "${escHtml(schoolsoortRaw)}".`,
              'error',
            );
            continue;
          }

          const matchedVak = VAKKEN_MAP[vakRaw.toLowerCase()];
          if (!matchedVak) {
            toast(
              `Rij overgeslagen (${escHtml(naam)}): ongeldig Vak "${escHtml(vakRaw)}".`,
              'error',
            );
            continue;
          }

          if (!VALID_JAARLAGEN.includes(leerjaarRaw)) {
            toast(
              `Rij overgeslagen (${escHtml(naam)}): ongeldig Leerjaar "${escHtml(leerjaarRaw)}".`,
              'error',
            );
            continue;
          }

          let docentId = null;
          if (docentRaw) {
            const matchedUser = users.find((u) => {
              const fullName = [u.voornaam, u.tussenvoegsel, u.achternaam]
                .filter(Boolean)
                .join(' ');
              return fullName.toLowerCase() === docentRaw.toLowerCase();
            });
            docentId = matchedUser ? matchedUser.id : null;
          }

          const parsed = Store.parseGroupName(naam, matchedVak);
          toImport.push({
            name: naam,
            jaarlaag: leerjaarRaw,
            subject: matchedVak,
            schoolsoort: [matchedSS],
            subcategory: parsed.subcategory ?? undefined,
            docenten: docentId ? [docentId] : [],
            student_ids: [],
          });
        }

        el.querySelector('#csv-grp-preview').innerHTML =
          toImport.length === 0
            ? '<p class="hint">Geen geldige groepen gevonden.</p>'
            : `<p class="u-my-8-4"><strong>${toImport.length}</strong> groepen klaar om te importeren:</p>
               <table class="preview-table">
                 <thead><tr><th>Naam</th><th>Schoolsoort</th><th>Vak</th><th>Leerjaar</th></tr></thead>
                 <tbody>${toImport
                   .map(
                     (g) =>
                       `<tr><td>${escHtml(g.name)}</td><td>${escHtml(g.schoolsoort.join(', '))}</td><td>${escHtml(g.subject)}</td><td>${escHtml(String(g.jaarlaag))}</td></tr>`,
                   )
                   .join('')}</tbody>
               </table>`;
        el.querySelector('#f-csv-grp-import').disabled = toImport.length === 0;
      });

      el.querySelector('#f-csv-grp-import').addEventListener('click', async () => {
        if (!toImport || toImport.length === 0) return;
        // D34: an import replaces existing groups with the same name, including
        // their students; show what changes and ask first. C10: matched by name,
        // since new ids no longer follow from it.
        const existing = await Store.getGroups(year, null);
        toImport = withImportIds(existing, toImport);
        const overwrites = groupOverwrites(existing, toImport);
        if (
          overwrites.length > 0 &&
          !(await confirmDialog(
            `Deze import overschrijft ${overwrites.length === 1 ? '1 bestaande groep' : `${overwrites.length} bestaande groepen`}. Rood: leerlingen die uit de groep verdwijnen; groen: leerlingen die erbij komen.`,
            {
              title: 'Groepen overschrijven?',
              okLabel: 'Overschrijven',
              danger: true,
              detailsHtml: groupOverwritesHtml(overwrites, Store.getStudentsSync(year), users),
            },
          ))
        ) {
          return;
        }
        await Store.upsertGroups(toImport, year);
        closeModal();
        toast(`${toImport.length} groepen geïmporteerd voor ${year}.`, 'success');
        renderGroepen();
      });
    },
  });
}

export async function openGroupAssignmentCSVImport() {
  const cfg = await Store.getConfig();
  const existingYears = Store.listYearsSync();
  const ui = { openModal, closeModal, toast };
  const year = await askSchoolYear(cfg.activeYear, existingYears, ui);
  if (!year) return;

  openModal({
    title: 'Groepsindeling importeren',
    key: 'group-assignment-import',
    subtitle: year,
    footerHtml: `
      <button class="btn btn--primary" id="f-csv-assignment-import" disabled>Importeren</button>
      <button class="btn btn--secondary" data-close-modal="1">Annuleren</button>
    `,
    body: `
    ${csvExampleHtml(CSV_EXAMPLES.assignment)}
    <div class="form-group">
      <label>CSV-bestand</label>
      <input type="file" id="f-csv-assignment" accept=".csv,.txt" />
    </div>
    <div id="csv-assignment-preview"></div>
    `,
    onShow: (el) => {
      wireCsvExample(el, CSV_EXAMPLES.assignment, window.maatwerk, toast);
      let assignments = null;

      el.querySelector('#f-csv-assignment').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const { rows } = parseCSV(decodeCsv(new Uint8Array(await file.arrayBuffer())));

        const groups = Store.getGroupsSync(year, null);
        const students = Store.getStudentsSync(year);
        assignments = [];

        for (const r of rows) {
          const naam = (r['Naam'] ?? '').trim();
          const leerlingnummerRaw = (r['Leerlingnummer'] ?? '').trim();

          const group = groups.find((g) => g.name === naam);
          if (!group) {
            toast(`Groep met ${escHtml(naam)} bestaat niet.`, 'error');
            continue;
          }

          const student = students.find((s) => String(s.id) === leerlingnummerRaw);
          if (!student) {
            toast(
              `Leerling met leerlingnummer ${escHtml(leerlingnummerRaw)} bestaat niet.`,
              'error',
            );
            continue;
          }

          assignments.push({ groupId: group.id, studentId: student.id });
        }

        el.querySelector('#csv-assignment-preview').innerHTML =
          assignments.length === 0
            ? '<p class="hint">Geen geldige koppelingen gevonden.</p>'
            : `<p class="u-my-8-4"><strong>${assignments.length}</strong> koppelingen klaar om te importeren.</p>`;
        el.querySelector('#f-csv-assignment-import').disabled = assignments.length === 0;
      });

      el.querySelector('#f-csv-assignment-import').addEventListener('click', async () => {
        if (!assignments || assignments.length === 0) return;

        const byGroup = {};
        for (const { groupId, studentId } of assignments) {
          (byGroup[groupId] ??= new Set()).add(studentId);
        }

        const allGroups = await Store.getGroups(year, null);
        for (const [groupId, studentIds] of Object.entries(byGroup)) {
          const group = allGroups.find((g) => g.id === groupId);
          if (!group) continue;
          const newIds = [...new Set([...group.student_ids, ...studentIds])];
          await Store.upsertGroup({ ...group, student_ids: newIds }, year);
        }

        closeModal();
        toast(`Groepsindelingen geïmporteerd voor ${year}.`, 'success');
        renderGroepen();
      });
    },
  });
}

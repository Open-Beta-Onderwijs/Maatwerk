// SPDX-License-Identifier: AGPL-3.0-or-later

// ── CSV utilities ─────────────────────────────────────────────────────────────

// Parsing and decoding: src/domain/csv.ts. Kept as a re-export for the screens.
export { decodeCsv, parseCSV } from '../domain/csv';

/**
 * Show a year-selection modal before running a CSV import.
 * Returns a promise that resolves to the chosen year or null.
 *
 * @param {string}   activeYear
 * @param {string[]} existingYears
 * @param {{ openModal: Function, closeModal: Function, toast: Function }} ui
 */
export function askSchoolYear(activeYear, existingYears, ui) {
  const { openModal, closeModal, toast } = ui;
  return new Promise((resolve) => {
    const allYears = [...new Set([activeYear, ...existingYears])].sort((a, b) =>
      b.localeCompare(a),
    );
    openModal({
      title: 'Schooljaar kiezen',
      key: 'school-year',
      size: 'sm',
      footerHtml: `
        <button class="btn btn--primary" id="f-year-ok">Verder</button>
        <button class="btn btn--secondary" data-close-modal="1">Annuleren</button>`,
      body: `
      <p class="muted u-mb-12">
        Voor welk schooljaar wil je deze gegevens importeren?
        Als het schooljaar al bestaat, worden de gegevens bijgewerkt.
      </p>
      <div class="form-group">
        <label>Schooljaar</label>
        <div id="f-import-year-host" class="csel-host"></div>
      </div>
      <div class="form-group">
        <label>Of voer een schooljaar in</label>
        <input id="f-import-year-custom" type="text" placeholder="2025-2026" />
      </div>
    `,
      onShow: (el) => {
        const yearSel = new CustomSelect(el.querySelector('#f-import-year-host'), {
          placeholder: '— kies schooljaar —',
        });
        yearSel.setOptions(allYears.map((y) => ({ value: y, label: y })));
        yearSel.setValue(activeYear);

        el.querySelector('#f-year-ok').addEventListener('click', () => {
          const custom = el.querySelector('#f-import-year-custom').value.trim();
          const chosen = custom || yearSel.getValue();
          if (!chosen) {
            toast('Kies een schooljaar.', 'error');
            return;
          }
          resolve(chosen);
          closeModal();
        });
      },
      // Closed any other way (Annuleren, ✕, Escape, backdrop): no year.
      onClose: () => resolve(null),
    });
  });
}

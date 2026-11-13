// SPDX-License-Identifier: AGPL-3.0-or-later

// An example CSV in the import dialogs (F-02): shown, and saved with "Voorbeeld
// opslaan…" as a file to fill in (semicolons, as Dutch Excel writes them; the
// import also takes commas). The names are made up.

export interface CsvExample {
  /** The suggested file name. */
  file: string;
  text: string;
}

export const CSV_EXAMPLES = {
  students: {
    file: 'Voorbeeld leerlingen.csv',
    text: [
      'Leerlingnummer;Voornaam;Tussenvoegsel;Achternaam;Geslacht;Stamklas;Jaarlaag;Schoolsoort',
      '100001;Anna;de;Vries;V;3a;3;Havo',
      '100002;Bram;;Jansen;M;3a;3;Havo, Vwo',
      '100003;Chris;van;Dijk;X;4b;4;Vwo',
    ].join('\r\n'),
  },
  groups: {
    file: 'Voorbeeld groepen.csv',
    text: [
      'Naam;Schoolsoort;Vak;Leerjaar;Docent',
      '3a nat;Havo;Natuurkunde;3;Jan de Vries',
      '4b bio;Vwo;Biologie;4;',
    ].join('\r\n'),
  },
  assignment: {
    file: 'Voorbeeld groepsindeling.csv',
    text: ['Naam;Leerlingnummer', '3a nat;100001', '3a nat;100002', '4b bio;100003'].join('\r\n'),
  },
} satisfies Record<string, CsvExample>;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The example block: the columns, the example and the save button. */
export function csvExampleHtml(example: CsvExample): string {
  const columns = example.text.split(/\r?\n/)[0]!.split(';').join(', ');
  return `
    <div class="csv-example">
      <p class="muted">Verwachte kolommen: <code>${esc(columns)}</code></p>
      <pre class="csv-example__text" aria-label="Voorbeeld">${esc(example.text)}</pre>
      <button type="button" class="btn btn--secondary btn--sm" data-action="save-csv-example">Voorbeeld opslaan…</button>
    </div>`;
}

/** Wires the save button in `root`; `toast` reports the outcome. */
export function wireCsvExample(
  root: HTMLElement,
  example: CsvExample,
  api: { saveTextAs(name: string, content: string): Promise<string | null> },
  toast: (message: string, type?: string) => void,
): void {
  root.querySelector('[data-action="save-csv-example"]')?.addEventListener('click', async () => {
    try {
      const path = await api.saveTextAs(example.file, example.text);
      if (path) toast(`Opgeslagen: ${path}`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  });
}

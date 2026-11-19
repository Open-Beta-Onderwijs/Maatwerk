// SPDX-License-Identifier: AGPL-3.0-or-later

// The first-use notice (decision 70, board 62; step 32c): once per teacher on this computer,
// before the first conversation. What is sent and what never is, the own-subscription text,
// the image warning (also for the PDF-output) and "Begrepen", which stores `noticeSeen`.

import type { AiApi } from '../bridge/ai-api';
import { openDialog } from '../components/dialog';
import { h, icon } from '../editor/ai/dom';

const SENT = [
  'De tekst van deze opdracht (opdracht.typ) en de opmaakbestanden',
  'De context die jij aanzet: opdrachtinstructies AI, opdrachtgegevens, fouten & waarschuwingen, PDF-output, syllabus, andere opdrachten',
  'Je eigen berichten en bijlagen',
  'Afbeeldingen alleen als jij dat per bericht aanzet',
];

const NEVER = [
  'Namen, cijfers en scores van leerlingen',
  'Rapporten, toetsanalyses en groepen',
  'Andere opdrachten, tenzij je ze kiest',
  'Bestanden buiten deze opdracht',
];

function column(title: string, items: string[], kind: 'sent' | 'never'): HTMLElement {
  return h(
    'div',
    { class: `ain-col ain-col--${kind}` },
    h('span', { class: 'ais-cap' }, title),
    h(
      'ul',
      {},
      ...items.map((t) => h('li', {}, icon(kind === 'sent' ? 'check' : 'x', 15, 2.6), t)),
    ),
  );
}

/**
 * Shows the notice unless the teacher confirmed it before. Resolves true when it was seen
 * (now or earlier), false when the teacher closed it without "Begrepen".
 */
export async function ensureAiNotice(ai: AiApi, gebruiker: string): Promise<boolean> {
  const { settings } = await ai.detect(gebruiker, false);
  if (settings.noticeSeen) return true;
  return new Promise<boolean>((resolve) => {
    let ok = false;
    openDialog({
      title: 'Voordat je de AI-assistent gebruikt',
      size: 'form',
      className: 'ai-notice',
      dialogId: 'ai-notice',
      body: h(
        'div',
        { class: 'ain-body' },
        h(
          'p',
          { class: 'ain-lead' },
          'De AI draait via het programma dat jij hebt geïnstalleerd (zoals Claude Code of ' +
            'Codex) en gebruikt jouw eigen account of abonnement. Maatwerk ziet je ' +
            'inloggegevens niet en betaalt niets; de voorwaarden van die aanbieder gelden.',
        ),
        h(
          'div',
          { class: 'ain-cols' },
          column('WORDT VERSTUURD', SENT, 'sent'),
          column('WORDT NOOIT VERSTUURD', NEVER, 'never'),
        ),
        h(
          'div',
          { class: 'ain-warn', role: 'note' },
          icon('warn', 16, 2.2),
          h(
            'span',
            {},
            h('strong', {}, 'Let op afbeeldingen.'),
            ' Foto’s in een opdracht of in een bijlage kunnen leerlingen tonen. Stuur ze alleen ' +
              'mee als er geen leerlingen op staan. Ook de PDF-output bevat de afbeeldingen.',
          ),
        ),
        h(
          'p',
          { class: 'ain-foot' },
          'De AI schrijft nooit zelf in je opdracht: je krijgt een voorstel en kiest zelf wat ' +
            'je toepast.',
        ),
      ),
      footer: [
        {
          label: 'Begrepen',
          variant: 'primary',
          id: 'ok',
          onClick: async (dialog) => {
            await ai.saveSettings(gebruiker, { ...settings, noticeSeen: true });
            ok = true;
            dialog.close();
          },
        },
      ],
      onClose: () => resolve(ok),
    });
  });
}

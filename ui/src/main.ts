// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from '@tauri-apps/api/core';
import { formatGreeting, type GreetReply } from './greet';

const form = document.querySelector<HTMLFormElement>('#greet-form');
const input = document.querySelector<HTMLInputElement>('#greet-name');
const output = document.querySelector<HTMLParagraphElement>('#greet-output');

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!input || !output) return;
  invoke<GreetReply>('greet', { name: input.value })
    .then((reply) => {
      output.textContent = formatGreeting(reply);
    })
    .catch((error: unknown) => {
      output.textContent = `Er ging iets mis: ${String(error)}`;
    });
});

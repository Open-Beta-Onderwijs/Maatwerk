// SPDX-License-Identifier: AGPL-3.0-or-later

// An on/off switch (board 62: 40 × 22 px track, 18 px knob) with a label and an optional
// explanation under it: `<button role="switch" aria-checked>` inside a label row (step 32c).
// Styles: `.switch` in styles/controls.css.

export interface Switch {
  /** The row: the switch, then the label text and the hint. */
  element: HTMLElement;
  button: HTMLButtonElement;
  checked(): boolean;
  set(checked: boolean): void;
}

export function switchControl(opts: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}): Switch {
  let on = opts.checked;
  const row = document.createElement('div');
  row.className = 'switch-row';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'switch';
  button.id = opts.id;
  button.setAttribute('role', 'switch');
  button.disabled = opts.disabled === true;
  button.append(Object.assign(document.createElement('span'), { className: 'switch__knob' }));
  const text = document.createElement('span');
  text.className = 'switch-row__text';
  const label = document.createElement('label');
  label.className = 'switch-row__label';
  label.htmlFor = opts.id;
  label.textContent = opts.label;
  text.append(label);
  if (opts.hint) {
    const hint = document.createElement('span');
    hint.className = 'switch-row__hint';
    hint.id = `${opts.id}-hint`;
    hint.textContent = opts.hint;
    button.setAttribute('aria-describedby', hint.id);
    text.append(hint);
  }
  row.append(button, text);

  const show = () => button.setAttribute('aria-checked', String(on));
  show();
  button.addEventListener('click', () => {
    on = !on;
    show();
    opts.onChange?.(on);
  });
  return {
    element: row,
    button,
    checked: () => on,
    set(checked: boolean) {
      on = checked;
      show();
    },
  };
}

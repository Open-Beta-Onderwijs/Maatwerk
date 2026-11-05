// SPDX-License-Identifier: AGPL-3.0-or-later

import { escHtml, navigateTo, showUserBadge } from '../app.js';
import { scoreSavesDone } from './scores.js';
import { showAbout } from './about';
import { pinLogin } from './pin';
import { avatarHtml, loadAvatarPhotos } from '../components/avatar';

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Startup — two-step subject + user picker, then the PIN (Step 7b)
// ═══════════════════════════════════════════════════════════════════════════════

const SUBJECT_EMOJI = { nat: '⚡', bio: '🌱', schk: '⚗️', wi: '📐' };

export async function renderStartup() {
  const container = document.getElementById('screen-startup');

  const [users, session] = await Promise.all([
    Store.loadUsers(),
    Store.loadLastSession(),
    Store.loadSchool(),
  ]);

  let selectedSubject = session?.lastSubject ?? null;

  // If the remembered subject no longer exists in SUBJECT_DISPLAY, clear it.
  if (selectedSubject && !Store.SUBJECT_DISPLAY[selectedSubject]) selectedSubject = null;

  function getUsersForSubject(subject) {
    return users.filter((u) => u.actief && !u.isAdmin && u.vakken.includes(subject));
  }

  const adminUser = users.find((u) => u.isAdmin && u.actief) ?? null;

  // Sectievoorzitter of the subject (decision 13): an active teacher of that vak.
  function voorzitterFor(subject) {
    const id = Store.voorzitterOf(subject);
    return getUsersForSubject(subject).find((u) => u.id === id) ?? null;
  }

  function voorzitterLabel(subject) {
    return `Sectievoorzitter ${Store.SUBJECT_DISPLAY[subject] ?? subject}`;
  }

  // The teacher's initials in a square badge; `data-voorzitter-id` (not
  // data-user-id) keeps the teacher's own badge the only one with their id.
  function renderVoorzitterBadge(user, subject) {
    return `
      <button class="user-badge badge-voorzitter" data-voorzitter-id="${escHtml(user.id)}"
              title="${escHtml(voorzitterLabel(subject))}">
        ${avatarHtml(user, { size: 56, square: true })}
        <span class="badge-name">${escHtml(user.voornaam)}</span>
        <span class="badge-voorzitter-label">Sectievoorzitter</span>
      </button>`;
  }

  function renderBadge(user) {
    // U7: every user field is escaped (the reference inserted them raw).
    return `
      <button class="user-badge" data-user-id="${escHtml(user.id)}">
        ${avatarHtml(user, { size: 56 })}
        <span class="badge-name">${escHtml(user.voornaam)}</span>
      </button>`;
  }

  function render() {
    const subjectButtons = Object.entries(Store.SUBJECT_DISPLAY)
      .map(([key, label]) => {
        const cls = selectedSubject === key ? 'selected' : selectedSubject ? 'dimmed' : '';
        return `
          <button class="subject-card ${cls}" data-subject="${key}">
            <span class="subject-emoji">${SUBJECT_EMOJI[key] ?? ''}</span>
            <span class="subject-label">${label}</span>
          </button>`;
      })
      .join('');

    let mainContent;
    if (selectedSubject) {
      const subjectUsers = getUsersForSubject(selectedSubject);
      const userBadges = subjectUsers.map(renderBadge).join('');
      const voorzitter = voorzitterFor(selectedSubject);
      const voorzitterBadge = voorzitter
        ? `<div class="badge-separator"></div>${renderVoorzitterBadge(voorzitter, selectedSubject)}`
        : '';
      const adminBadge = adminUser
        ? `<div class="badge-separator"></div>${renderBadge(adminUser)}`
        : '';
      mainContent = `
        <p class="startup-main-hint">Kies een gebruiker</p>
        <div class="user-badge-grid">
          ${userBadges}
          ${voorzitterBadge}
          ${adminBadge}
        </div>`;
    } else {
      mainContent = `<p class="startup-main-hint startup-main-hint--empty">← Selecteer een vak om te beginnen</p>`;
    }

    container.innerHTML = `
      <div class="startup-layout">
        <aside class="startup-sidebar">
          <p class="startup-sidebar-hint">Vak</p>
          ${subjectButtons}
          <button class="startup-about-link" data-action="about">Over Maatwerk</button>
        </aside>
        <main class="startup-main">
          ${mainContent}
        </main>
      </div>`;

    attachListeners();
  }

  async function loadBadgePhotos() {
    await loadAvatarPhotos(container, (rel) => window.maatwerk.readPhotoAsDataUrl(rel));
  }

  // The PIN first (Step 7b); then the session starts as before.
  async function logIn(user, role) {
    const label = role ? voorzitterLabel(role.voorzitter) : '';
    const fresh = await pinLogin(user, window.maatwerk, label);
    if (!fresh) return;
    Store.cacheUser(fresh);
    // Score saves still queued belong to the previous user (review 3b M1).
    await scoreSavesDone();
    Store.setActiveUser(fresh, role);
    await Store.initSubject(selectedSubject);
    await Store.saveLastSession(selectedSubject, fresh.id);
    await showUserBadge(fresh, selectedSubject);
    navigateTo('leerlingen');
  }

  function attachListeners() {
    container.querySelector('[data-action="about"]').addEventListener('click', showAbout);
    container.querySelectorAll('[data-subject]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedSubject = btn.dataset.subject;
        render();
        loadBadgePhotos();
      });
    });

    container.querySelectorAll('[data-user-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const user = users.find((u) => u.id === btn.dataset.userId);
        if (user) void logIn(user, null);
      });
    });
    container.querySelectorAll('[data-voorzitter-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const user = users.find((u) => u.id === btn.dataset.voorzitterId);
        if (user) void logIn(user, { voorzitter: selectedSubject });
      });
    });
  }

  render();
  if (selectedSubject) loadBadgePhotos();
}

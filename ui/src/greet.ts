// SPDX-License-Identifier: AGPL-3.0-or-later

/** Reply of the `greet` command (src-tauri/src/lib.rs). */
export interface GreetReply {
  message: string;
  coreVersion: string;
}

/** Dutch status line shown under the greeting form. */
export function formatGreeting(reply: GreetReply): string {
  return `${reply.message} (maatwerk-core ${reply.coreVersion})`;
}

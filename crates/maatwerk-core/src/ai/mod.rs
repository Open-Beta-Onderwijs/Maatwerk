// SPDX-License-Identifier: AGPL-3.0-or-later

//! The AI assistant's bridge to the teacher's own AI CLI (step 32a; ADR-0009 option D as amended,
//! `PLAN-2.md` decisions 48-77, the CLI research in ADR-0009).
//!
//! Maatwerk never talks to a model itself. It finds the CLIs the teacher installed
//! ([`detect`]), prepares a workspace outside the data folder with a copy of the opdracht and
//! the context the teacher switched on ([`workspace`]), runs the CLI there non-interactively
//! under a time limit with streamed, normalised events ([`run`], [`events`]), keeps the
//! conversation in local app data ([`history`]), and turns what the CLI left in the workspace
//! into a proposal restricted to `opdracht.typ` and `images/`, with hunks that can be rebased
//! onto the editor's current buffer ([`diff`]).
//!
//! Privacy (ADR-0009 constraint 1): nothing from the data folder but the one opdracht (and the
//! other opdrachten the teacher picks) goes into a workspace; images only when the teacher
//! switched them on, otherwise same-size placeholders so the opdracht still compiles.

pub mod detect;
pub mod events;
pub mod provider;
pub mod run;

pub use provider::{AiSettings, Builtin, ProviderKey};

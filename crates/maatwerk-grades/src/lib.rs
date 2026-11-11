// SPDX-License-Identifier: AGPL-3.0-or-later

//! The one implementation of Maatwerk's grade rules: native for the core, CLI and rapport,
//! WebAssembly for the UI (ADR-0011). The rules and the user's decisions behind them are in
//! `docs/phase-2/step-19-grade-rules.md`; "decision N" below refers to its section 6.
//!
//! Pure: no I/O, no clock. Numbers are computed from grades rounded to one decimal (decision 2),
//! so a teacher can check every average by hand from the numbers on screen.

pub mod attempts;
pub mod averages;
pub mod grade;
pub mod groups;
pub mod model;
pub mod rapport;
pub mod round;
pub mod rtti;
pub mod rubric;
pub mod stats;
pub mod trend;

pub use attempts::{BestEntry, HistoryEntry, best_attempt, resolve_best_attempts};
pub use averages::{mean_of_averages, se_average, stats_of_averages, year_average};
pub use grade::{Results, RttiPct, calc_grade, calc_results, exam_results};
pub use groups::student_group;
pub use model::{Exam, Group, Override, Question, QuestionKind, ScoreRecord, ScoreValue};
pub use round::{clean, is_fail, round0, round1};
pub use stats::{BoxStats, Stats, box_stats, grade_group, histogram, stats};
pub use trend::{Trend, TrendLevel, trend};

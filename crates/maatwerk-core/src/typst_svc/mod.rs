// SPDX-License-Identifier: AGPL-3.0-or-later

//! The Typst service (ADR-0002 section 5): a sandboxed `World` per compile, embedded templates,
//! packages and fonts, structured diagnostics.
//! Rapport (5a); opdracht projects, SVG pages, batch and merge (5b); live editor session (8a);
//! editor help from `typst-ide` (8b).

mod batch;
mod compile;
mod diagnostics;
mod editor;
mod fonts;
mod ide;
mod opdracht;
mod project;
mod rapport;
mod vragen;
pub(crate) mod world;

pub use batch::{
    BatchError, BatchJob, BatchOptions, BatchOutput, BatchProgress, JobWarning, batch_workers,
    render_assignment_batch,
};
pub use compile::{
    CompileError, Compiled, compile_document, compile_pdf, compile_svg_pages, local_now,
};
pub use diagnostics::{Diagnostic, Location, Severity, TraceFrame, to_text};
pub use editor::{
    DEFAULT_COMPILE_TIMEOUT, DEFAULT_DEBOUNCE, EditorSession, EditorSettings, EditorUpdate,
    LiveEditor, LiveOptions, PageUpdate, SessionFactory, timeout_message,
};
pub use fonts::FontStore;
pub use ide::{
    ClickTarget, CompletionItem, Completions, HoverText, JumpAnswer, PreviewPoint, SourceRange,
};
pub use opdracht::{
    INPUTS_KEY, Mode, Observatie, OpdrachtHeader, OpdrachtInputs, opdracht_world,
    render_assignment_pdf, render_assignment_svg_pages,
};
pub use project::{
    ProjectFileState, ProjectFileStatus, TypstProject, bundled_project_file, check_project_files,
    create_opdracht_folder, restore_project_file, v1_opdracht_id,
};
pub use rapport::{RapportData, rapport_world, render_rapport_pdf};
pub use vragen::{Vraag, Vragen, vragen};
pub use world::MaatwerkWorld;

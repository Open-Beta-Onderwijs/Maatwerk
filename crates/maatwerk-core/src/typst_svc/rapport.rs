// SPDX-License-Identifier: AGPL-3.0-or-later

//! The rapport (path A of `typst-contract.md`): all students of one toets in one PDF, and the
//! PO rapport (step 24): all graded students of one PO.
//!
//! The World holds `/__maatwerk/main.typ` (entry), `/__maatwerk/rapport.typ` (template; the PO
//! rapport also `rapport-po.typ`, which imports the shared parts of `rapport.typ`) and
//! `/__maatwerk/data.json` (this request), and mounts only `/data/afbeeldingen` (the watermark,
//! drawn only when it exists).

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use typst::foundations::Bytes;

use super::compile::{CompileError, Compiled, compile_pdf};
use super::fonts::FontStore;
use super::world::{INTERNAL_DIR, MaatwerkWorld, Mount, WorldSpec};
use crate::assets;
use crate::paths::DataDir;
use crate::storage::IMAGES_DIR;

/// The data the UI builds for the rapport (`ui/src/domain/rapport.ts`, `typst-contract.md` 2.1).
/// Passed to the template unchanged as JSON; the template is the consumer of the field contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RapportData {
    pub exam_info: serde_json::Value,
    pub students: serde_json::Value,
}

/// The data the UI builds for the PO rapport (`ui/src/domain/po-rapport.ts`; the field contract
/// is at the top of `rapport-po.typ`). Passed to the template unchanged as JSON.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PoRapportData {
    pub po_info: serde_json::Value,
    pub students: serde_json::Value,
}

/// The school's watermark, relative to the data folder (`/data/afbeeldingen/...` in the
/// template; `fotos/` before format v3).
const WATERMARK: &str = "afbeeldingen/school-watermerk.svg";

/// A larger watermark file is left out of the rapport.
const WATERMARK_MAX: u64 = 5 * 1024 * 1024;

/// What the entry point reads from `data.json`.
#[derive(Serialize)]
struct Payload<'a, D> {
    #[serde(flatten)]
    data: &'a D,
    watermark: bool,
}

/// The sandboxed World for one rapport.
pub fn rapport_world(
    fonts: Arc<FontStore>,
    data: &RapportData,
    data_dir: &DataDir,
    now: OffsetDateTime,
) -> MaatwerkWorld {
    world(fonts, assets::RAPPORT_MAIN_TYP, &[], data, data_dir, now)
}

/// The sandboxed World for one PO rapport.
pub fn po_rapport_world(
    fonts: Arc<FontStore>,
    data: &PoRapportData,
    data_dir: &DataDir,
    now: OffsetDateTime,
) -> MaatwerkWorld {
    world(
        fonts,
        assets::RAPPORT_PO_MAIN_TYP,
        &[("rapport-po.typ", assets::RAPPORT_PO_TYP)],
        data,
        data_dir,
        now,
    )
}

/// A rapport World: `main` as the entry, `rapport.typ` and `extra` templates beside it.
fn world<D: Serialize>(
    fonts: Arc<FontStore>,
    main: &'static str,
    extra: &[(&str, &'static str)],
    data: &D,
    data_dir: &DataDir,
    now: OffsetDateTime,
) -> MaatwerkWorld {
    // T4: the template draws the watermark only when the school has one (the reference failed
    // without it). Looked up as the World does, so `Fotos/` from a Windows folder counts (T32).
    let watermark = super::world::find_ignoring_case(data_dir.root(), WATERMARK.split('/'))
        // Not through a link: the World refuses one, and the rapport would fail as before T4.
        // Nor a huge file, which only a broken or hostile upload makes (security review m4).
        .is_some_and(|p| {
            std::fs::symlink_metadata(p).is_ok_and(|m| m.is_file() && m.len() <= WATERMARK_MAX)
        });
    let json =
        serde_json::to_vec(&Payload { data, watermark }).expect("JSON values always serialise");
    let file = |name: &str| format!("/{INTERNAL_DIR}/{name}");
    let mut files = vec![
        (file("main.typ"), Bytes::from_string(main)),
        (file("rapport.typ"), Bytes::from_string(assets::RAPPORT_TYP)),
        (file("data.json"), Bytes::new(json)),
    ];
    files.extend(
        extra
            .iter()
            .map(|(name, text)| (file(name), Bytes::from_string(*text))),
    );
    MaatwerkWorld::new(
        fonts,
        WorldSpec {
            main: file("main.typ"),
            files,
            mounts: vec![
                // The folder as spelled on disk: a Windows-made `Afbeeldingen/` on Linux
                // (security review n2).
                Mount::dir(
                    "/data/afbeeldingen",
                    super::world::find_ignoring_case(data_dir.root(), [IMAGES_DIR])
                        .unwrap_or_else(|| data_dir.root().join(IMAGES_DIR)),
                )
                .within(data_dir.root()),
            ],
            inputs: None,
            now,
        },
    )
}

/// Compiles the rapport to PDF.
pub fn render_rapport_pdf(
    fonts: Arc<FontStore>,
    data: &RapportData,
    data_dir: &DataDir,
    now: OffsetDateTime,
) -> Result<Compiled<Vec<u8>>, CompileError> {
    compile_pdf(&rapport_world(fonts, data, data_dir, now))
}

/// Compiles the PO rapport to PDF.
pub fn render_po_rapport_pdf(
    fonts: Arc<FontStore>,
    data: &PoRapportData,
    data_dir: &DataDir,
    now: OffsetDateTime,
) -> Result<Compiled<Vec<u8>>, CompileError> {
    compile_pdf(&po_rapport_world(fonts, data, data_dir, now))
}

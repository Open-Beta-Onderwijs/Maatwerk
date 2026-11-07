// SPDX-License-Identifier: AGPL-3.0-or-later

//! The rapport (path A of `typst-contract.md`): all students of one toets in one PDF.
//!
//! The World holds `/__maatwerk/main.typ` (entry), `/__maatwerk/rapport.typ` (template) and
//! `/__maatwerk/data.json` (this request), and mounts only `/data/fotos` (the watermark, drawn only when it exists).

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use typst::foundations::Bytes;

use super::compile::{CompileError, Compiled, compile_pdf};
use super::fonts::FontStore;
use super::world::{INTERNAL_DIR, MaatwerkWorld, Mount, WorldSpec};
use crate::assets;
use crate::paths::DataDir;

/// The data the UI builds for the rapport (`ui/src/domain/rapport.ts`, `typst-contract.md` 2.1).
/// Passed to the template unchanged as JSON; the template is the consumer of the field contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RapportData {
    pub exam_info: serde_json::Value,
    pub students: serde_json::Value,
}

/// The school's watermark, relative to the data folder (`/data/fotos/...` in the template).
const WATERMARK: &str = "fotos/school-watermerk.svg";

/// What `rapport-main.typ` reads from `data.json`.
#[derive(Serialize)]
struct Payload<'a> {
    #[serde(flatten)]
    data: &'a RapportData,
    watermark: bool,
}

/// The sandboxed World for one rapport.
pub fn rapport_world(
    fonts: Arc<FontStore>,
    data: &RapportData,
    data_dir: &DataDir,
    now: OffsetDateTime,
) -> MaatwerkWorld {
    // T4: the template draws the watermark only when the school has one (the reference failed
    // without it). Looked up as the World does, so `Fotos/` from a Windows folder counts (T32).
    let watermark = super::world::find_ignoring_case(data_dir.root(), WATERMARK.split('/'))
        .is_some_and(|p| p.is_file());
    let json =
        serde_json::to_vec(&Payload { data, watermark }).expect("JSON values always serialise");
    let file = |name: &str| format!("/{INTERNAL_DIR}/{name}");
    MaatwerkWorld::new(
        fonts,
        WorldSpec {
            main: file("main.typ"),
            files: vec![
                (
                    file("main.typ"),
                    Bytes::from_string(assets::RAPPORT_MAIN_TYP),
                ),
                (file("rapport.typ"), Bytes::from_string(assets::RAPPORT_TYP)),
                (file("data.json"), Bytes::new(json)),
            ],
            mounts: vec![
                Mount::dir("/data/fotos", data_dir.root().join("fotos")).within(data_dir.root()),
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

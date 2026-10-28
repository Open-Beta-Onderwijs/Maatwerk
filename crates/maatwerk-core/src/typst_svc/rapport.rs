// SPDX-License-Identifier: AGPL-3.0-or-later

//! The rapport (path A of `typst-contract.md`): all students of one toets in one PDF.
//!
//! The World holds `/__maatwerk/main.typ` (entry), `/__maatwerk/rapport.typ` (template) and
//! `/__maatwerk/data.json` (this request), and mounts only `/data/fotos` (the watermark).

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

/// The sandboxed World for one rapport.
pub fn rapport_world(
    fonts: Arc<FontStore>,
    data: &RapportData,
    data_dir: &DataDir,
    now: OffsetDateTime,
) -> MaatwerkWorld {
    let json = serde_json::to_vec(data).expect("JSON values always serialise");
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
            mounts: vec![Mount::new("/data/fotos", data_dir.root().join("fotos"))],
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

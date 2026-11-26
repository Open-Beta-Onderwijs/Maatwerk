// SPDX-License-Identifier: AGPL-3.0-or-later

//! The rapport (path A of `typst-contract.md`): all students of one toets in one PDF, and the
//! PO rapport (step 24): all graded students of one PO.
//!
//! The World holds `/__maatwerk/main.typ` (entry), `/__maatwerk/rapport.typ` (template; the PO
//! rapport also `rapport-po.typ`, which imports the shared parts of `rapport.typ`) and
//! `/__maatwerk/data.json` (this request), and mounts only `/data/afbeeldingen` (the watermark,
//! drawn only when it exists).

use std::collections::HashSet;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::OffsetDateTime;
use typst::foundations::Bytes;

use super::compile::{CompileError, Compiled, compile_document, compile_pdf};
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
            mounts: vec![images_mount(data_dir)],
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
    compile_pdf(&rapport_world(fonts.clone(), data, data_dir, now))
        .map_err(|e| name_eval_field(e, &fonts, data_dir, now, &rapport_eval_fields(data)))
}

/// Compiles the PO rapport to PDF.
pub fn render_po_rapport_pdf(
    fonts: Arc<FontStore>,
    data: &PoRapportData,
    data_dir: &DataDir,
    now: OffsetDateTime,
) -> Result<Compiled<Vec<u8>>, CompileError> {
    compile_pdf(&po_rapport_world(fonts.clone(), data, data_dir, now))
        .map_err(|e| name_eval_field(e, &fonts, data_dir, now, &po_eval_fields(data)))
}

/// A teacher text the template evaluates as markup (`eval` in `rapport.typ`), and where the
/// teacher finds it, in the words of the hint.
struct EvalField {
    place: String,
    text: String,
}

fn str_of<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

fn items(v: &Value) -> &[Value] {
    v.as_array().map_or(&[], Vec::as_slice)
}

/// The toets rapport's markup texts: the RTTI explanations, then each student's leeradvies rows.
fn rapport_eval_fields(data: &RapportData) -> Vec<EvalField> {
    let mut out: Vec<EvalField> = ["R", "T1", "T2", "I"]
        .into_iter()
        .map(|cat| EvalField {
            place: format!("de uitleg bij {cat}"),
            text: str_of(&data.exam_info["uitleg_rtti"], cat).to_owned(),
        })
        .collect();
    for s in items(&data.students) {
        for row in items(&s["leeradvies_rows"]) {
            out.push(EvalField {
                place: format!(
                    "het leeradvies bij {} voor {}",
                    str_of(row, "cat"),
                    str_of(s, "name")
                ),
                text: str_of(row, "advies").to_owned(),
            });
        }
    }
    out
}

/// The PO rapport's markup texts: the leeradvies of each observatie, general or per category.
fn po_eval_fields(data: &PoRapportData) -> Vec<EvalField> {
    let mut out = Vec::new();
    for s in items(&data.students) {
        let general = items(&s["observaties"]).iter();
        let per_category = items(&s["categories"])
            .iter()
            .flat_map(|c| items(&c["observaties"]));
        for o in general.chain(per_category) {
            out.push(EvalField {
                place: format!(
                    "het leeradvies bij de observatie {} voor {}",
                    str_of(o, "naam"),
                    str_of(s, "name")
                ),
                text: str_of(o, "leeradvies").to_owned(),
            });
        }
    }
    out
}

/// `/data/afbeeldingen`: the folder as spelled on disk, so a Windows-made `Afbeeldingen/` works
/// on Linux (security review n2).
fn images_mount(data_dir: &DataDir) -> Mount {
    Mount::dir(
        "/data/afbeeldingen",
        super::world::find_ignoring_case(data_dir.root(), [IMAGES_DIR])
            .unwrap_or_else(|| data_dir.root().join(IMAGES_DIR)),
    )
    .within(data_dir.root())
}

/// Review 5a m3: an error in an eval'd text points into `rapport.typ`, not at the text. After a
/// failed rapport, each distinct text is compiled on its own; the first one that fails is named
/// in a hint on the first error. Costs nothing when the rapport compiles.
fn name_eval_field(
    mut err: CompileError,
    fonts: &Arc<FontStore>,
    data_dir: &DataDir,
    now: OffsetDateTime,
    fields: &[EvalField],
) -> CompileError {
    let mut seen = HashSet::new();
    let failing = fields
        .iter()
        .filter(|f| !f.text.is_empty() && seen.insert(f.text.as_str()))
        .find(|f| compile_document(&eval_world(fonts.clone(), &f.text, data_dir, now)).is_err());
    if let (Some(field), Some(first)) = (failing, err.diagnostics.first_mut()) {
        first
            .hints
            .insert(0, format!("de fout zit in {}", field.place));
    }
    err
}

/// A World that evaluates one text as the rapport template does, with the same image folder
/// (review 39 n4: a text drawing an image would otherwise be blamed).
fn eval_world(
    fonts: Arc<FontStore>,
    text: &str,
    data_dir: &DataDir,
    now: OffsetDateTime,
) -> MaatwerkWorld {
    const MAIN: &str = "#import \"rapport.typ\": _guard_markup, _eval_scope\n\
        #eval(_guard_markup(json(\"data.json\").text), mode: \"markup\", scope: _eval_scope)\n";
    let json = serde_json::to_vec(&serde_json::json!({ "text": text }))
        .expect("JSON values always serialise");
    let file = |name: &str| format!("/{INTERNAL_DIR}/{name}");
    MaatwerkWorld::new(
        fonts,
        WorldSpec {
            main: file("main.typ"),
            files: vec![
                (file("main.typ"), Bytes::from_string(MAIN)),
                (file("rapport.typ"), Bytes::from_string(assets::RAPPORT_TYP)),
                (file("data.json"), Bytes::new(json)),
            ],
            mounts: vec![images_mount(data_dir)],
            inputs: None,
            now,
        },
    )
}

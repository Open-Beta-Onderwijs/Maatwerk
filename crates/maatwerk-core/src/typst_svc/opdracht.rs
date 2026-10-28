// SPDX-License-Identifier: AGPL-3.0-or-later

//! Opdrachten (paths B, C and D of `typst-contract.md`): one opdracht project compiled with the
//! runtime data of one job, passed to `main.typ` as JSON in `sys.inputs` ("maatwerk-data").

use std::sync::Arc;

use serde::{Deserialize, Deserializer, Serialize};
use time::OffsetDateTime;
use typst::foundations::{Dict, IntoValue};

use super::compile::{CompileError, Compiled, compile_pdf, compile_svg_pages};
use super::fonts::FontStore;
use super::project::TypstProject;
use super::world::MaatwerkWorld;

/// The `sys.inputs` key `main.typ` reads.
pub const INPUTS_KEY: &str = "maatwerk-data";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// The student's opdracht: header, uitleg, opgaven (`buildAssignmentWrapper`, default).
    #[default]
    Student,
    /// The answer key (`mode: 'answers'`).
    Answers,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Observatie {
    #[serde(deserialize_with = "text")]
    pub icon: String,
    #[serde(deserialize_with = "text")]
    pub name: String,
}

/// The student header (`job.header`). Missing or `null` fields are empty, as `typStr` made them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct OpdrachtHeader {
    #[serde(deserialize_with = "text")]
    pub title: String,
    #[serde(deserialize_with = "text")]
    pub student: String,
    #[serde(deserialize_with = "text")]
    pub group: String,
    #[serde(deserialize_with = "text")]
    pub exam: String,
    #[serde(deserialize_with = "or_default")]
    pub observaties: Vec<Observatie>,
}

impl OpdrachtHeader {
    /// `placeholderHeader(title)` (`main.js:623-636`), used by the editor preview (paths B, C).
    pub fn placeholder(title: impl Into<String>) -> OpdrachtHeader {
        OpdrachtHeader {
            title: title.into(),
            student: "Leerling Voornaam Achternaam".into(),
            group: "Klas Z vak W".into(),
            exam: "Voorbeeldtoets Toetsweek X".into(),
            observaties: vec![Observatie {
                icon: "❌".into(),
                name: "Een voorbeeldobservatie met een behoorlijk lange naam, zodat deze twee \
                       regels beslaat in het voorbeeld"
                    .into(),
            }],
        }
    }
}

/// The runtime data of one compile. Missing or `null` fields take the reference's defaults:
/// student mode, answers included, an empty header (`job.header ?? {}`, `typStr(s ?? '')`; review
/// 5b m1). Only the editor preview uses the placeholder header ([`OpdrachtInputs::preview`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct OpdrachtInputs {
    #[serde(deserialize_with = "or_default")]
    pub mode: Mode,
    /// Student mode: print the answers upside down at the bottom (`includeAnswers`).
    #[serde(deserialize_with = "or_true")]
    pub include_answers: bool,
    /// Draw a `maatwerk-cursor:` link at `<__maatwerk_cursor>` (live preview).
    #[serde(deserialize_with = "or_default")]
    pub cursor: bool,
    #[serde(deserialize_with = "or_default")]
    pub header: OpdrachtHeader,
}

impl Default for OpdrachtInputs {
    fn default() -> OpdrachtInputs {
        OpdrachtInputs {
            mode: Mode::Student,
            include_answers: true,
            cursor: false,
            header: OpdrachtHeader::default(),
        }
    }
}

impl OpdrachtInputs {
    /// Editor preview (paths B and C): placeholder header, student mode, answers included.
    pub fn preview(title: impl Into<String>, cursor: bool) -> OpdrachtInputs {
        OpdrachtInputs {
            cursor,
            header: OpdrachtHeader::placeholder(title),
            ..OpdrachtInputs::default()
        }
    }

    /// `sys.inputs` with the JSON under [`INPUTS_KEY`].
    pub fn to_sys_inputs(&self) -> Dict {
        let json = serde_json::to_string(self).expect("plain data always serialises");
        let mut dict = Dict::new();
        dict.insert(INPUTS_KEY.into(), json.into_value());
        dict
    }
}

/// `null` as `""` (the reference's `typStr(s ?? '')`).
fn text<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    or_default(d)
}

/// `null` as the default value.
fn or_default<'de, D: Deserializer<'de>, T: Deserialize<'de> + Default>(
    d: D,
) -> Result<T, D::Error> {
    Ok(Option::<T>::deserialize(d)?.unwrap_or_default())
}

/// `null` as `true` (`includeAnswers` defaults to true).
fn or_true<'de, D: Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    Ok(Option::<bool>::deserialize(d)?.unwrap_or(true))
}

/// The sandboxed World for one opdracht job.
pub fn opdracht_world(
    fonts: Arc<FontStore>,
    project: TypstProject,
    inputs: &OpdrachtInputs,
    now: OffsetDateTime,
) -> MaatwerkWorld {
    project
        .with_inputs(inputs.to_sys_inputs())
        .world(fonts, now)
}

/// Compiles one opdracht to PDF (paths B and D).
pub fn render_assignment_pdf(
    fonts: Arc<FontStore>,
    project: TypstProject,
    inputs: &OpdrachtInputs,
    now: OffsetDateTime,
) -> Result<Compiled<Vec<u8>>, CompileError> {
    compile_pdf(&opdracht_world(fonts, project, inputs, now))
}

/// Compiles one opdracht to one SVG string per page, in memory (path C, the editor preview).
pub fn render_assignment_svg_pages(
    fonts: Arc<FontStore>,
    project: TypstProject,
    inputs: &OpdrachtInputs,
    now: OffsetDateTime,
) -> Result<Compiled<Vec<String>>, CompileError> {
    compile_svg_pages(&opdracht_world(fonts, project, inputs, now))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_fields_may_be_missing_or_null() {
        let h: OpdrachtHeader =
            serde_json::from_str(r#"{"title": "T", "student": null, "observaties": []}"#).unwrap();
        assert_eq!(h.title, "T");
        assert_eq!(h.student, "");
        assert_eq!(h.group, "");
    }

    #[test]
    fn inputs_serialise_with_lowercase_mode() {
        let inputs = OpdrachtInputs {
            mode: Mode::Answers,
            ..OpdrachtInputs::default()
        };
        let json = serde_json::to_value(&inputs).unwrap();
        assert_eq!(json["mode"], "answers");
        assert_eq!(json["include_answers"], true);
        assert_eq!(json["header"]["title"], "");
    }

    #[test]
    fn review_m1_missing_or_null_fields_take_the_reference_defaults() {
        let inputs: OpdrachtInputs = serde_json::from_str(
            r#"{"mode": null, "include_answers": null, "header": {"observaties": null}}"#,
        )
        .unwrap();
        assert_eq!(inputs, OpdrachtInputs::default());
        let inputs: OpdrachtInputs = serde_json::from_str("{}").unwrap();
        assert_eq!(inputs.header.student, "", "no placeholder on a real sheet");
        assert!(inputs.include_answers);
    }
}

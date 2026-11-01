// SPDX-License-Identifier: AGPL-3.0-or-later

//! The vragen of a compiled opdracht (Step 8b), read through the document's introspector from
//! the `<__maatwerk_vraag>` markers that `lib.typ`'s `vraag()` leaves (`opgave`, `nr`,
//! `antwoord`, and since `maatwerk-lib 2` `punten`). The labels follow `lib.typ`: the opgave
//! number, plus a letter when the opgave has more than one vraag ("1", "2a", "2b"). This list
//! drives the editor's vragen panel and checks; later the answer key and AI checks.

use serde::Serialize;
use typst::foundations::{Dict, Label, Selector, Value};
use typst::introspection::MetadataElem;
use typst::layout::PagedDocument;
use typst::utils::PicoStr;

/// The marker label (`lib.typ`, renamed from `__rtti_vraag`).
const VRAAG_LABEL: &str = "__maatwerk_vraag";

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Vraag {
    /// The opgave number; 0 for a vraag outside any opgave.
    pub opgave: u64,
    /// "1", "2a", ... as on the answer key.
    pub label: String,
    /// `None` when not given, or when the opdracht's `lib.typ` predates `punten` in the marker.
    pub punten: Option<f64>,
    /// The answer as plain text; `None` when the vraag has none.
    pub antwoord: Option<String>,
    /// Where the vraag is in the preview (0-based page, y in pt), to scroll to it.
    pub page: usize,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Vragen {
    pub items: Vec<Vraag>,
    /// The sum of the known punten.
    pub total_punten: f64,
    /// Problems for the teacher, in Dutch ("De opdracht heeft geen vragen.").
    pub checks: Vec<String>,
}

/// The vragen of `document` in document order, with the total and the checks.
pub fn vragen(document: &PagedDocument) -> Vragen {
    let label = Label::new(PicoStr::intern(VRAAG_LABEL)).expect("a non-empty label");
    let mut raw = Vec::new();
    let mut punten_known = true;
    for content in document.introspector.query(&Selector::Label(label)).iter() {
        let Some(meta) = content.to_packed::<MetadataElem>() else {
            continue;
        };
        let Value::Dict(dict) = &meta.value else {
            continue;
        };
        let (page, y) = content
            .location()
            .map(|loc| document.introspector.position(loc))
            .map_or((0, 0.0), |pos| (pos.page.get() - 1, pos.point.y.to_pt()));
        punten_known &= dict.contains("punten");
        raw.push((dict.clone(), page, y));
    }

    let opgave_of = |d: &Dict| int(d, "opgave").unwrap_or(0);
    let items: Vec<Vraag> = raw
        .iter()
        .map(|(dict, page, y)| {
            let opgave = opgave_of(dict);
            let shared = raw.iter().filter(|(d, ..)| opgave_of(d) == opgave).count() > 1;
            let letter = match int(dict, "nr") {
                Some(nr) if shared => letters(nr),
                _ => String::new(),
            };
            Vraag {
                opgave,
                label: format!("{opgave}{letter}"),
                punten: dict.get("punten").ok().and_then(number),
                antwoord: dict.get("antwoord").ok().and_then(|v| match v {
                    Value::None => None,
                    Value::Content(c) => Some(c.plain_text().trim().to_owned()),
                    other => Some(other.clone().display().plain_text().trim().to_owned()),
                }),
                page: *page,
                y: *y,
            }
        })
        .collect();

    let mut checks = Vec::new();
    if items.is_empty() {
        checks.push("De opdracht heeft geen vragen.".to_owned());
    }
    if !items.is_empty() && !punten_known {
        checks.push(
            "De punten zijn onbekend: lib.typ van deze opdracht is een oudere versie.".to_owned(),
        );
    }
    for v in &items {
        let name = if v.opgave == 0 {
            "Een vraag buiten een opgave".to_owned()
        } else {
            format!("Vraag {}", v.label)
        };
        if v.opgave == 0 {
            checks.push(format!("{name} staat niet in een #opgave."));
        }
        if punten_known && v.punten.is_none() {
            checks.push(format!("{name} heeft geen punten."));
        }
        if v.antwoord.as_deref().is_none_or(str::is_empty) {
            checks.push(format!("{name} heeft geen antwoord."));
        }
    }
    let total_punten = items.iter().filter_map(|v| v.punten).sum();
    Vragen {
        items,
        total_punten,
        checks,
    }
}

fn int(dict: &Dict, key: &str) -> Option<u64> {
    match dict.get(key).ok()? {
        Value::Int(n) => u64::try_from(*n).ok(),
        _ => None,
    }
}

fn number(value: &Value) -> Option<f64> {
    match value {
        Value::Int(n) => Some(*n as f64),
        Value::Float(f) => Some(*f),
        _ => None,
    }
}

/// Typst's `numbering("a", n)`: a, b, ..., z, aa, ab, ...
fn letters(mut n: u64) -> String {
    let mut out = Vec::new();
    while n > 0 {
        n -= 1;
        out.push(b'a' + (n % 26) as u8);
        n /= 26;
    }
    out.reverse();
    String::from_utf8(out).expect("ASCII letters")
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, OnceLock};

    use time::OffsetDateTime;

    use super::*;
    use crate::assets;
    use crate::paths::RelPath;
    use crate::typst_svc::{FontStore, TypstProject, compile_document};

    fn fonts() -> Arc<FontStore> {
        static FONTS: OnceLock<Arc<FontStore>> = OnceLock::new();
        FONTS
            .get_or_init(|| Arc::new(FontStore::new(false)))
            .clone()
    }

    /// `body` with the bundled `lib.typ` (or `lib`).
    fn document(lib: &str, body: &str) -> PagedDocument {
        let main = RelPath::parse("main.typ").unwrap();
        let project = TypstProject::folder(std::env::temp_dir().join("maatwerk-none"), &main)
            .with_file(
                &main,
                format!("#import \"lib.typ\": *\n#show: setup\n{body}"),
            )
            .with_file(&RelPath::parse("lib.typ").unwrap(), lib);
        let world = project.world(fonts(), OffsetDateTime::UNIX_EPOCH);
        compile_document(&world).unwrap().output
    }

    #[test]
    fn labels_points_and_answers_follow_lib_typ() {
        let doc = document(
            assets::LIB_TYP,
            "#opgave[#vraag(punten: 2, antwoord: [Veertig])[Hoeveel?]]\n\
             #opgave[\n#vraag(punten: 1.5, antwoord: [$x = 2$ m])[Een]\n\
             #grid(columns: 2, vraag(antwoord: [B])[Twee], [])]\n",
        );
        let v = vragen(&doc);
        let labels: Vec<_> = v.items.iter().map(|v| v.label.as_str()).collect();
        assert_eq!(labels, ["1", "2a", "2b"]);
        assert_eq!(v.items[0].punten, Some(2.0));
        assert_eq!(v.items[1].punten, Some(1.5));
        assert_eq!(v.items[2].punten, None);
        assert_eq!(v.items[0].antwoord.as_deref(), Some("Veertig"));
        assert_eq!(v.items[2].antwoord.as_deref(), Some("B"));
        assert_eq!(v.total_punten, 3.5);
        assert_eq!(v.checks, ["Vraag 2b heeft geen punten."]);
        assert!(v.items.iter().all(|v| v.page == 0 && v.y > 0.0));
    }

    #[test]
    fn an_opdracht_without_vragen_is_flagged() {
        let v = vragen(&document(assets::LIB_TYP, "Alleen uitleg."));
        assert!(v.items.is_empty());
        assert_eq!(v.checks, ["De opdracht heeft geen vragen."]);
    }

    #[test]
    fn missing_answers_and_vragen_outside_an_opgave_are_flagged() {
        let v = vragen(&document(
            assets::LIB_TYP,
            "#vraag(punten: 1)[Los]\n#opgave[#vraag(punten: 1, antwoord: [])[Leeg]]",
        ));
        assert_eq!(v.items[0].label, "0");
        assert_eq!(
            v.checks,
            [
                "Een vraag buiten een opgave staat niet in een #opgave.",
                "Een vraag buiten een opgave heeft geen antwoord.",
                "Vraag 1 heeft geen antwoord.",
            ]
        );
    }

    #[test]
    fn an_old_lib_typ_gives_vragen_without_points() {
        // `maatwerk-lib 1`: the marker has no `punten` yet.
        let old = assets::LIB_TYP.replace(", punten: punten)", ")");
        assert_ne!(old, assets::LIB_TYP);
        let v = vragen(&document(
            &old,
            "#opgave[#vraag(punten: 2, antwoord: [A])[Een]]",
        ));
        assert_eq!(v.items[0].punten, None);
        assert_eq!(
            v.checks,
            ["De punten zijn onbekend: lib.typ van deze opdracht is een oudere versie."]
        );
    }

    #[test]
    fn letters_count_like_typst() {
        assert_eq!(letters(1), "a");
        assert_eq!(letters(26), "z");
        assert_eq!(letters(27), "aa");
    }
}

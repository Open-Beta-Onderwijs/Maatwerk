// SPDX-License-Identifier: AGPL-3.0-or-later

//! Rubrics and the PO grade (PLAN-2 decisions 16, 20, 21; `docs/reference/data-files-v3.md`
//! "Rubrics"). One implementation for the rubric editor (WebAssembly, live), the core's save
//! guard and `validate-data`, and the CLI `rubric check`.
//!
//! - A category has 2 to 5 levels. A level is an interval of whole points `min..=max` within
//!   `0..=category max`. Intervals may overlap, but no two levels share a minimum or a maximum, and
//!   together they cover every score from 0 to the category max.
//! - Grade = 10 × points ÷ max, between 1,0 and 10,0 (not rounded here: like every grade, it is
//!   rounded to one decimal where it is shown or averaged). Bonus categories count in the points,
//!   not in the max; diagnostic categories count in neither.
//! - Once a PO uses the rubric, every category's max and soort are locked; so are the categories
//!   themselves (adding or removing one changes the max). Names, levels and observaties stay
//!   editable.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::model::{nullable, opt_number, string_list, text};

/// The number of levels a category may have.
pub const MIN_LEVELS: usize = 2;
pub const MAX_LEVELS: usize = 5;

/// How a category counts (decision 16).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Soort {
    #[default]
    Normaal,
    Bonus,
    Diagnostisch,
}

impl Soort {
    fn label(self) -> &'static str {
        match self {
            Soort::Normaal => "Normaal",
            Soort::Bonus => "Bonus",
            Soort::Diagnostisch => "Diagnostisch",
        }
    }
}

/// An unknown soort reads as `normaal`, as a missing one.
fn soort<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Soort, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    Ok(serde_json::from_value(value).unwrap_or_default())
}

/// One level of a category. Bounds are `None` while a field is empty or not a number.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Niveau {
    #[serde(default, deserialize_with = "opt_number")]
    pub min: Option<f64>,
    #[serde(default, deserialize_with = "opt_number")]
    pub max: Option<f64>,
    #[serde(default, deserialize_with = "text")]
    pub titel: String,
    #[serde(default, deserialize_with = "text")]
    pub uitleg: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Category {
    #[serde(default, deserialize_with = "text")]
    pub id: String,
    #[serde(default, deserialize_with = "text")]
    pub naam: String,
    #[serde(default, deserialize_with = "opt_number")]
    pub max: Option<f64>,
    #[serde(default, deserialize_with = "soort")]
    pub soort: Soort,
    #[serde(default, deserialize_with = "nullable")]
    pub niveaus: Vec<Niveau>,
}

impl Category {
    /// The max as a whole number of 1 or more, else `None`.
    pub fn whole_max(&self) -> Option<u32> {
        whole(self.max).filter(|&m| m >= 1)
    }
}

/// A rubric file, read tolerantly (fields the rules do not need are ignored).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Rubric {
    #[serde(default, deserialize_with = "text")]
    pub id: String,
    #[serde(default, deserialize_with = "text")]
    pub naam: String,
    #[serde(default, deserialize_with = "text")]
    pub subject: String,
    #[serde(default, deserialize_with = "string_list")]
    pub schoolsoort: Vec<String>,
    #[serde(default, deserialize_with = "string_list")]
    pub jaarlagen: Vec<String>,
    #[serde(default, deserialize_with = "nullable")]
    pub categories: Vec<Category>,
}

/// Points per soort: "17 punten + 4 bonus".
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub categories: u32,
    /// The max of the grade: the normal categories.
    pub normal: f64,
    pub bonus: f64,
    pub diagnostic: f64,
}

/// The check of one category, in the rubric's order.
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryCheck {
    pub id: String,
    /// Dutch, shown as one red line joined by " · ".
    pub errors: Vec<String>,
    /// Scores `0..=max` no level covers (red in the number row).
    pub uncovered: Vec<u32>,
    /// Indexes of levels whose bounds are wrong on their own (empty, not whole, out of range).
    pub bad_levels: Vec<usize>,
    /// Indexes of levels without an uitleg.
    pub missing_uitleg: Vec<usize>,
}

/// The whole rubric's check.
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RubricCheck {
    pub valid: bool,
    /// Dutch, about the rubric as a whole.
    pub errors: Vec<String>,
    pub categories: Vec<CategoryCheck>,
    pub totals: Totals,
}

/// A whole number of 0 or more.
fn whole(x: Option<f64>) -> Option<u32> {
    x.filter(|v| v.fract() == 0.0 && *v >= 0.0 && *v <= u32::MAX as f64)
        .map(|v| v as u32)
}

fn count_word(n: usize) -> String {
    match n {
        2 => "Twee".into(),
        3 => "Drie".into(),
        4 => "Vier".into(),
        5 => "Vijf".into(),
        n => n.to_string(),
    }
}

/// "3, 5–7": runs of three or more as a range.
fn ranges(values: &[u32]) -> String {
    let mut parts = Vec::new();
    let mut i = 0;
    while i < values.len() {
        let mut j = i;
        while j + 1 < values.len() && values[j + 1] == values[j] + 1 {
            j += 1;
        }
        match j - i {
            0 => parts.push(values[i].to_string()),
            1 => {
                parts.push(values[i].to_string());
                parts.push(values[j].to_string());
            }
            _ => parts.push(format!("{}–{}", values[i], values[j])),
        }
        i = j + 1;
    }
    parts.join(", ")
}

/// Checks one category (decision 21).
pub fn check_category(cat: &Category) -> CategoryCheck {
    let mut out = CategoryCheck {
        id: cat.id.clone(),
        ..CategoryCheck::default()
    };
    if cat.naam.trim().is_empty() {
        out.errors.push("Naam ontbreekt".into());
    }
    let n = cat.niveaus.len();
    if n < MIN_LEVELS {
        out.errors.push(format!("Minstens {MIN_LEVELS} niveaus"));
    } else if n > MAX_LEVELS {
        out.errors.push(format!("Hoogstens {MAX_LEVELS} niveaus"));
    }
    let Some(max) = cat.whole_max() else {
        out.errors
            .push("Het maximum moet een heel getal van 1 of meer zijn".into());
        return out;
    };

    // Levels whose own fields are fine take part in the overlap and coverage checks.
    let mut intervals: Vec<(u32, u32)> = Vec::new();
    for (i, level) in cat.niveaus.iter().enumerate() {
        let nr = i + 1;
        let (lo, hi) = (whole(level.min), whole(level.max));
        let mut bad = false;
        match (level.min, level.max) {
            (None, _) | (_, None) => {
                out.errors.push(format!("Niveau {nr}: vul van en tot in"));
                bad = true;
            }
            _ if lo.is_none() || hi.is_none() => {
                out.errors
                    .push(format!("Niveau {nr}: alleen hele punten van 0 of meer"));
                bad = true;
            }
            _ => {}
        }
        if let (Some(lo), Some(hi)) = (lo, hi) {
            if lo > hi {
                out.errors
                    .push(format!("Niveau {nr}: van ({lo}) is groter dan tot ({hi})"));
                bad = true;
            } else if hi > max {
                out.errors
                    .push(format!("Niveau {nr} gaat verder dan het maximum {max}"));
                bad = true;
            } else {
                intervals.push((lo, hi));
            }
        }
        if level.uitleg.trim().is_empty() {
            out.errors.push(format!("Niveau {nr}: uitleg ontbreekt"));
            out.missing_uitleg.push(i);
        }
        if bad {
            out.bad_levels.push(i);
        }
    }

    let mut starts: BTreeMap<u32, usize> = BTreeMap::new();
    let mut ends: BTreeMap<u32, usize> = BTreeMap::new();
    for &(lo, hi) in &intervals {
        *starts.entry(lo).or_default() += 1;
        *ends.entry(hi).or_default() += 1;
    }
    for (v, k) in starts.iter().filter(|(_, k)| **k > 1) {
        out.errors
            .push(format!("{} niveaus beginnen bij {v}", count_word(*k)));
    }
    for (v, k) in ends.iter().filter(|(_, k)| **k > 1) {
        out.errors
            .push(format!("{} niveaus eindigen bij {v}", count_word(*k)));
    }

    out.uncovered = (0..=max)
        .filter(|s| !intervals.iter().any(|&(lo, hi)| lo <= *s && *s <= hi))
        .collect();
    if !out.uncovered.is_empty() {
        out.errors
            .push(format!("Niet gedekt: {}", ranges(&out.uncovered)));
    }
    out
}

/// Points per soort; a category without a valid max counts 0.
pub fn totals(rubric: &Rubric) -> Totals {
    let mut t = Totals {
        categories: rubric.categories.len() as u32,
        ..Totals::default()
    };
    for cat in &rubric.categories {
        let max = f64::from(cat.whole_max().unwrap_or(0));
        match cat.soort {
            Soort::Normaal => t.normal += max,
            Soort::Bonus => t.bonus += max,
            Soort::Diagnostisch => t.diagnostic += max,
        }
    }
    t
}

/// Checks the whole rubric: its own fields and every category. `valid` means it may be saved.
pub fn check_rubric(rubric: &Rubric) -> RubricCheck {
    let mut errors = Vec::new();
    if rubric.naam.trim().is_empty() {
        errors.push("Geef de rubric een naam".into());
    }
    if rubric.subject.trim().is_empty() {
        errors.push("Kies een vak".into());
    }
    if rubric.schoolsoort.is_empty() {
        errors.push("Kies minstens één schoolsoort".into());
    }
    if rubric.jaarlagen.is_empty() {
        errors.push("Kies minstens één jaarlaag".into());
    }
    let totals = totals(rubric);
    if rubric.categories.is_empty() {
        errors.push("Voeg minstens één categorie toe".into());
    } else if !rubric
        .categories
        .iter()
        .any(|c| c.soort == Soort::Normaal && c.whole_max().is_some())
    {
        errors.push("Minstens één categorie moet Normaal zijn: daar rekent het cijfer mee".into());
    }
    let mut seen = HashSet::new();
    for cat in &rubric.categories {
        if cat.id.is_empty() {
            errors.push(format!("Categorie \"{}\" heeft geen id", cat.naam));
        } else if !seen.insert(cat.id.as_str()) {
            errors.push(format!("Categorie-id {} komt twee keer voor", cat.id));
        }
    }
    let categories: Vec<CategoryCheck> = rubric.categories.iter().map(check_category).collect();
    let valid = errors.is_empty() && categories.iter().all(|c| c.errors.is_empty());
    RubricCheck {
        valid,
        errors,
        categories,
        totals,
    }
}

/// What an edit of a rubric in use changes that decision 20 locks: a category removed or added,
/// or a category's max or soort. Empty when the edit is allowed. Dutch.
pub fn locked_changes(before: &Rubric, after: &Rubric) -> Vec<String> {
    let mut out = Vec::new();
    let after_by_id: HashMap<&str, &Category> = after
        .categories
        .iter()
        .map(|c| (c.id.as_str(), c))
        .collect();
    for old in &before.categories {
        let Some(new) = after_by_id.get(old.id.as_str()) else {
            out.push(format!("Categorie \"{}\" is verwijderd", old.naam));
            continue;
        };
        if new.max != old.max {
            out.push(format!(
                "Het maximum van \"{}\" is gewijzigd ({} → {})",
                old.naam,
                show(old.max),
                show(new.max)
            ));
        }
        if new.soort != old.soort {
            out.push(format!(
                "De soort van \"{}\" is gewijzigd ({} → {})",
                old.naam,
                old.soort.label(),
                new.soort.label()
            ));
        }
    }
    for new in &after.categories {
        if !before.categories.iter().any(|c| c.id == new.id) {
            out.push(format!("Categorie \"{}\" is toegevoegd", new.naam));
        }
    }
    out
}

fn show(x: Option<f64>) -> String {
    x.map(|v| v.to_string().replace('.', ","))
        .unwrap_or_else(|| "leeg".into())
}

/// The PO grade from points and max (decision 16): 10 × points ÷ max, between 1,0 and 10,0;
/// `None` without a max. Not rounded (like `calc_grade`).
pub fn po_grade(points: f64, max: f64) -> Option<f64> {
    if max.is_nan() || max <= 0.0 || !points.is_finite() {
        return None;
    }
    Some((10.0 * points / max).clamp(1.0, 10.0))
}

/// A PO's points and max from its category scores (decision 16): normal and bonus scores count
/// in the points, only normal maxima in the max, diagnostic categories in neither. A category
/// without a score counts 0.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PoPoints {
    pub points: f64,
    pub max: f64,
}

pub fn po_points(rubric: &Rubric, scores: &HashMap<String, f64>) -> PoPoints {
    let mut points = 0.0;
    for cat in &rubric.categories {
        if cat.soort != Soort::Diagnostisch {
            points += scores.get(&cat.id).copied().unwrap_or(0.0);
        }
    }
    PoPoints {
        points,
        max: totals(rubric).normal,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn cat(max: u32, levels: &[(u32, u32)]) -> Category {
        serde_json::from_value(json!({
            "id": "c1", "naam": "Theorie", "max": max, "soort": "normaal",
            "niveaus": levels.iter().map(|(a, b)| json!({"min": a, "max": b, "uitleg": "x"}))
                .collect::<Vec<_>>(),
        }))
        .unwrap()
    }

    fn errors(c: &Category) -> Vec<String> {
        check_category(c).errors
    }

    #[test]
    fn touching_intervals_are_fine() {
        let c = check_category(&cat(4, &[(0, 2), (3, 4)]));
        assert!(c.errors.is_empty(), "{:?}", c.errors);
        assert!(c.uncovered.is_empty());
    }

    #[test]
    fn overlaps_are_fine_without_shared_bounds() {
        assert!(errors(&cat(8, &[(0, 3), (2, 6), (5, 8)])).is_empty());
    }

    #[test]
    fn a_shared_minimum_or_maximum_is_an_error() {
        assert_eq!(
            errors(&cat(4, &[(0, 1), (2, 3), (2, 4)])),
            vec!["Twee niveaus beginnen bij 2"]
        );
        assert_eq!(
            errors(&cat(4, &[(0, 4), (1, 4)])),
            vec!["Twee niveaus eindigen bij 4"]
        );
        assert_eq!(
            errors(&cat(5, &[(0, 5), (0, 5), (0, 5)])),
            vec!["Drie niveaus beginnen bij 0", "Drie niveaus eindigen bij 5"]
        );
    }

    #[test]
    fn gaps_are_listed_and_marked() {
        let c = check_category(&cat(8, &[(0, 2), (4, 4), (8, 8)]));
        assert_eq!(c.uncovered, vec![3, 5, 6, 7]);
        assert_eq!(c.errors, vec!["Niet gedekt: 3, 5–7"]);
        let c = check_category(&cat(4, &[(1, 2), (3, 3)]));
        assert_eq!(c.errors, vec!["Niet gedekt: 0, 4"]);
    }

    #[test]
    fn the_design_example_reads_as_on_the_board() {
        // Board 16: two levels start at 2 and score 3 is covered by none.
        let c = check_category(&cat(6, &[(0, 1), (2, 2), (2, 2), (4, 6)]));
        assert_eq!(
            c.errors.join(" · "),
            "Twee niveaus beginnen bij 2 · Twee niveaus eindigen bij 2 · Niet gedekt: 3"
        );
    }

    #[test]
    fn level_count_is_two_to_five() {
        assert_eq!(errors(&cat(2, &[(0, 2)])), vec!["Minstens 2 niveaus"]);
        let six = [(0, 0), (1, 1), (2, 2), (3, 3), (4, 4), (5, 5)];
        assert_eq!(errors(&cat(5, &six)), vec!["Hoogstens 5 niveaus"]);
        let five = [(0, 0), (1, 1), (2, 2), (3, 3), (4, 5)];
        assert!(errors(&cat(5, &five)).is_empty());
    }

    #[test]
    fn bounds_must_be_whole_and_in_range() {
        let c: Category = serde_json::from_value(json!({
            "id": "c", "naam": "A", "max": 4, "niveaus": [
                {"min": 0, "max": 1.5, "uitleg": "x"},
                {"min": "", "max": 4, "uitleg": "x"},
                {"min": 3, "max": 2, "uitleg": "x"},
                {"min": 2, "max": 6, "uitleg": "x"},
            ]
        }))
        .unwrap();
        let check = check_category(&c);
        assert_eq!(check.bad_levels, vec![0, 1, 2, 3]);
        assert_eq!(
            &check.errors[..4],
            [
                "Niveau 1: alleen hele punten van 0 of meer",
                "Niveau 2: vul van en tot in",
                "Niveau 3: van (3) is groter dan tot (2)",
                "Niveau 4 gaat verder dan het maximum 4",
            ]
        );
        assert_eq!(check.uncovered, vec![0, 1, 2, 3, 4]);
    }

    #[test]
    fn max_must_be_a_whole_number_of_one_or_more() {
        for max in [json!(0), json!(2.5), json!(-1), json!(""), json!(null)] {
            let c: Category = serde_json::from_value(json!({
                "id": "c", "naam": "A", "max": max,
                "niveaus": [{"min": 0, "max": 0, "uitleg": "x"}, {"min": 1, "max": 1, "uitleg": "x"}]
            }))
            .unwrap();
            assert_eq!(
                errors(&c),
                vec!["Het maximum moet een heel getal van 1 of meer zijn"],
                "{max}"
            );
        }
    }

    #[test]
    fn name_and_explanation_are_required_title_is_not() {
        let mut c = cat(1, &[(0, 0), (1, 1)]);
        c.naam = " ".into();
        c.niveaus[1].uitleg = String::new();
        assert_eq!(
            errors(&c),
            vec!["Naam ontbreekt", "Niveau 2: uitleg ontbreekt"]
        );
        let check = check_category(&c);
        assert!(check.bad_levels.is_empty(), "the bounds are fine");
        assert_eq!(check.missing_uitleg, vec![1]);
    }

    fn rubric() -> Rubric {
        serde_json::from_value(json!({
            "id": "r1", "naam": "Onderzoeksverslag", "subject": "nat",
            "schoolsoort": ["Havo"], "jaarlagen": ["4", 5],
            "categories": [
                {"id": "a", "naam": "Theorie", "max": 8, "soort": "normaal",
                 "niveaus": [{"min": 0, "max": 4, "uitleg": "x"}, {"min": 5, "max": 8, "uitleg": "x"}]},
                {"id": "b", "naam": "Uitvoering", "max": 9, "soort": "normaal",
                 "niveaus": [{"min": 0, "max": 4, "uitleg": "x"}, {"min": 5, "max": 9, "uitleg": "x"}]},
                {"id": "c", "naam": "Extra", "max": 4, "soort": "bonus",
                 "niveaus": [{"min": 0, "max": 1, "uitleg": "x"}, {"min": 2, "max": 4, "uitleg": "x"}]},
                {"id": "d", "naam": "Samenwerken", "max": 3, "soort": "diagnostisch",
                 "niveaus": [{"min": 0, "max": 1, "uitleg": "x"}, {"min": 2, "max": 3, "uitleg": "x"}]}
            ]
        }))
        .unwrap()
    }

    #[test]
    fn a_good_rubric_is_valid_with_totals_per_soort() {
        let r = rubric();
        let check = check_rubric(&r);
        assert!(check.valid, "{check:?}");
        assert_eq!(r.jaarlagen, vec!["4", "5"]);
        assert_eq!(
            check.totals,
            Totals {
                categories: 4,
                normal: 17.0,
                bonus: 4.0,
                diagnostic: 3.0
            }
        );
    }

    #[test]
    fn rubric_fields_and_category_ids_are_checked() {
        let mut r = rubric();
        r.naam.clear();
        r.subject.clear();
        r.schoolsoort.clear();
        r.jaarlagen.clear();
        r.categories[1].id = "a".into();
        let check = check_rubric(&r);
        assert!(!check.valid);
        assert_eq!(
            check.errors,
            vec![
                "Geef de rubric een naam",
                "Kies een vak",
                "Kies minstens één schoolsoort",
                "Kies minstens één jaarlaag",
                "Categorie-id a komt twee keer voor",
            ]
        );
    }

    #[test]
    fn a_rubric_needs_a_normal_category() {
        let mut r = rubric();
        r.categories.retain(|c| c.soort != Soort::Normaal);
        assert_eq!(
            check_rubric(&r).errors,
            vec!["Minstens één categorie moet Normaal zijn: daar rekent het cijfer mee"]
        );
        r.categories.clear();
        assert_eq!(
            check_rubric(&r).errors,
            vec!["Voeg minstens één categorie toe"]
        );
    }

    #[test]
    fn one_bad_category_makes_the_rubric_invalid() {
        let mut r = rubric();
        r.categories[2].niveaus[1].min = Some(1.0);
        assert!(
            check_rubric(&r).valid,
            "0–1 and 1–4 overlap, which is allowed"
        );
        r.categories[2].niveaus[1].min = Some(0.0);
        let check = check_rubric(&r);
        assert!(!check.valid);
        assert!(check.errors.is_empty());
        assert_eq!(
            check.categories[2].errors,
            vec!["Twee niveaus beginnen bij 0"]
        );
    }

    #[test]
    fn locked_rubric_allows_names_levels_and_order() {
        let before = rubric();
        let mut after = rubric();
        after.naam = "Anders".into();
        after.categories[0].naam = "Kennis".into();
        after.categories[0].niveaus.push(Niveau {
            min: Some(3.0),
            max: Some(6.0),
            titel: "Midden".into(),
            uitleg: "y".into(),
        });
        after.categories.swap(0, 3);
        assert!(locked_changes(&before, &after).is_empty());
    }

    #[test]
    fn locked_rubric_refuses_max_soort_and_category_changes() {
        let before = rubric();
        let mut after = rubric();
        after.categories[0].max = Some(10.0);
        after.categories[2].soort = Soort::Normaal;
        after.categories.remove(3);
        after.categories.push(Category {
            id: "e".into(),
            naam: "Nieuw".into(),
            ..Category::default()
        });
        assert_eq!(
            locked_changes(&before, &after),
            vec![
                "Het maximum van \"Theorie\" is gewijzigd (8 → 10)",
                "De soort van \"Extra\" is gewijzigd (Bonus → Normaal)",
                "Categorie \"Samenwerken\" is verwijderd",
                "Categorie \"Nieuw\" is toegevoegd",
            ]
        );
    }

    #[test]
    fn po_grade_follows_decision_16() {
        assert_eq!(po_grade(17.0, 17.0), Some(10.0));
        assert_eq!(po_grade(13.0, 17.0).map(crate::round1), Some(7.6));
        assert_eq!(po_grade(14.0, 17.0).map(crate::round1), Some(8.2));
        // Bonus can push the points above the max: still 10,0.
        assert_eq!(po_grade(20.0, 17.0), Some(10.0));
        // Never below 1,0.
        assert_eq!(po_grade(0.0, 17.0), Some(1.0));
        assert_eq!(po_grade(1.0, 17.0), Some(1.0));
        assert_eq!(po_grade(2.0, 17.0).map(crate::round1), Some(1.2));
        assert_eq!(po_grade(5.0, 0.0), None);
        assert_eq!(po_grade(f64::NAN, 10.0), None);
    }

    #[test]
    fn po_points_count_bonus_in_points_and_diagnostic_nowhere() {
        let r = rubric();
        let scores: HashMap<String, f64> = [("a", 6.0), ("b", 5.0), ("c", 3.0), ("d", 3.0)]
            .into_iter()
            .map(|(k, v)| (k.to_owned(), v))
            .collect();
        let p = po_points(&r, &scores);
        assert_eq!(
            p,
            PoPoints {
                points: 14.0,
                max: 17.0
            }
        );
        assert_eq!(po_grade(p.points, p.max).map(crate::round1), Some(8.2));
        // A category without a score counts 0.
        let p = po_points(&r, &HashMap::from([("a".to_owned(), 8.0)]));
        assert_eq!(p.points, 8.0);
    }
}

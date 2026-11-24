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

/// The highest max a category may have (user, 2026-11-10).
pub const MAX_POINTS: u32 = 100;

impl Category {
    /// The max as a whole number from 1 to [`MAX_POINTS`], else `None`.
    pub fn whole_max(&self) -> Option<u32> {
        whole(self.max).filter(|&m| (1..=MAX_POINTS).contains(&m))
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
    /// Runs `[from, to]` of scores `0..=max` no level covers (red in the number row).
    pub gaps: Vec<(u32, u32)>,
    /// Indexes of levels whose bounds are wrong on their own (empty, not whole, out of range).
    pub bad_levels: Vec<usize>,
    /// Indexes of levels whose minimum, or maximum, another level has too.
    pub shared_min: Vec<usize>,
    pub shared_max: Vec<usize>,
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
        out.errors.push(format!(
            "Het maximum moet een heel getal van 1 tot en met {MAX_POINTS} zijn"
        ));
        return out;
    };

    // Levels whose own fields are fine take part in the overlap and coverage checks.
    let mut intervals: Vec<(usize, u32, u32)> = Vec::new();
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
                intervals.push((i, lo, hi));
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
    for &(_, lo, hi) in &intervals {
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
    for &(i, lo, hi) in &intervals {
        if starts[&lo] > 1 {
            out.shared_min.push(i);
        }
        if ends[&hi] > 1 {
            out.shared_max.push(i);
        }
    }

    out.gaps = gaps(&intervals, max);
    if !out.gaps.is_empty() {
        out.errors
            .push(format!("Niet gedekt: {}", gaps_text(&out.gaps)));
    }
    out
}

/// The runs of scores `0..=max` that no interval covers. Works on the intervals, not on every
/// score, so a huge max costs nothing (review 21 M1).
fn gaps(intervals: &[(usize, u32, u32)], max: u32) -> Vec<(u32, u32)> {
    let mut sorted: Vec<(u32, u32)> = intervals.iter().map(|&(_, lo, hi)| (lo, hi)).collect();
    sorted.sort_unstable();
    let mut out = Vec::new();
    let mut next: u64 = 0; // every score below this is covered
    for (lo, hi) in sorted {
        if u64::from(lo) > next {
            out.push((next as u32, lo - 1));
        }
        next = next.max(u64::from(hi) + 1);
    }
    if next <= u64::from(max) {
        out.push((next as u32, max));
    }
    out
}

/// "3, 5–7": a run of three or more as a range, two as two numbers.
fn gaps_text(gaps: &[(u32, u32)]) -> String {
    gaps.iter()
        .map(|&(a, b)| match b - a {
            0 => a.to_string(),
            1 => format!("{a}, {b}"),
            _ => format!("{a}–{b}"),
        })
        .collect::<Vec<_>>()
        .join(", ")
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

/// The largest bonus or malus of one line, in grade points (decision 28).
pub const LINE_LIMIT: f64 = 9.0;

/// A bonus/malus line value that counts (decision 28): grade points with at most one decimal,
/// from −9,0 to +9,0, not 0. Anything else counts nothing (`validate-data` lists it).
pub fn line_valid(value: f64) -> bool {
    let tenths = value * 10.0;
    value.is_finite()
        && value != 0.0
        && value.abs() <= LINE_LIMIT
        && (tenths - tenths.round()).abs() < 1e-6
}

/// The sum of the lines that count, without floating-point noise.
pub fn lines_sum(lines: &[crate::model::PoLine]) -> f64 {
    crate::round::clean(
        lines
            .iter()
            .filter_map(|l| l.value.filter(|v| line_valid(*v)))
            .sum(),
    )
}

/// A PO grade with bonus/malus lines (decisions 17, 28): the rubric grade plus the lines, held
/// between 1,0 and 10,0 once, at the end; rounded to one decimal (only noise: lines have one).
pub fn with_lines(rubric_grade: f64, lines: f64) -> f64 {
    crate::round::round1(rubric_grade + lines).clamp(1.0, 10.0)
}

#[cfg(test)]
mod tests;

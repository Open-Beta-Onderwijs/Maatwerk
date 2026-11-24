// SPDX-License-Identifier: AGPL-3.0-or-later

//! The grade numbers of the list screens (step 38, decisions 83, 90-93), computed with
//! `maatwerk-grades` only: no formula of its own.

pub mod compute;
pub mod format;
pub mod load;

pub use compute::{VakNumbers, compute};
pub use format::{Formats, school_formats, school_formats_in};

use crate::error::Result;
use crate::storage::Storage;

/// Everything the list screens show for one year and vak, under the school's formats. The SE
/// needs every year; those are read only when a student or group of the year is upper school.
pub fn vak_numbers(storage: &Storage, year: &str, vak: &str) -> Result<VakNumbers> {
    let rubrics = load::load_rubrics(storage)?;
    let current = load::load_year(storage, year, vak, &rubrics)?;
    let students = load::load_students(storage, year)?;
    let groups = load::load_groups(storage, year, vak)?;
    let upper = students.iter().any(|s| s.upper)
        || groups
            .iter()
            .any(|g| load::is_upper(g.jaarlaag.clone().map(serde_json::Value::String).as_ref()));
    let mut all_years = vec![];
    if upper {
        for y in storage.list_years() {
            if y == year {
                all_years.push(current.clone());
            } else {
                all_years.push(load::load_year(storage, &y, vak, &rubrics)?);
            }
        }
    }
    Ok(compute(
        vak,
        &current,
        &all_years,
        &students,
        &groups,
        school_formats_in(storage),
    ))
}

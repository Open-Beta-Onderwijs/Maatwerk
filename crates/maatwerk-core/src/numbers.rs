// SPDX-License-Identifier: AGPL-3.0-or-later

//! The grade numbers of the list screens (step 38, decisions 83, 90-93), computed with
//! `maatwerk-grades` only: no formula of its own.

pub mod compute;
pub mod format;
pub mod load;

pub use compute::{VakNumbers, compute};
pub use format::{Formats, school_formats, school_formats_in};

use crate::error::{Error, Result};
use crate::paths::is_year_name;
use crate::storage::Storage;

/// Everything the list screens show for one year and vak, under the school's formats. The SE
/// needs every year; those are read only when a student or group of the year is upper school, or
/// the year has a PTA test.
pub fn vak_numbers(storage: &Storage, year: &str, vak: &str) -> Result<VakNumbers> {
    check_args(year, vak)?;
    let rubrics = load::load_rubrics(storage)?;
    let current = load::load_year(storage, year, vak, &rubrics)?;
    let students = load::load_students(storage, year)?;
    let groups = load::load_groups(storage, year, vak)?;
    let upper = students.iter().any(|s| s.upper)
        || current.exams.iter().any(crate::grades::Exam::is_pta)
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

/// From the UI: a school year folder name and one plain vak name, never a path.
fn check_args(year: &str, vak: &str) -> Result<()> {
    let plain = !vak.is_empty()
        && vak.len() <= 64
        && vak
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_');
    if is_year_name(year) && plain {
        Ok(())
    } else {
        Err(Error::InvalidArgument {
            message: format!("Geen geldig schooljaar of vak: {year:?}, {vak:?}."),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn year_and_vak_are_names_not_paths() {
        assert!(check_args("2025-2026", "nat").is_ok());
        assert!(check_args("2025-2026", "wi_a").is_ok());
        for (y, v) in [
            ("2025-2026", "../x"),
            ("2025-2026", "a/b"),
            ("2025-2026", ""),
            ("..", "nat"),
            ("2025-2026/scores", "nat"),
        ] {
            assert!(check_args(y, v).is_err(), "{y} {v}");
        }
    }
}

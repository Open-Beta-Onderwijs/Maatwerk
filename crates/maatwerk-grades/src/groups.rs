// SPDX-License-Identifier: AGPL-3.0-or-later

//! The one rule for "the student's group" (decision 17, B19, B31).

use crate::model::{Exam, Group};

fn matches_exam(group: &Group, exam: &Exam) -> bool {
    let same_vak = match (&group.subject, &exam.subject) {
        (Some(g), Some(e)) => g == e,
        _ => true,
    };
    let same_jaarlaag = group.jaarlaag == exam.jaarlaag;
    let shared_soort = exam.schoolsoort.is_empty()
        || group
            .schoolsoort
            .iter()
            .any(|s| exam.schoolsoort.contains(s));
    same_vak && same_jaarlaag && shared_soort
}

/// Name order that does not depend on the files' order or on upper and lower case.
fn name_key(group: &Group) -> (String, &str) {
    (group.name.to_lowercase(), group.id.as_str())
}

/// The student's group for `exam`: among groups with the exam's vak, jaarlaag and an overlapping
/// schoolsoort, the first by name; if none, the first of all the student's groups by name.
pub fn student_group<'a>(student_id: &str, exam: &Exam, groups: &'a [Group]) -> Option<&'a Group> {
    let mut own: Vec<&Group> = groups
        .iter()
        .filter(|g| g.student_ids.iter().any(|id| id == student_id))
        .collect();
    own.sort_by_cached_key(|g| name_key(g));
    own.iter()
        .find(|g| matches_exam(g, exam))
        .or_else(|| own.first())
        .copied()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn group(name: &str, jaarlaag: u32, soort: &str, students: &[&str]) -> Group {
        serde_json::from_value(json!({
            "id": name, "name": name, "subject": "nat", "jaarlaag": jaarlaag,
            "schoolsoort": [soort], "student_ids": students
        }))
        .unwrap()
    }

    fn exam() -> Exam {
        serde_json::from_value(json!({
            "id": "e", "subject": "nat", "jaarlaag": "4", "schoolsoort": ["Vwo"]
        }))
        .unwrap()
    }

    #[test]
    fn the_approved_examples() {
        let groups = [
            group("4vB", 4, "Vwo", &["1"]),
            group("4vA", 4, "Vwo", &["1"]),
            group("3hB", 3, "Havo", &["2"]),
        ];
        assert_eq!(student_group("1", &exam(), &groups).unwrap().name, "4vA");
        assert_eq!(student_group("2", &exam(), &groups).unwrap().name, "3hB");
        assert!(student_group("3", &exam(), &groups).is_none());
    }

    #[test]
    fn a_matching_group_wins_over_an_earlier_name() {
        let groups = [group("3a", 3, "Vwo", &["1"]), group("4v", 4, "Vwo", &["1"])];
        assert_eq!(student_group("1", &exam(), &groups).unwrap().name, "4v");
    }

    #[test]
    fn the_file_order_does_not_matter() {
        let (a, b) = (
            group("4vA", 4, "Vwo", &["1"]),
            group("4vB", 4, "Vwo", &["1"]),
        );
        let first = [a.clone(), b.clone()];
        let second = [b, a];
        assert_eq!(student_group("1", &exam(), &first).unwrap().name, "4vA");
        assert_eq!(student_group("1", &exam(), &second).unwrap().name, "4vA");
    }

    #[test]
    fn schoolsoort_and_vak_must_fit() {
        let other_soort = group("4hA", 4, "Havo", &["1"]);
        let mut other_vak = group("4vA", 4, "Vwo", &["1"]);
        other_vak.subject = Some("bio".to_owned());
        let right = group("4vZ", 4, "Vwo", &["1"]);
        let groups = [other_soort, other_vak, right];
        assert_eq!(student_group("1", &exam(), &groups).unwrap().name, "4vZ");
    }
}

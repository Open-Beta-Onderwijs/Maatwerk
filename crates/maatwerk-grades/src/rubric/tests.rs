// SPDX-License-Identifier: AGPL-3.0-or-later

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
    assert!(c.gaps.is_empty());
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
    assert_eq!(c.gaps, vec![(3, 3), (5, 7)]);
    assert_eq!(c.errors, vec!["Niet gedekt: 3, 5–7"]);
    let c = check_category(&cat(4, &[(1, 2), (3, 3)]));
    assert_eq!(c.errors, vec!["Niet gedekt: 0, 4"]);
    // Two in a row read as two numbers; overlaps do not hide a later gap.
    let c = check_category(&cat(9, &[(0, 5), (1, 3), (8, 9)]));
    assert_eq!(c.errors, vec!["Niet gedekt: 6, 7"]);
}

#[test]
fn a_huge_max_is_refused_at_once() {
    // Review 21 M1: the old check walked every score up to the max; now the max is at most
    // 100 and the gaps come from the intervals, so neither costs anything.
    let c = check_category(&cat(4_000_000_000, &[(0, 1), (2, 3)]));
    assert_eq!(
        c.errors,
        vec!["Het maximum moet een heel getal van 1 tot en met 100 zijn"]
    );
    assert_eq!(gaps(&[(0, 0, 1), (1, 2, 3)], u32::MAX), vec![(4, u32::MAX)]);
}

#[test]
fn shared_bounds_name_their_levels() {
    let c = check_category(&cat(6, &[(0, 2), (2, 2), (2, 4), (5, 6)]));
    assert_eq!(c.shared_min, vec![1, 2]);
    assert_eq!(c.shared_max, vec![0, 1]);
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
    assert_eq!(check.gaps, vec![(0, 4)]);
}

#[test]
fn max_must_be_a_whole_number_from_one_to_a_hundred() {
    for max in [
        json!(0),
        json!(2.5),
        json!(-1),
        json!(""),
        json!(null),
        json!(101),
    ] {
        let c: Category = serde_json::from_value(json!({
            "id": "c", "naam": "A", "max": max,
            "niveaus": [{"min": 0, "max": 0, "uitleg": "x"}, {"min": 1, "max": 1, "uitleg": "x"}]
        }))
        .unwrap();
        assert_eq!(
            errors(&c),
            vec!["Het maximum moet een heel getal van 1 tot en met 100 zijn"],
            "{max}"
        );
    }
    let mut levels: Vec<(u32, u32)> = vec![(0, 50)];
    levels.push((51, 100));
    assert!(
        errors(&cat(100, &levels)).is_empty(),
        "100 itself is allowed"
    );
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

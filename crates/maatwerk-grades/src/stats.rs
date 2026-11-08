// SPDX-License-Identifier: AGPL-3.0-or-later

//! Class statistics, histograms, grade groups and boxplots (decisions 2, 11, 14). All take
//! rounded grades, as `Results::grade` gives them.

use serde::Serialize;

use crate::round::is_fail;

/// `sum / n`; `None` for no values.
pub fn mean(values: &[f64]) -> Option<f64> {
    (!values.is_empty()).then(|| values.iter().sum::<f64>() / values.len() as f64)
}

/// The population SD (divides by n): the class is the whole population. One value gives 0.
pub fn sd(values: &[f64]) -> Option<f64> {
    let m = mean(values)?;
    let squares: f64 = values.iter().map(|v| (v - m) * (v - m)).sum();
    Some((squares / values.len() as f64).sqrt())
}

/// Mean, SD and % onvoldoende of a set of grades.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Stats {
    pub n: usize,
    pub mean: f64,
    pub sd: f64,
    /// Whole percent of the grades below 5,5.
    pub fails: f64,
}

/// The statistics of `grades`; `None` when there are none.
pub fn stats(grades: &[f64]) -> Option<Stats> {
    let fails = grades.iter().filter(|g| is_fail(**g)).count();
    Some(Stats {
        n: grades.len(),
        mean: mean(grades)?,
        sd: sd(grades)?,
        fails: crate::round::round0(100.0 * fails as f64 / grades.len() as f64),
    })
}

/// A histogram: counts per bin and where the pass line sits.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Histogram {
    pub bins: Vec<usize>,
    /// Upper bound of each bin; the last bin includes it (10,0).
    pub upper: Vec<f64>,
    /// The pass line sits before this bin.
    pub pass_bin: usize,
}

/// Half-open bins of width `step` (0,5: from 1,0, 18 bins; 1: from 0,5, 10 bins).
pub fn histogram(grades: &[f64], step: f64) -> Histogram {
    let half_steps = step == 0.5;
    let (start, count) = if half_steps { (1.0, 18) } else { (0.5, 10) };
    let mut bins = vec![0; count];
    for &g in grades {
        // Whole tenths, so the bin of a rounded grade does not depend on its binary value.
        let tenths = (g * 10.0).round() as i64;
        let (from, width) = ((start * 10.0) as i64, (step * 10.0) as i64);
        let index = (tenths - from).div_euclid(width).clamp(0, count as i64 - 1);
        bins[index as usize] += 1;
    }
    let upper = (1..=count)
        .map(|i| (start + i as f64 * step).min(10.0))
        .collect();
    let pass_bin = ((5.5 - start) / step).round() as usize;
    Histogram {
        bins,
        upper,
        pass_bin,
    }
}

/// The last group's label includes exactly 8,0.
pub const GRADE_GROUP_LABELS: [&str; 6] = ["<4", "4–5", "5–6", "6–7", "7–8", "≥8"];

/// The grade group of a rounded grade.
pub fn grade_group(grade: f64) -> usize {
    match grade {
        g if g < 4.0 => 0,
        g if g < 5.0 => 1,
        g if g < 6.0 => 2,
        g if g < 7.0 => 3,
        g if g < 8.0 => 4,
        _ => 5,
    }
}

/// The five numbers of a boxplot.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct BoxStats {
    pub min: f64,
    pub q1: f64,
    pub median: f64,
    pub q3: f64,
    pub max: f64,
}

/// Excel's QUARTILE.INC: linear interpolation at position `p x (n - 1)` (decision 14).
fn quantile(sorted: &[f64], p: f64) -> f64 {
    let position = p * (sorted.len() - 1) as f64;
    let below = position.floor() as usize;
    let above = position.ceil() as usize;
    sorted[below] + (position - below as f64) * (sorted[above] - sorted[below])
}

/// The boxplot of `values`; `None` for no values.
pub fn box_stats(values: &[f64]) -> Option<BoxStats> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    Some(BoxStats {
        min: sorted[0],
        q1: quantile(&sorted, 0.25),
        median: quantile(&sorted, 0.5),
        q3: quantile(&sorted, 0.75),
        max: sorted[sorted.len() - 1],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::round::round1;

    #[test]
    fn the_approved_statistics() {
        let s = stats(&[5.0, 6.0, 7.0, 8.0]).unwrap();
        assert_eq!(s.n, 4);
        assert_eq!(s.mean, 6.5);
        assert_eq!(round1(s.sd), 1.1);
        assert_eq!(s.fails, 25.0);
    }

    #[test]
    fn one_student_has_sd_zero() {
        let s = stats(&[7.0]).unwrap();
        assert_eq!((s.mean, s.sd, s.fails), (7.0, 0.0, 0.0));
    }

    #[test]
    fn no_grades_no_statistics() {
        assert_eq!(stats(&[]), None);
        assert_eq!(mean(&[]), None);
        assert_eq!(box_stats(&[]), None);
    }

    #[test]
    fn the_approved_rounded_means() {
        // Grades as the students see them.
        assert_eq!(round1(mean(&[6.5, 6.5, 6.5, 6.3]).unwrap()), 6.5);
        assert_eq!(round1(mean(&[5.4, 5.4, 5.5]).unwrap()), 5.4);
        assert_eq!(round1(mean(&[6.3, 6.4]).unwrap()), 6.4);
    }

    #[test]
    fn the_pass_mark_is_5_5_exactly() {
        assert_eq!(stats(&[5.4, 5.5]).unwrap().fails, 50.0);
    }

    #[test]
    fn histogram_half_steps_are_half_open() {
        let h = histogram(&[1.0, 5.4, 5.5, 5.9, 6.0, 9.9, 10.0], 0.5);
        assert_eq!(h.bins.len(), 18);
        assert_eq!(h.pass_bin, 9);
        assert_eq!(h.bins[0], 1); // 1,0 to below 1,5
        assert_eq!(h.bins[8], 1); // 5,0 to below 5,5
        assert_eq!(h.bins[9], 2); // 5,5 to below 6,0
        assert_eq!(h.bins[10], 1); // 6,0 to below 6,5
        assert_eq!(h.bins[17], 2); // 9,5 to 10,0, both ends
        assert_eq!(h.upper[8], 5.5);
        assert_eq!(h.upper[17], 10.0);
    }

    #[test]
    fn histogram_whole_steps() {
        let h = histogram(&[1.0, 5.4, 5.5, 10.0], 1.0);
        assert_eq!(h.bins.len(), 10);
        assert_eq!(h.pass_bin, 5);
        assert_eq!(h.bins[0], 1);
        assert_eq!(h.bins[4], 1); // 4,5 to below 5,5
        assert_eq!(h.bins[5], 1); // 5,5 to below 6,5
        assert_eq!(h.bins[9], 1);
    }

    #[test]
    fn the_approved_grade_groups() {
        assert_eq!(grade_group(3.9), 0);
        assert_eq!(grade_group(4.0), 1);
        assert_eq!(grade_group(5.9), 2);
        assert_eq!(grade_group(7.9), 4);
        assert_eq!(grade_group(8.0), 5);
        assert_eq!(grade_group(10.0), 5);
        assert_eq!(GRADE_GROUP_LABELS[5], "≥8");
    }

    #[test]
    fn the_approved_boxplot() {
        let b = box_stats(&[8.0, 5.0, 7.0, 6.0]).unwrap();
        assert_eq!(
            (b.min, b.q1, b.median, b.q3, b.max),
            (5.0, 5.75, 6.5, 7.25, 8.0)
        );
    }

    #[test]
    fn boxplot_of_odd_and_single_counts() {
        let b = box_stats(&[1.0, 2.0, 3.0, 4.0, 5.0]).unwrap();
        assert_eq!((b.q1, b.median, b.q3), (2.0, 3.0, 4.0));
        let one = box_stats(&[7.0]).unwrap();
        assert_eq!(
            (one.min, one.q1, one.median, one.q3, one.max),
            (7.0, 7.0, 7.0, 7.0, 7.0)
        );
    }
}

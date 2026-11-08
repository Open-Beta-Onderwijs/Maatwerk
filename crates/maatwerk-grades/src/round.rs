// SPDX-License-Identifier: AGPL-3.0-or-later

//! The one rounding of the app (decision 3): exact half-up, after removing floating-point noise.
//!
//! `8,65` can be computed as `8,6499999...`; rounding that directly gives `8,6`. So the value goes
//! to whole billionths first, which absorbs the noise, and is then rounded in integers, where a
//! half is exactly a half.

/// Billionths per unit: far finer than any real score, far coarser than double-precision noise.
const NANOS: i128 = 1_000_000_000;

fn to_nanos(x: f64) -> i128 {
    (x * NANOS as f64).round() as i128
}

/// `x` rounded half-up (towards +infinity) to `decimals` decimals, at most 9.
fn round_to(x: f64, decimals: u32) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let scale = 10_i128.pow(decimals);
    let unit = NANOS / scale;
    let units = (to_nanos(x) + unit / 2).div_euclid(unit);
    units as f64 / scale as f64
}

/// One decimal: every grade, mean and SD.
pub fn round1(x: f64) -> f64 {
    round_to(x, 1)
}

/// A whole number: every percentage.
pub fn round0(x: f64) -> f64 {
    round_to(x, 0)
}

/// `x` without floating-point noise: `0,1 + 0,2` gives `0,3`. Used for point totals.
pub fn clean(x: f64) -> f64 {
    round_to(x, 9)
}

/// The pass mark, compared with the rounded grade.
pub const PASS: f64 = 5.5;

/// A grade below 5,5 after rounding.
pub fn is_fail(grade: f64) -> bool {
    round1(grade) < PASS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_halves_round_up() {
        assert_eq!(round1(8.65), 8.7);
        assert_eq!(round1(2.35), 2.4);
        assert_eq!(round1(6.35), 6.4);
        assert_eq!(round1(5.45), 5.5);
        assert_eq!(round1(7.25), 7.3);
        assert_eq!(round1(13.25), 13.3);
        assert_eq!(round0(78.5), 79.0);
    }

    #[test]
    fn floating_point_noise_does_not_change_the_result() {
        // What the old `(S / L) * 9 + n` computed for these exact halves.
        assert_eq!(round1(8.649999999999999), 8.7);
        assert_eq!(round1(2.3499999999999996), 2.4);
        assert_eq!(round1(5.449999999999999), 5.5);
    }

    #[test]
    fn values_below_a_half_round_down() {
        assert_eq!(round1(5.44), 5.4);
        assert_eq!(round1(5.449), 5.4);
        assert_eq!(round1(5.4499), 5.4);
        assert_eq!(round0(39.4), 39.0);
    }

    #[test]
    fn negative_values_round_towards_plus_infinity_at_a_half() {
        assert_eq!(round1(-0.25), -0.2);
        assert_eq!(round1(-0.26), -0.3);
    }

    #[test]
    fn clean_removes_noise_from_totals() {
        assert_eq!(clean(0.1 + 0.2), 0.3);
        assert_eq!(clean(12.5), 12.5);
    }

    #[test]
    fn non_finite_values_pass_through() {
        assert!(round1(f64::NAN).is_nan());
        assert_eq!(round1(f64::INFINITY), f64::INFINITY);
    }

    #[test]
    fn fail_uses_the_rounded_grade() {
        assert!(is_fail(5.44));
        assert!(!is_fail(5.45));
        assert!(!is_fail(5.5));
    }
}

// SPDX-License-Identifier: AGPL-3.0-or-later

//! The one rounding of the app (decision 3): exact half-up, after removing floating-point noise.
//!
//! `8,65` can be computed as `8,6499999...`; rounding that directly gives `8,6`. So the value goes
//! to whole billionths first, which absorbs the noise, and is then rounded in integers, where a
//! half is exactly a half.
//!
//! Students' averages have their own, school-wide format (`AverageFormat`, step 38).

use serde::{Deserialize, Serialize};

/// Billionths per unit: far finer than any real score, far coarser than double-precision noise.
const NANOS: i128 = 1_000_000_000;

fn to_nanos(x: f64) -> i128 {
    (x * NANOS as f64).round() as i128
}

/// `x` rounded half-up (towards +infinity) to `decimals` decimals, at most 9.
fn round_to(x: f64, decimals: u32) -> f64 {
    // Far beyond any real score; billionths of it would not fit.
    if !x.is_finite() || x.abs() > 1e15 {
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

/// How a student's average is shown (Cijfergemiddelden, decisions 91-93): rounded half-up
/// (afronden) or towards zero (afkappen).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Method {
    #[default]
    Afronden,
    Afkappen,
}

/// The school's format for one kind of student average (r or SE): a method and 0, 1 or 2
/// decimals. The default is afronden 1, the rule before the setting existed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "RawFormat", into = "RawFormat")]
pub struct AverageFormat {
    method: Method,
    decimals: u8,
}

/// The stored form, as in the school settings: `{ "methode": "afkappen", "decimalen": 0 }`.
#[derive(Serialize, Deserialize)]
struct RawFormat {
    #[serde(default)]
    methode: Method,
    #[serde(default = "one")]
    decimalen: u8,
}

fn one() -> u8 {
    1
}

impl TryFrom<RawFormat> for AverageFormat {
    type Error = String;
    fn try_from(raw: RawFormat) -> Result<Self, String> {
        AverageFormat::new(raw.methode, raw.decimalen)
            .ok_or_else(|| format!("decimalen must be 0, 1 or 2, not {}", raw.decimalen))
    }
}

impl From<AverageFormat> for RawFormat {
    fn from(f: AverageFormat) -> Self {
        RawFormat {
            methode: f.method,
            decimalen: f.decimals,
        }
    }
}

impl Default for AverageFormat {
    fn default() -> Self {
        AverageFormat {
            method: Method::Afronden,
            decimals: 1,
        }
    }
}

impl AverageFormat {
    /// `None` for more than 2 decimals.
    pub fn new(method: Method, decimals: u8) -> Option<Self> {
        (decimals <= 2).then_some(AverageFormat { method, decimals })
    }

    pub fn method(self) -> Method {
        self.method
    }

    pub fn decimals(self) -> u8 {
        self.decimals
    }
}

/// A student's average as shown under `fmt`: noise removed in billionths first (as `round1`),
/// so an exact half or an exact decimal stays exact, then rounded half-up or cut towards zero.
/// 5,45: afronden 0 gives 5, afronden 1 5,5, afkappen 1 5,4; 5,999... (noise) afkappen 0 gives 6.
pub fn shown_average(x: f64, fmt: AverageFormat) -> f64 {
    let decimals = u32::from(fmt.decimals);
    match fmt.method {
        Method::Afronden => round_to(x, decimals),
        Method::Afkappen => cut_to(x, decimals),
    }
}

/// `x` cut towards zero to `decimals` decimals, at most 9, after removing noise.
fn cut_to(x: f64, decimals: u32) -> f64 {
    if !x.is_finite() || x.abs() > 1e15 {
        return x;
    }
    let scale = 10_i128.pow(decimals);
    // Integer division truncates towards zero.
    let units = to_nanos(x) / (NANOS / scale);
    units as f64 / scale as f64
}

/// The pass mark, compared with the rounded grade.
pub const PASS: f64 = 5.5;

/// A shown student average below 5,5 (decision 92: pass/fail follows the shown value, so
/// afronden 2 shows 5,45 and that fails; afkappen 0 shows 5,9 as 5).
pub fn is_fail_shown(shown: f64) -> bool {
    clean(shown) < PASS
}

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
        assert_eq!(round1(1e30), 1e30);
    }

    fn fmt(method: Method, decimals: u8) -> AverageFormat {
        AverageFormat::new(method, decimals).unwrap()
    }

    #[test]
    fn the_spec_table_of_shown_averages() {
        use Method::{Afkappen as K, Afronden as A};
        // Rows of "Shown averages" in step-19-grade-rules.md: a0 a1 a2 k0 k1 k2.
        let rows: [(f64, [f64; 6]); 5] = [
            (5.45, [5.0, 5.5, 5.45, 5.0, 5.4, 5.45]),
            (5.9, [6.0, 5.9, 5.9, 5.0, 5.9, 5.9]),
            (6.75, [7.0, 6.8, 6.75, 6.0, 6.7, 6.75]),
            (22.0 / 3.0, [7.0, 7.3, 7.33, 7.0, 7.3, 7.33]),
            (6.95, [7.0, 7.0, 6.95, 6.0, 6.9, 6.95]),
        ];
        let formats = [
            fmt(A, 0),
            fmt(A, 1),
            fmt(A, 2),
            fmt(K, 0),
            fmt(K, 1),
            fmt(K, 2),
        ];
        for (x, want) in rows {
            for (f, w) in formats.iter().zip(want) {
                assert_eq!(shown_average(x, *f), w, "{x} {f:?}");
            }
        }
        // (5,3 + 5,7) / 2 in doubles.
        assert_eq!(shown_average((5.3 + 5.7) / 2.0, fmt(K, 0)), 5.0);
        assert_eq!(shown_average((5.3 + 5.7) / 2.0, fmt(A, 0)), 6.0);
    }

    #[test]
    fn afkappen_survives_noise_just_below_a_decimal() {
        assert_eq!(
            shown_average(5.999_999_999_999_999, fmt(Method::Afkappen, 0)),
            6.0
        );
        assert_eq!(
            shown_average(8.649_999_999_999_999, fmt(Method::Afkappen, 2)),
            8.65
        );
        assert_eq!(shown_average(-0.25, fmt(Method::Afkappen, 1)), -0.2);
    }

    #[test]
    fn a_format_has_at_most_two_decimals_and_reads_the_stored_form() {
        assert!(AverageFormat::new(Method::Afronden, 3).is_none());
        let f: AverageFormat =
            serde_json::from_str(r#"{"methode":"afkappen","decimalen":0}"#).unwrap();
        assert_eq!(f, fmt(Method::Afkappen, 0));
        assert_eq!(
            serde_json::to_value(f).unwrap(),
            serde_json::json!({"methode": "afkappen", "decimalen": 0})
        );
        let missing: AverageFormat = serde_json::from_str("{}").unwrap();
        assert_eq!(missing, AverageFormat::default());
        assert!(serde_json::from_str::<AverageFormat>(r#"{"decimalen":3}"#).is_err());
        assert!(serde_json::from_str::<AverageFormat>(r#"{"methode":"x"}"#).is_err());
    }

    #[test]
    fn a_shown_value_below_the_pass_mark_fails() {
        assert!(is_fail_shown(5.45));
        assert!(is_fail_shown(5.0));
        assert!(!is_fail_shown(5.5));
        assert!(!is_fail_shown(5.5 - 1e-15));
    }

    #[test]
    fn fail_uses_the_rounded_grade() {
        assert!(is_fail(5.44));
        assert!(!is_fail(5.45));
        assert!(!is_fail(5.5));
    }
}

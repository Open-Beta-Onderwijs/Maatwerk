// SPDX-License-Identifier: AGPL-3.0-or-later

//! Minimum app version (PLAN-2 decision 5, ADR-0010 4). `school.json` may name the oldest app
//! that may write the data folder (`minAppVersion`, e.g. `"0.9.0"`). An older app still opens
//! the folder and reads everything, but refuses every write ([`crate::Error::ReadOnly`]), so it
//! cannot write an old format over data a newer app has migrated.

use std::cmp::Ordering;

use serde_json::Value;

/// This build's version (the workspace version).
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// The field in `school.json`.
pub const MIN_APP_VERSION_FIELD: &str = "minAppVersion";

/// `major.minor.patch` as numbers; a pre-release or build suffix (`-rc.1`, `+abc`) is ignored, so
/// `0.9.0-rc.1` counts as `0.9.0`. Missing parts are 0 (`"1.2"` = 1.2.0). `None` if a part is not
/// a number.
pub fn parse(version: &str) -> Option<[u64; 3]> {
    let core = version
        .trim()
        .trim_start_matches('v')
        .split(['-', '+'])
        .next()?;
    let mut out = [0u64; 3];
    let mut parts = core.split('.');
    for slot in &mut out {
        match parts.next() {
            Some(p) => *slot = p.parse().ok()?,
            None => break,
        }
    }
    if parts.next().is_some() {
        return None;
    }
    Some(out)
}

/// Compares two versions; `None` if either does not parse.
pub fn compare(a: &str, b: &str) -> Option<Ordering> {
    Some(parse(a)?.cmp(&parse(b)?))
}

/// The `minAppVersion` of a `school.json` value when `app_version` is older than it. A value that
/// is not a version string (a future format, a typo) also counts as newer: refusing to write is
/// the safe side, and the message shows the value. An empty or missing field is no limit.
pub fn required_version(school: &Value, app_version: &str) -> Option<String> {
    let min = match school.get(MIN_APP_VERSION_FIELD)? {
        Value::Null => return None,
        Value::String(s) if s.trim().is_empty() => return None,
        Value::String(s) => s.trim().to_owned(),
        // Not a version string (a number, an object): a format this app does not know.
        other => return Some(other.to_string()),
    };
    match compare(app_version, &min) {
        Some(Ordering::Less) | None => Some(min),
        Some(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_versions() {
        assert_eq!(parse("0.6.0"), Some([0, 6, 0]));
        assert_eq!(parse("v1.2"), Some([1, 2, 0]));
        assert_eq!(parse("0.9.0-rc.1"), Some([0, 9, 0]));
        assert_eq!(parse("1.0.0+build.5"), Some([1, 0, 0]));
        assert_eq!(parse("0.10.0"), Some([0, 10, 0]));
        assert_eq!(parse("1.x"), None);
        assert_eq!(parse("1.2.3.4"), None);
        assert_eq!(parse(""), None);
    }

    #[test]
    fn compares_numerically() {
        assert_eq!(compare("0.10.0", "0.9.0"), Some(Ordering::Greater));
        assert_eq!(compare("0.6.0", "0.6"), Some(Ordering::Equal));
        assert_eq!(compare("0.5.9", "0.6.0"), Some(Ordering::Less));
    }

    #[test]
    fn required_version_only_when_older() {
        let school = |v: Value| json!({ "naam": "School", "minAppVersion": v });
        assert_eq!(required_version(&json!({}), "0.6.0"), None);
        assert_eq!(required_version(&school(Value::Null), "0.6.0"), None);
        assert_eq!(required_version(&school(json!("")), "0.6.0"), None);
        assert_eq!(required_version(&school(json!("0.6.0")), "0.6.0"), None);
        assert_eq!(required_version(&school(json!("0.5.0")), "0.6.0"), None);
        assert_eq!(
            required_version(&school(json!("0.9.0")), "0.6.0"),
            Some("0.9.0".into())
        );
        assert_eq!(
            required_version(&school(json!("0.10.0")), "0.9.0"),
            Some("0.10.0".into())
        );
        // Not a version: refused, shown as is.
        assert_eq!(
            required_version(&school(json!("next")), "0.6.0"),
            Some("next".into())
        );
        assert_eq!(
            required_version(&school(json!(3)), "0.6.0"),
            Some("3".into())
        );
        // A number is never a version here, also a small one (review 15 m3).
        assert_eq!(
            required_version(&school(json!(0.5)), "0.6.0"),
            Some("0.5".into())
        );
    }
}

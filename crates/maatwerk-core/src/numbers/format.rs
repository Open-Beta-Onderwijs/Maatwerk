// SPDX-License-Identifier: AGPL-3.0-or-later

//! The school's Cijfergemiddelden (step 38, decisions 91-93): an additive field in
//! `instellingen.json`, set by the admin on Beheer › Instellingen:
//!
//! ```json
//! { "gemiddelden": { "r": { "methode": "afkappen", "decimalen": 0 },
//!                    "se": { "methode": "afronden", "decimalen": 2 } } }
//! ```
//!
//! Missing, or an unusable value, means afronden 1 for that average (the rule before the
//! setting), so a bad `se` never changes `r`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::grades::AverageFormat;
use crate::paths::RelPath;
use crate::snapshots::SETTINGS_FILE;
use crate::storage::Storage;

/// The object in `instellingen.json` that holds the formats.
pub const SCHOOL_FIELD: &str = "gemiddelden";

/// The formats of a student's year average (r) and SE average.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Formats {
    pub r: AverageFormat,
    pub se: AverageFormat,
}

fn one(field: Option<&Value>, key: &str) -> AverageFormat {
    field
        .and_then(|g| g.get(key))
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default()
}

/// The formats in `instellingen` (its parsed JSON); each one afronden 1 when missing or unusable.
pub fn school_formats(instellingen: Option<&Value>) -> Formats {
    let field = instellingen.and_then(|v| v.get(SCHOOL_FIELD));
    Formats {
        r: one(field, "r"),
        se: one(field, "se"),
    }
}

/// [`school_formats`] for the data folder; an unreadable file counts as the default.
pub fn school_formats_in(storage: &Storage) -> Formats {
    let value = RelPath::parse(SETTINGS_FILE)
        .ok()
        .and_then(|rel| storage.read_json(&rel).ok().flatten());
    school_formats(value.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grades::Method;
    use serde_json::json;

    fn f(method: Method, decimals: u8) -> AverageFormat {
        AverageFormat::new(method, decimals).unwrap()
    }

    #[test]
    fn missing_is_afronden_1() {
        assert_eq!(school_formats(None), Formats::default());
        assert_eq!(school_formats(Some(&json!({}))), Formats::default());
        assert_eq!(
            school_formats(Some(&json!({ "gemiddelden": {} }))).r,
            f(Method::Afronden, 1)
        );
    }

    #[test]
    fn each_average_has_its_own_format() {
        let v = json!({ "snapshots": {}, "gemiddelden": {
            "r": { "methode": "afkappen", "decimalen": 0 },
            "se": { "methode": "afronden", "decimalen": 2 }
        }});
        let got = school_formats(Some(&v));
        assert_eq!(got.r, f(Method::Afkappen, 0));
        assert_eq!(got.se, f(Method::Afronden, 2));
    }

    #[test]
    fn an_unusable_value_is_the_default_for_that_average_only() {
        let v = json!({ "gemiddelden": {
            "r": { "methode": "afkappen", "decimalen": 7 },
            "se": { "methode": "afkappen" }
        }});
        let got = school_formats(Some(&v));
        assert_eq!(got.r, AverageFormat::default());
        // A missing `decimalen` is 1.
        assert_eq!(got.se, f(Method::Afkappen, 1));
        let bad = json!({ "gemiddelden": "afkappen" });
        assert_eq!(school_formats(Some(&bad)), Formats::default());
    }
}

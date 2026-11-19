// SPDX-License-Identifier: AGPL-3.0-or-later

//! The school's AI switch (step 32c, decision 73 and the answers under decision 75): an
//! additive field in `instellingen.json`, set by the admin on Beheer › Instellingen:
//!
//! ```json
//! { "ai": { "enabled": false } }
//! ```
//!
//! Missing, or anything but `false`, means on. No `minAppVersion` raise: no app before the
//! switch has an AI assistant, so an older app has nothing to switch off, and every older app
//! keeps the field when it saves the settings (the Instellingen tab writes the whole object
//! back). Raising the version would lock older apps out of the data for no gain.

use serde_json::Value;

use crate::paths::RelPath;
use crate::snapshots::SETTINGS_FILE;
use crate::storage::Storage;

/// The object in `instellingen.json` that holds the switch.
pub const SCHOOL_FIELD: &str = "ai";

/// Whether the school allows the AI assistant (`ai.enabled` is not `false`).
pub fn school_allows(instellingen: Option<&Value>) -> bool {
    instellingen
        .and_then(|v| v.get(SCHOOL_FIELD))
        .and_then(|ai| ai.get("enabled"))
        .and_then(Value::as_bool)
        != Some(false)
}

/// [`school_allows`] for the data folder; an unreadable file counts as on (Gegevenscontrole
/// reports it).
pub fn school_allows_in(storage: &Storage) -> bool {
    let value = RelPath::parse(SETTINGS_FILE)
        .ok()
        .and_then(|rel| storage.read_json(&rel).ok().flatten());
    school_allows(value.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_or_true_is_on() {
        assert!(school_allows(None));
        assert!(school_allows(Some(&json!({}))));
        assert!(school_allows(Some(&json!({ "ai": {} }))));
        assert!(school_allows(Some(&json!({ "ai": { "enabled": true } }))));
        // Anything that is not the boolean false keeps it on.
        assert!(school_allows(Some(&json!({ "ai": { "enabled": "nee" } }))));
        assert!(school_allows(Some(&json!({ "ai": false }))));
    }

    #[test]
    fn false_is_off() {
        assert!(!school_allows(Some(
            &json!({ "snapshots": { "daily": 7 }, "ai": { "enabled": false } })
        )));
    }
}

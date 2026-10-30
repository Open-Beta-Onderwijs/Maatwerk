// SPDX-License-Identifier: AGPL-3.0-or-later

//! Integrity stamp `_meta.hash` (ADR-0003 C19, `docs/reference/data-files-v2.md`): SHA-256 of
//! the canonical JSON of a value with `_meta.hash` left out. Detects accidental changes made
//! outside Maatwerk; not tamper-proof (anyone can re-stamp).

use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

/// What the stamp of a value says.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StampState {
    /// `_meta.hash` matches the content.
    Ok,
    /// No `_meta.hash` (or the value is not an object with `_meta`).
    Missing,
    /// `_meta.hash` is there but does not match: changed outside Maatwerk.
    Mismatch,
}

/// Compact JSON with object keys sorted by byte order; numbers and strings as `serde_json`
/// prints them.
pub fn canonical_json(value: &Value) -> String {
    let mut out = String::new();
    write_canonical(&mut out, value);
    out
}

fn write_canonical(out: &mut String, value: &Value) {
    match value {
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(out, item);
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push('{');
            for (i, key) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String(key.clone()).to_string());
                out.push(':');
                write_canonical(out, &map[key]);
            }
            out.push('}');
        }
        scalar => out.push_str(&scalar.to_string()),
    }
}

/// The stamp `value` should carry: SHA-256 hex of its canonical JSON without `_meta.hash`.
pub fn content_hash(value: &Value) -> String {
    let text = match value {
        Value::Object(map) if meta_hash(map).is_some() => {
            let mut copy = map.clone();
            if let Some(Value::Object(meta)) = copy.get_mut("_meta") {
                meta.shift_remove("hash");
            }
            canonical_json(&Value::Object(copy))
        }
        other => canonical_json(other),
    };
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn meta_hash(map: &Map<String, Value>) -> Option<&Value> {
    map.get("_meta").and_then(|m| m.get("hash"))
}

/// Sets `_meta.hash` on an object (creating `_meta` as the last key if needed). Other values
/// are left alone: only objects can carry a stamp.
pub fn stamp(value: &mut Value) {
    let Value::Object(map) = value else { return };
    let meta = map
        .entry("_meta")
        .or_insert_with(|| Value::Object(Map::new()));
    if !meta.is_object() {
        *meta = Value::Object(Map::new());
    }
    // A placeholder keeps the key's position; the hash is computed without it.
    if let Value::Object(meta) = meta {
        meta.entry("hash").or_insert(Value::Null);
    }
    let hash = content_hash(value);
    if let Some(Value::Object(meta)) = value.get_mut("_meta") {
        meta.insert("hash".into(), Value::String(hash));
    }
}

/// The file text Maatwerk writes for `value` (`JSON.stringify(x, null, 2)` plus a newline, C13)
/// with a stamp that matches that text when it is read back. The JS number format can change a
/// value (`2.0` and `1e2` are written as `2` and `100`), so the stamp is taken from the value as
/// written (review 7a M2). Returns the value as written and the text.
pub fn stamped_text(value: &Value) -> (Value, String) {
    let mut v = value.clone();
    stamp(&mut v);
    let mut text = crate::jsonfmt::to_js_json(&v);
    if let Ok(mut back) = serde_json::from_str::<Value>(&text)
        && check(&back) != StampState::Ok
    {
        stamp(&mut back);
        text = crate::jsonfmt::to_js_json(&back);
        v = back;
    }
    text.push('\n');
    (v, text)
}

/// Checks the stamp of `value`.
pub fn check(value: &Value) -> StampState {
    let Value::Object(map) = value else {
        return StampState::Missing;
    };
    match meta_hash(map) {
        Some(Value::String(h)) if *h == content_hash(value) => StampState::Ok,
        Some(_) => StampState::Mismatch,
        None => StampState::Missing,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonical_json_sorts_keys_at_every_level() {
        let v = json!({ "b": 1, "a": { "y": [2, { "d": null, "c": "é" }], "x": 1.5 } });
        assert_eq!(
            canonical_json(&v),
            r#"{"a":{"x":1.5,"y":[2,{"c":"é","d":null}]},"b":1}"#
        );
    }

    #[test]
    fn stamp_appends_meta_and_check_accepts_it() {
        let mut v = json!({ "id": "g1", "name": "3a nat" });
        stamp(&mut v);
        let keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, ["id", "name", "_meta"]);
        assert_eq!(check(&v), StampState::Ok);
        assert_eq!(v["_meta"]["hash"].as_str().unwrap().len(), 64);
    }

    #[test]
    fn stamp_keeps_other_meta_fields_and_ignores_key_order_and_formatting() {
        let mut a = json!({ "x": 1, "_meta": { "rev": 3 } });
        stamp(&mut a);
        assert_eq!(a["_meta"]["rev"], 3);
        // Same content, other key order, re-parsed from pretty text: still valid.
        let text = crate::jsonfmt::to_js_json(&a);
        let reparsed: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(check(&reparsed), StampState::Ok);
        let mut b = json!({ "_meta": { "hash": a["_meta"]["hash"].clone(), "rev": 3 }, "x": 1 });
        assert_eq!(check(&b), StampState::Ok);
        b["x"] = json!(2);
        assert_eq!(check(&b), StampState::Mismatch);
    }

    #[test]
    fn restamping_is_stable() {
        let mut v = json!({ "x": [1, 2.25, "N"] });
        stamp(&mut v);
        let first = v["_meta"]["hash"].clone();
        stamp(&mut v);
        assert_eq!(v["_meta"]["hash"], first);
    }

    #[test]
    fn missing_or_foreign_stamps() {
        assert_eq!(check(&json!({ "x": 1 })), StampState::Missing);
        assert_eq!(check(&json!([1, 2])), StampState::Missing);
        assert_eq!(
            check(&json!({ "x": 1, "_meta": { "hash": 5 } })),
            StampState::Mismatch
        );
        let mut arr = json!([1]);
        stamp(&mut arr);
        assert_eq!(arr, json!([1]), "arrays cannot carry a stamp");
    }

    #[test]
    fn m2_the_stamp_describes_numbers_as_written() {
        // `2.0` is written as `2` and `1e2` as `100` (JS number format).
        let v: Value = serde_json::from_str(r#"{"a": 2.0, "b": 1e2, "c": [0.5]}"#).unwrap();
        let (written, text) = stamped_text(&v);
        let back: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(check(&back), StampState::Ok, "{text}");
        assert_eq!(back, written);
        assert!(text.ends_with("}\n"));
        // Writing the read-back value again gives the same bytes.
        assert_eq!(stamped_text(&back).1, text);
    }

    #[test]
    fn floats_survive_the_write_read_round_trip() {
        for x in [0.1, 1.0 / 3.0, 2.675, 1e21, 1e-7, 123456.789] {
            let mut v = json!({ "x": x });
            stamp(&mut v);
            let text = crate::jsonfmt::to_js_json(&v);
            let back: Value = serde_json::from_str(&text).unwrap();
            assert_eq!(check(&back), StampState::Ok, "{x}");
        }
    }
}

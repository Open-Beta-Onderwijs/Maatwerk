// SPDX-License-Identifier: AGPL-3.0-or-later

//! JSON text exactly as the reference writes it: `JSON.stringify(value, null, 2)`, no trailing
//! newline (S10). `serde_json`'s pretty printer differs in number formatting (`1.0`, `1e21`,
//! `1e-6`), so numbers follow ECMAScript `Number.prototype.toString` here. Key order is the
//! insertion order (`serde_json` with `preserve_order`).

use serde_json::{Number, Value};

/// `JSON.stringify(value, null, 2)`.
pub fn to_js_json(value: &Value) -> String {
    let mut out = String::new();
    write_value(&mut out, value, 0);
    out
}

fn write_value(out: &mut String, value: &Value, depth: usize) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => out.push_str(&js_number(n)),
        Value::String(s) => write_string(out, s),
        Value::Array(items) => {
            if items.is_empty() {
                out.push_str("[]");
                return;
            }
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                newline(out, depth + 1);
                write_value(out, item, depth + 1);
            }
            newline(out, depth);
            out.push(']');
        }
        Value::Object(map) => {
            if map.is_empty() {
                out.push_str("{}");
                return;
            }
            out.push('{');
            for (i, (key, item)) in map.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                newline(out, depth + 1);
                write_string(out, key);
                out.push_str(": ");
                write_value(out, item, depth + 1);
            }
            newline(out, depth);
            out.push('}');
        }
    }
}

fn newline(out: &mut String, depth: usize) {
    out.push('\n');
    for _ in 0..depth {
        out.push_str("  ");
    }
}

/// `JSON.stringify` string escaping: `"`, `\`, the five short escapes, other C0 controls as
/// lowercase `\u00xx`. Everything else (including U+2028/9 and DEL) stays literal.
fn write_string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

fn js_number(n: &Number) -> String {
    if let Some(i) = n.as_i64() {
        return i.to_string();
    }
    if let Some(u) = n.as_u64() {
        return u.to_string();
    }
    js_f64(n.as_f64().unwrap_or(0.0))
}

/// ECMAScript `Number::toString(x)` for finite `x` (ECMA-262 6.1.6.1.20). Shortest round-trip
/// digits come from `ryu`, which picks the same digits as JS engines.
pub(crate) fn js_f64(x: f64) -> String {
    if x == 0.0 {
        return "0".to_owned(); // also -0
    }
    let mut buf = ryu::Buffer::new();
    let text = buf.format_finite(x.abs());
    let (digits, n) = decimal_parts(text);
    let k = digits.len() as i32;
    let sign = if x < 0.0 { "-" } else { "" };
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let e = n - 1;
        let exp = if e >= 0 {
            format!("+{e}")
        } else {
            e.to_string()
        };
        if k == 1 {
            format!("{digits}e{exp}")
        } else {
            format!("{}.{}e{exp}", &digits[..1], &digits[1..])
        }
    };
    format!("{sign}{body}")
}

/// Splits ryu output (`"123.45"`, `"1e21"`, `"1.5e-7"`) into significant digits `s` and `n` with
/// value = 0.s × 10^n, without leading or trailing zeros in `s`.
fn decimal_parts(text: &str) -> (String, i32) {
    let (mantissa, exp) = match text.split_once(['e', 'E']) {
        Some((m, e)) => (m, e.parse::<i32>().unwrap_or(0)),
        None => (text, 0),
    };
    let (int_part, frac_part) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    let mut digits: String = format!("{int_part}{frac_part}");
    let mut n = int_part.len() as i32 + exp;
    let leading = digits.len() - digits.trim_start_matches('0').len();
    digits.drain(..leading);
    n -= leading as i32;
    let trimmed = digits.trim_end_matches('0').len();
    digits.truncate(trimmed);
    (digits, n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Expected strings checked with Node 24: `String(x)` / `JSON.stringify(v, null, 2)`.
    #[test]
    fn numbers_like_js() {
        let cases: &[(f64, &str)] = &[
            (0.1, "0.1"),
            (1.5, "1.5"),
            (7.0, "7"),
            (100.0, "100"),
            (-2.25, "-2.25"),
            (-0.0, "0"),
            (0.1 + 0.2, "0.30000000000000004"),
            (1e21, "1e+21"),
            (1e20, "100000000000000000000"),
            (123456789012345680000.0, "123456789012345680000"),
            (1.5e21, "1.5e+21"),
            (0.000001, "0.000001"),
            (0.0000012, "0.0000012"),
            (1e-7, "1e-7"),
            (1.25e-7, "1.25e-7"),
            (5e-324, "5e-324"),
            (1.7976931348623157e308, "1.7976931348623157e+308"),
            (2.0 / 3.0, "0.6666666666666666"),
            (6.65, "6.65"),
        ];
        for &(x, want) in cases {
            assert_eq!(js_f64(x), want, "{x:e}");
        }
    }

    #[test]
    fn stringify_layout_like_js() {
        let v = json!({
            "b": 1,
            "a": [],
            "c": {},
            "d": [1, {"x": null, "y": true}, "s"],
            "e": 2.5,
            "f": -3
        });
        let want = "{\n  \"b\": 1,\n  \"a\": [],\n  \"c\": {},\n  \"d\": [\n    1,\n    {\n      \"x\": null,\n      \"y\": true\n    },\n    \"s\"\n  ],\n  \"e\": 2.5,\n  \"f\": -3\n}";
        assert_eq!(to_js_json(&v), want);
        assert_eq!(to_js_json(&json!(null)), "null");
        assert_eq!(to_js_json(&json!([])), "[]");
    }

    #[test]
    fn key_order_is_insertion_order() {
        let v: Value = serde_json::from_str(r#"{"z":1,"a":2,"m":{"y":1,"b":2}}"#).unwrap();
        assert_eq!(
            to_js_json(&v),
            "{\n  \"z\": 1,\n  \"a\": 2,\n  \"m\": {\n    \"y\": 1,\n    \"b\": 2\n  }\n}"
        );
    }

    #[test]
    fn string_escapes_like_js() {
        let s = "q\"b\\n\n\r\t\u{8}\u{c}\u{1}\u{1f}\u{7f}é\u{2028}😀/";
        assert_eq!(
            to_js_json(&json!(s)),
            "\"q\\\"b\\\\n\\n\\r\\t\\b\\f\\u0001\\u001f\u{7f}é\u{2028}😀/\""
        );
    }

    #[test]
    fn parsed_floats_reprint_like_js() {
        // What the webview sends is already JS-formatted; reading and writing must not change it.
        let text = r#"[0.5,7,1e+21,1e-7,0.000001,-0,12.000]"#;
        let v: Value = serde_json::from_str(text).unwrap();
        assert_eq!(
            to_js_json(&v),
            "[\n  0.5,\n  7,\n  1e+21,\n  1e-7,\n  0.000001,\n  0,\n  12\n]"
        );
    }
}

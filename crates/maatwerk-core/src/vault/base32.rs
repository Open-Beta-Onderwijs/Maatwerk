// SPDX-License-Identifier: AGPL-3.0-or-later

//! RFC 4648 base32 in lowercase without padding, for encrypted file names (ADR-0012: OneDrive
//! and Windows ignore case, so the alphabet has one case and no `-`, which splits off a
//! conflict-copy suffix).
//!
//! Decoding accepts either case but only the **canonical** encoding (unused trailing bits zero,
//! no impossible lengths): two physical names must never decode to the same logical name.

const ALPHABET: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";

/// Whether `c` is a base32 character (either case).
pub fn is_alphabet(c: char) -> bool {
    c.is_ascii_alphabetic() || ('2'..='7').contains(&c)
}

pub fn encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(5) * 8);
    let mut buffer: u32 = 0;
    let mut bits = 0;
    for &b in bytes {
        buffer = (buffer << 8) | u32::from(b);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(ALPHABET[((buffer >> bits) & 31) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(ALPHABET[((buffer << (5 - bits)) & 31) as usize] as char);
    }
    out
}

/// `None` for a character outside the alphabet or a non-canonical encoding.
pub fn decode(text: &str) -> Option<Vec<u8>> {
    // Lengths mod 8 that a whole number of bytes produces: 0, 2, 4, 5, 7.
    if matches!(text.len() % 8, 1 | 3 | 6) {
        return None;
    }
    let mut out = Vec::with_capacity(text.len() * 5 / 8);
    let mut buffer: u32 = 0;
    let mut bits = 0;
    for c in text.bytes() {
        let v = match c.to_ascii_lowercase() {
            c @ b'a'..=b'z' => c - b'a',
            c @ b'2'..=b'7' => c - b'2' + 26,
            _ => return None,
        };
        buffer = (buffer << 5) | u32::from(v);
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
        }
    }
    // The left-over bits are padding and must be zero.
    if buffer & ((1 << bits) - 1) != 0 {
        return None;
    }
    Some(out)
}

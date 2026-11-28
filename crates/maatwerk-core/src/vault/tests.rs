// SPDX-License-Identifier: AGPL-3.0-or-later

use std::collections::BTreeMap;

use aes_siv::siv::{Aes128Siv, Aes256Siv};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use zeroize::Zeroizing;

use super::keys::{KeyEntry, test_kek_id};
use super::*;

fn hex(s: &str) -> Vec<u8> {
    assert!(s.len().is_multiple_of(2), "{s}");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

fn to_hex(b: &[u8]) -> String {
    b.iter().map(|b| format!("{b:02x}")).collect()
}

/// Fixed keys, so names and the pinned vector are reproducible.
fn fixed_keys() -> SchoolKeys {
    let id = KeyId([1, 2, 3, 4]);
    SchoolKeys {
        school_id: "school-test".into(),
        current: id,
        names: id,
        deks: BTreeMap::from([(id, Zeroizing::new([7u8; 32]))]),
    }
}

fn vault() -> Vault {
    Vault::new(&fixed_keys())
}

// ---- Known answers for the primitives, as this module calls them ----

/// draft-irtf-cfrg-xchacha-03, appendix A.3.1.
#[test]
fn kat_xchacha20poly1305() {
    let key = hex("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f");
    let nonce: [u8; 24] = hex("404142434445464748494a4b4c4d4e4f5051525354555657")
        .try_into()
        .unwrap();
    let aad = hex("50515253c0c1c2c3c4c5c6c7");
    let plain = b"Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.";
    let expected = hex(concat!(
        "bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb",
        "731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b452",
        "2f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff9",
        "21f9664c97637da9768812f615c68b13b52e",
        "c0875924c1c7987947deafd8780acf49",
    ));
    let cipher = XChaCha20Poly1305::new_from_slice(&key).unwrap();
    let out = cipher
        .encrypt(
            &XNonce::from(nonce),
            Payload {
                msg: plain,
                aad: &aad,
            },
        )
        .unwrap();
    assert_eq!(to_hex(&out), to_hex(&expected));
}

/// Wycheproof `aes_siv_cmac_test.json`, key size 512 (the name cipher), tcId 302 and 303.
#[test]
fn kat_aes256_siv_wycheproof() {
    let cases = [
        (
            "c25cafc6018b98dfbb79a40ec89c575a4f88c4116489bba27707479800c0130235334a45dbe8d8dae3da8dcb45bbe5dce031b0f68ded544fda7eca30d6749442",
            "deeb0ccf3aef47a296ed1ca8f4ae5907",
            "beec61030fa3d670337196beade6aeaa",
            "5865208eab9163db85cab9f96d846234a2626aae22f5c17c9aad4b501f4416e4",
        ),
        (
            "27faf97fb303aa4f2f364edd23997f4c77b8e51ebb8293c59dfb1d24f0fb629f6c820fc2d91bf48f0035eeec347e37ec4fb0cb36102bcdc5a248c47a2f97eab9",
            "cc94f64e14df90265f7f12a8a0386d0a",
            "6b1db0f5a43376885002dc98bd556f1dac9b66b66213a9fa6069df995a123384",
            "d0016d675b49f11ea873707412d45709b7703a028a0cfc312cf61cbe22b91e3cf20b7d4c9308ee15f18b4eba00889284",
        ),
    ];
    for (key, aad, msg, ct) in cases {
        let mut siv = Aes256Siv::new_from_slice(&hex(key)).unwrap();
        let out = siv.encrypt([hex(aad)], &hex(msg)).unwrap();
        assert_eq!(to_hex(&out), ct);
        assert_eq!(siv.decrypt([hex(aad)], &out).unwrap(), hex(msg));
    }
}

/// RFC 5297 appendix A.1 (AES-128 SIV): the header-passing convention is the one the RFC uses.
#[test]
fn kat_aes_siv_rfc5297() {
    let key = hex("fffefdfcfbfaf9f8f7f6f5f4f3f2f1f0f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff");
    let ad = hex("101112131415161718191a1b1c1d1e1f2021222324252627");
    let plain = hex("112233445566778899aabbccddee");
    let mut siv = Aes128Siv::new_from_slice(&key).unwrap();
    let out = siv.encrypt([ad], &plain).unwrap();
    assert_eq!(
        to_hex(&out),
        "85632d07c6e8f37f950acd320a2ecc9340c02b9690c4dc04daef7f6afe5c"
    );
}

/// RFC 4648 section 10, lowercase without padding.
#[test]
fn base32_rfc4648_vectors() {
    for (plain, enc) in [
        ("", ""),
        ("f", "my"),
        ("fo", "mzxq"),
        ("foo", "mzxw6"),
        ("foob", "mzxw6yq"),
        ("fooba", "mzxw6ytb"),
        ("foobar", "mzxw6ytboi"),
    ] {
        assert_eq!(base32::encode(plain.as_bytes()), enc);
        assert_eq!(base32::decode(enc).unwrap(), plain.as_bytes());
        assert_eq!(
            base32::decode(&enc.to_uppercase()).unwrap(),
            plain.as_bytes()
        );
    }
    // Non-canonical (trailing bits set), impossible lengths, characters outside the alphabet.
    for bad in ["mz", "m", "mzx", "mzxw6y", "my=", "m0", "my-"] {
        assert_eq!(base32::decode(bad), None, "{bad}");
    }
}

// ---- The file format ----

/// Pinned output of the format (fixed DEK and nonce): a change here changes every file on disk
/// and needs a format version bump and a migration.
#[test]
fn format_is_pinned() {
    let sealed = vault()
        .seal_with_nonce(
            "2025-2026/scores/nat/900001.json",
            br#"{"student_id":"900001"}"#,
            Compression::Stored,
            [9u8; 24],
        )
        .unwrap();
    assert_eq!(&sealed[..10], b"MWK1\x01\x00\x01\x02\x03\x04");
    assert_eq!(to_hex(&sealed), PINNED);
    let name = vault()
        .encrypt_name("2025-2026/scores/nat", "900001.json")
        .unwrap();
    assert_eq!(name, PINNED_NAME);
}

const PINNED: &str = concat!(
    "4d574b31010001020304",
    "090909090909090909090909090909090909090909090909",
    "a033b3828fe2d14fec4128c1c7533d73bc40113eff22d71cb8fa47618a9148fb5166526fd88b5b",
);
const PINNED_NAME: &str = "m4k3pyhtcu2aba4nr5ve244qs56laqxrltfgb24x4req.mwk";

#[test]
fn round_trip_stored_and_deflated() {
    let v = vault();
    let big = br#"{"a":1,"b":[1,2,3]}"#.repeat(5000);
    for plain in [&b""[..], b"x", br#"{"a":1}"#, &big[..]] {
        for c in [Compression::Stored, Compression::Deflate] {
            let sealed = v.seal("gebruikers/a.json", plain, c).unwrap();
            assert_eq!(v.open("gebruikers/a.json", &sealed).unwrap(), plain);
        }
    }
    let deflated = v.seal("x.json", &big, Compression::Deflate).unwrap();
    assert!(deflated.len() < big.len() / 10, "{}", deflated.len());
}

#[test]
fn fresh_nonce_per_write() {
    let v = vault();
    let a = v.seal("x.json", b"same", Compression::Stored).unwrap();
    let b = v.seal("x.json", b"same", Compression::Stored).unwrap();
    assert_ne!(a, b);
}

#[test]
fn every_changed_byte_is_refused() {
    let v = vault();
    let sealed = v
        .seal("school.json", b"{\"naam\":\"x\"}", Compression::Deflate)
        .unwrap();
    for i in 0..sealed.len() {
        let mut bad = sealed.clone();
        bad[i] ^= 0x01;
        let err = v.open("school.json", &bad).unwrap_err();
        let expected = match i {
            0..4 => VaultError::NotVault,
            4 => VaultError::UnsupportedVersion(0),
            6..10 => VaultError::UnknownKey(KeyId([0; 4])),
            _ => VaultError::Tampered,
        };
        assert_eq!(
            std::mem::discriminant(&err),
            std::mem::discriminant(&expected),
            "byte {i}: {err:?}"
        );
    }
    // Flag bit 0 cleared on a deflated file: the header is authenticated.
    let mut bad = sealed.clone();
    bad[5] = 0;
    assert_eq!(v.open("school.json", &bad), Err(VaultError::Tampered));
    // A flag this version does not know.
    let mut bad = sealed.clone();
    bad[5] = 0x03;
    assert_eq!(
        v.open("school.json", &bad),
        Err(VaultError::UnknownFlags(0x03))
    );
}

#[test]
fn a_file_moved_or_swapped_is_refused() {
    let v = vault();
    let a = v
        .seal("2025-2026/scores/nat/1.json", b"{}", Compression::Stored)
        .unwrap();
    assert_eq!(
        v.open("2025-2026/scores/nat/2.json", &a),
        Err(VaultError::Tampered)
    );
    assert_eq!(
        v.open("2025-2026/scores/bio/1.json", &a),
        Err(VaultError::Tampered)
    );
}

#[test]
fn every_truncation_is_refused() {
    let v = vault();
    let sealed = v
        .seal("x.json", b"{\"a\":12345}", Compression::Deflate)
        .unwrap();
    for n in 0..sealed.len() {
        let err = v.open("x.json", &sealed[..n]).unwrap_err();
        assert!(
            matches!(err, VaultError::Truncated | VaultError::Tampered),
            "{n}: {err:?}"
        );
    }
    // Plain JSON is not a vault file.
    assert_eq!(v.open("x.json", b"{\"a\":1}"), Err(VaultError::NotVault));
}

#[test]
fn unknown_key_id_and_rotation() {
    let kek = Kek::test();
    let (mut file, keys) = KeyFile::create(&kek, "school-a").unwrap();
    let old = Vault::new(&keys);
    let sealed_old = old.seal("x.json", b"old", Compression::Stored).unwrap();

    let new_id = file.rotate(&kek).unwrap();
    let keys = file.open(&kek).unwrap();
    assert_eq!(keys.current, new_id);
    assert_ne!(keys.names, new_id, "the name key stays");
    let new = Vault::new(&keys);
    // Old files open, new writes use the new key, names do not change.
    assert_eq!(new.open("x.json", &sealed_old).unwrap(), b"old");
    let sealed_new = new.seal("x.json", b"new", Compression::Stored).unwrap();
    assert_eq!(&sealed_new[6..10], &new_id.0);
    assert_eq!(
        old.encrypt_name("", "school.json").unwrap(),
        new.encrypt_name("", "school.json").unwrap()
    );
    // The old vault has no entry for the new key.
    assert_eq!(
        old.open("x.json", &sealed_new),
        Err(VaultError::UnknownKey(new_id))
    );
}

#[test]
fn deflate_bomb_is_capped() {
    let v = vault();
    let sealed = v
        .seal("x.json", &vec![b' '; 10_000], Compression::Deflate)
        .unwrap();
    assert_eq!(
        v.open_with_cap("x.json", &sealed, 9_999),
        Err(VaultError::TooLarge)
    );
    assert_eq!(
        v.open_with_cap("x.json", &sealed, 10_000).unwrap().len(),
        10_000
    );
}

// ---- Names ----

#[test]
fn names_round_trip_and_are_deterministic() {
    let v = vault();
    for (parent, name) in [
        ("", "school.json"),
        ("gebruikers", "gebr-1756713600001.json"),
        (
            "2025-2026/exams",
            "nat-toets-h1-krachten-nergie-herkansing-2025-2026.json",
        ),
        ("afbeeldingen", "gebr-1756713600001.jpg"),
        ("observaties", "obs-ë-ß-🙂.json"),
    ] {
        let physical = v.encrypt_name(parent, name).unwrap();
        assert_eq!(physical, v.encrypt_name(parent, name).unwrap());
        assert!(physical.ends_with(".mwk"));
        assert!(
            physical[..physical.len() - 4]
                .chars()
                .all(|c| c.is_ascii_lowercase() || ('2'..='7').contains(&c)),
            "{physical}"
        );
        let decoded = v.decrypt_name(parent, &physical).unwrap();
        assert_eq!(decoded.name, name);
        assert_eq!(decoded.conflict, None);
        // Windows may hand the name back in another case.
        assert_eq!(
            v.decrypt_name(parent, &physical.to_uppercase())
                .unwrap()
                .name,
            name
        );
    }
}

#[test]
fn a_name_belongs_to_its_folder() {
    let v = vault();
    let physical = v
        .encrypt_name("2025-2026/scores/nat", "900001.json")
        .unwrap();
    assert_ne!(
        physical,
        v.encrypt_name("2025-2026/scores/bio", "900001.json")
            .unwrap()
    );
    assert!(matches!(
        v.decrypt_name("2025-2026/scores/bio", &physical),
        Err(VaultError::BadName(_))
    ));
}

#[test]
fn conflict_copies_decode_to_the_original() {
    let v = vault();
    let physical = v.encrypt_name("rubrics", "rubric-onderzoek.json").unwrap();
    let stem = physical.strip_suffix(".mwk").unwrap();
    for suffix in ["-PC", "-LAPTOP-JAN", "-PC-2", " (1)", "-PC.MWK"] {
        let (copy, expect) = match suffix.strip_suffix(".MWK") {
            Some(s) => (format!("{stem}{s}.MWK"), s),
            None => (format!("{stem}{suffix}.mwk"), suffix),
        };
        let decoded = v.decrypt_name("rubrics", &copy).unwrap();
        assert_eq!(decoded.name, "rubric-onderzoek.json");
        assert_eq!(decoded.conflict.as_deref(), Some(expect), "{copy}");
    }
}

#[test]
fn name_limits_and_foreign_names() {
    let v = vault();
    let max = "a".repeat(MAX_NAME_BYTES - 5) + ".json";
    let physical = v.encrypt_name("x", &max).unwrap();
    // Layout report section 8: 64 bytes encode to 128 characters, 132 with `.mwk`.
    assert_eq!(physical.len(), 132);
    assert_eq!(
        v.encrypt_name("x", &format!("a{max}")),
        Err(VaultError::NameTooLong(65))
    );
    // Multi-byte characters count in bytes.
    assert_eq!(
        v.encrypt_name("x", &"é".repeat(33)),
        Err(VaultError::NameTooLong(66))
    );
    for bad in ["", ".", "..", "a/b.json", "a\\b.json", "a\0.json"] {
        assert!(
            matches!(v.encrypt_name("x", bad), Err(VaultError::BadName(_))),
            "{bad:?}"
        );
    }
    // Plain files and junk are not encrypted names.
    for foreign in [
        "school.json",
        "main.typ",
        "abc.mwk",
        ".mwk",
        "mwk",
        "desktop.ini",
        "ab€.mwk",
    ] {
        assert!(
            matches!(v.decrypt_name("x", foreign), Err(VaultError::BadName(_))),
            "{foreign}"
        );
    }
}

// ---- Keys ----

#[test]
fn key_file_round_trip_through_json() {
    let kek = Kek::test();
    let (file, keys) = KeyFile::create(&kek, "school-a").unwrap();
    let json = serde_json::to_string_pretty(&file).unwrap();
    assert!(json.contains("\"schoolId\": \"school-a\""), "{json}");
    let back: KeyFile = serde_json::from_str(&json).unwrap();
    assert_eq!(back, file);
    let reopened = back.open(&kek).unwrap();
    let (a, b) = (Vault::new(&keys), Vault::new(&reopened));
    let sealed = a.seal("x.json", b"hallo", Compression::Deflate).unwrap();
    assert_eq!(b.open("x.json", &sealed).unwrap(), b"hallo");
    assert_eq!(
        a.encrypt_name("", "school.json").unwrap(),
        b.encrypt_name("", "school.json").unwrap()
    );
}

#[test]
fn two_schools_get_different_keys() {
    let kek = Kek::test();
    let (_, a) = KeyFile::create(&kek, "school-a").unwrap();
    let (_, b) = KeyFile::create(&kek, "school-b").unwrap();
    let (a, b) = (Vault::new(&a), Vault::new(&b));
    let sealed = a.seal("x.json", b"{}", Compression::Stored).unwrap();
    assert!(b.open("x.json", &sealed).is_err());
    assert_ne!(
        a.encrypt_name("", "school.json").unwrap(),
        b.encrypt_name("", "school.json").unwrap()
    );
}

#[test]
fn test_key_data_is_refused_by_a_release_kek() {
    let (file, _) = KeyFile::create(&Kek::test(), "school-a").unwrap();
    assert_eq!(file.kek, test_kek_id().to_string());
    let release = Kek::from_bytes([42u8; 32]);
    assert!(!release.is_test());
    assert!(Kek::test().is_test());
    assert_eq!(file.open(&release).unwrap_err(), VaultError::TestKey);
    // And release data is not opened by another build's KEK.
    let (file, _) = KeyFile::create(&release, "school-a").unwrap();
    assert_eq!(file.open(&Kek::test()).unwrap_err(), VaultError::WrongKek);
    assert_eq!(
        file.open(&Kek::from_bytes([43u8; 32])).unwrap_err(),
        VaultError::WrongKek
    );
}

#[test]
fn a_changed_key_file_is_refused() {
    let kek = Kek::test();
    let (file, _) = KeyFile::create(&kek, "school-a").unwrap();
    // Another school id: the wrapped key's associated data no longer matches.
    let mut other = file.clone();
    other.school_id = "school-b".into();
    assert!(matches!(other.open(&kek), Err(VaultError::KeyFile(_))));
    // An entry moved to another id.
    let mut moved = file.clone();
    moved.keys[0].id = "deadbeef".into();
    moved.current = "deadbeef".into();
    moved.names = "deadbeef".into();
    assert!(matches!(moved.open(&kek), Err(VaultError::KeyFile(_))));
    // A flipped bit in the wrapped key.
    let mut flipped = file.clone();
    let mut raw = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &flipped.keys[0].wrapped,
    )
    .unwrap();
    raw[30] ^= 1;
    flipped.keys[0].wrapped =
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, raw);
    assert!(matches!(flipped.open(&kek), Err(VaultError::KeyFile(_))));
    // `current` without an entry, a duplicate entry, an unknown format.
    let mut no_current = file.clone();
    no_current.current = "00000000".into();
    assert!(matches!(no_current.open(&kek), Err(VaultError::KeyFile(_))));
    let mut twice = file.clone();
    let entry: KeyEntry = twice.keys[0].clone();
    twice.keys.push(entry);
    assert!(matches!(twice.open(&kek), Err(VaultError::KeyFile(_))));
    let mut future = file;
    future.format = 2;
    assert!(matches!(future.open(&kek), Err(VaultError::KeyFile(_))));
}

// SPDX-License-Identifier: AGPL-3.0-or-later

//! Keys (ADR-0012 item 4, layout report section 5): the KEK built into the exe wraps one random
//! DEK per school; `sleutels.json` holds the wrapped DEKs with key ids.
//!
//! - `kek`: the id of the KEK that wrapped the entries, so data made with the public test key is
//!   recognised (and refused by a release app) instead of failing as "tampered".
//! - `names`: the key id whose DEK gives the name key. Names are deterministic, so a new content
//!   key (rotation) keeps the name key; changing it means renaming every file.
//! - `current`: the key id new writes use. Older ids stay, so old files and snapshots open.

use std::collections::BTreeMap;
use std::fmt;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use super::{VaultError, random};

/// The key file's name in the data root (plain: nothing opens before it is read).
pub const KEY_FILE: &str = "sleutels.json";
/// `sleutels.json` `format`.
pub const KEY_FILE_FORMAT: u32 = 1;

/// The public test KEK of debug and test builds (ADR-0012 item 4). Not a secret: data under it
/// is test data, and a release app refuses it ([`VaultError::TestKey`]).
const TEST_KEK: [u8; 32] = *b"maatwerk public test key, step41";

/// A 4-byte key id, shown and stored as 8 lowercase hex digits.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct KeyId(pub [u8; 4]);

impl KeyId {
    fn random() -> Result<Self, VaultError> {
        let mut id = [0u8; 4];
        random(&mut id)?;
        Ok(Self(id))
    }

    fn parse(hex: &str) -> Result<Self, VaultError> {
        let bad = || VaultError::KeyFile(format!("key id {hex:?}"));
        if hex.len() != 8 {
            return Err(bad());
        }
        let mut id = [0u8; 4];
        for (i, b) in id.iter_mut().enumerate() {
            *b = u8::from_str_radix(hex.get(2 * i..2 * i + 2).ok_or_else(bad)?, 16)
                .map_err(|_| bad())?;
        }
        Ok(Self(id))
    }
}

impl fmt::Display for KeyId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for b in self.0 {
            write!(f, "{b:02x}")?;
        }
        Ok(())
    }
}

impl fmt::Debug for KeyId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "KeyId({self})")
    }
}

/// The key-encryption key built into the exe (sub-task 3 reads it at build time).
pub struct Kek {
    key: Zeroizing<[u8; 32]>,
    id: KeyId,
}

impl Kek {
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        let id = kek_id(&bytes);
        Self {
            key: Zeroizing::new(bytes),
            id,
        }
    }

    /// The public test KEK.
    pub fn test() -> Self {
        Self::from_bytes(TEST_KEK)
    }

    pub fn id(&self) -> KeyId {
        self.id
    }

    pub fn is_test(&self) -> bool {
        self.id == test_kek_id()
    }

    fn cipher(&self) -> XChaCha20Poly1305 {
        XChaCha20Poly1305::new_from_slice(&self.key[..]).expect("32-byte key")
    }
}

impl fmt::Debug for Kek {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Kek({})", self.id)
    }
}

/// The id a KEK is known by: the first 4 bytes of SHA-256 over a label and the key.
fn kek_id(key: &[u8; 32]) -> KeyId {
    let digest = Sha256::new()
        .chain_update(b"maatwerk kek id v1")
        .chain_update(key)
        .finalize();
    KeyId([digest[0], digest[1], digest[2], digest[3]])
}

pub fn test_kek_id() -> KeyId {
    kek_id(&TEST_KEK)
}

/// `sleutels.json` as stored (plain JSON; the DEKs inside are wrapped).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyFile {
    pub format: u32,
    pub school_id: String,
    /// Id of the KEK that wrapped the entries.
    pub kek: String,
    /// Key id of the name key.
    pub names: String,
    /// Key id new writes use.
    pub current: String,
    pub keys: Vec<KeyEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyEntry {
    pub id: String,
    /// Base64 of nonce (24) || XChaCha20-Poly1305(KEK, DEK) (32 + 16).
    pub wrapped: String,
}

/// The unwrapped keys of one school, ready for [`super::Vault::new`].
pub struct SchoolKeys {
    pub school_id: String,
    pub current: KeyId,
    pub names: KeyId,
    pub(super) deks: BTreeMap<KeyId, Zeroizing<[u8; 32]>>,
}

impl fmt::Debug for SchoolKeys {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SchoolKeys")
            .field("school_id", &self.school_id)
            .field("current", &self.current)
            .field("names", &self.names)
            .field("ids", &self.deks.keys().collect::<Vec<_>>())
            .finish()
    }
}

/// Associated data of a wrapped DEK: an entry moved to another school or id fails to open.
fn wrap_aad(school_id: &str, id: KeyId) -> Vec<u8> {
    format!("maatwerk dek v1\n{school_id}\n{id}").into_bytes()
}

fn wrap(kek: &Kek, school_id: &str, id: KeyId, dek: &[u8; 32]) -> Result<String, VaultError> {
    let mut nonce = [0u8; 24];
    random(&mut nonce)?;
    let aad = wrap_aad(school_id, id);
    let sealed = kek
        .cipher()
        .encrypt(
            &XNonce::from(nonce),
            Payload {
                msg: dek,
                aad: &aad,
            },
        )
        .map_err(|_| VaultError::Random)?;
    let mut out = nonce.to_vec();
    out.extend_from_slice(&sealed);
    Ok(BASE64.encode(out))
}

fn unwrap(
    kek: &Kek,
    school_id: &str,
    id: KeyId,
    wrapped: &str,
) -> Result<Zeroizing<[u8; 32]>, VaultError> {
    let bytes = BASE64
        .decode(wrapped)
        .map_err(|_| VaultError::KeyFile(format!("key {id}: not base64")))?;
    if bytes.len() != 24 + 32 + 16 {
        return Err(VaultError::KeyFile(format!("key {id}: wrong length")));
    }
    let (nonce, sealed) = bytes.split_at(24);
    let nonce: [u8; 24] = nonce.try_into().expect("24 bytes");
    let aad = wrap_aad(school_id, id);
    let dek = Zeroizing::new(
        kek.cipher()
            .decrypt(
                &XNonce::from(nonce),
                Payload {
                    msg: sealed,
                    aad: &aad,
                },
            )
            .map_err(|_| VaultError::KeyFile(format!("key {id} does not open")))?,
    );
    let mut out = Zeroizing::new([0u8; 32]);
    out.copy_from_slice(&dek);
    Ok(out)
}

impl KeyFile {
    /// A new key file for `school_id` with one random DEK (current and name key).
    pub fn create(kek: &Kek, school_id: &str) -> Result<(Self, SchoolKeys), VaultError> {
        let id = KeyId::random()?;
        let mut dek = Zeroizing::new([0u8; 32]);
        random(&mut dek[..])?;
        let file = Self {
            format: KEY_FILE_FORMAT,
            school_id: school_id.to_owned(),
            kek: kek.id().to_string(),
            names: id.to_string(),
            current: id.to_string(),
            keys: vec![KeyEntry {
                id: id.to_string(),
                wrapped: wrap(kek, school_id, id, &dek)?,
            }],
        };
        let keys = SchoolKeys {
            school_id: school_id.to_owned(),
            current: id,
            names: id,
            deks: BTreeMap::from([(id, dek)]),
        };
        Ok((file, keys))
    }

    /// A new content key that becomes current (rotation). The name key stays.
    pub fn rotate(&mut self, kek: &Kek) -> Result<KeyId, VaultError> {
        self.check_kek(kek)?;
        let mut id = KeyId::random()?;
        while self.keys.iter().any(|k| k.id == id.to_string()) {
            id = KeyId::random()?;
        }
        let mut dek = Zeroizing::new([0u8; 32]);
        random(&mut dek[..])?;
        self.keys.push(KeyEntry {
            id: id.to_string(),
            wrapped: wrap(kek, &self.school_id, id, &dek)?,
        });
        self.current = id.to_string();
        Ok(id)
    }

    /// Unwraps every entry. Fails on a test-key file opened by a non-test KEK
    /// ([`VaultError::TestKey`]), another KEK, an entry that does not open, or a `current` /
    /// `names` id without an entry.
    pub fn open(&self, kek: &Kek) -> Result<SchoolKeys, VaultError> {
        if self.format != KEY_FILE_FORMAT {
            return Err(VaultError::KeyFile(format!("format {}", self.format)));
        }
        self.check_kek(kek)?;
        let mut deks = BTreeMap::new();
        for entry in &self.keys {
            let id = KeyId::parse(&entry.id)?;
            let dek = unwrap(kek, &self.school_id, id, &entry.wrapped)?;
            if deks.insert(id, dek).is_some() {
                return Err(VaultError::KeyFile(format!("key {id} twice")));
            }
        }
        let current = KeyId::parse(&self.current)?;
        let names = KeyId::parse(&self.names)?;
        for id in [current, names] {
            if !deks.contains_key(&id) {
                return Err(VaultError::KeyFile(format!("no key {id}")));
            }
        }
        Ok(SchoolKeys {
            school_id: self.school_id.clone(),
            current,
            names,
            deks,
        })
    }

    fn check_kek(&self, kek: &Kek) -> Result<(), VaultError> {
        let file_kek = KeyId::parse(&self.kek)?;
        if file_kek == kek.id() {
            Ok(())
        } else if file_kek == test_kek_id() {
            Err(VaultError::TestKey)
        } else {
            Err(VaultError::WrongKek)
        }
    }
}

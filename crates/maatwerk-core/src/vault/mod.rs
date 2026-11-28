// SPDX-License-Identifier: AGPL-3.0-or-later

//! Encrypted storage primitives (ADR-0012, `docs/phase-2/step-41b-storage-layout.md`).
//!
//! **Contents** (`seal` / `open`): `MWK1` | format version (1) | flags (1) | key id (4) |
//! nonce (24) | XChaCha20-Poly1305 ciphertext + tag (16). The associated data is the 10-byte
//! header followed by the logical path (forward slashes, relative to the data root), so an
//! edited, truncated, or swapped file fails to open. Flag bit 0: the plain bytes were deflated.
//!
//! **Names** (`encrypt_name` / `decrypt_name`): AES-SIV (AES-256, CMAC) over the full logical
//! file name with the parent's logical path as associated data, lowercase base32 without padding,
//! then `.mwk`. Deterministic and reversible, so a folder lists without opening its files. A
//! OneDrive conflict copy (`<b32>-<PC>.mwk`, `<b32>-<PC>-2.mwk`) decodes to its original's name
//! with the suffix in [`DecodedName::conflict`].
//!
//! Keys: [`keys`]. Content and name keys are HKDF-SHA256 subkeys of a school's DEK.
//!
//! This module is pure: no file I/O. `Storage` maps logical to physical paths (sub-task 4).

mod base32;
pub mod keys;
#[cfg(test)]
mod tests;

use std::collections::BTreeMap;
use std::io::{Read as _, Write as _};

use aes_siv::siv::Aes256Siv;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::Zeroizing;

pub use keys::{KEY_FILE, Kek, KeyFile, KeyId, SchoolKeys};

/// First bytes of every encrypted file.
pub const MAGIC: [u8; 4] = *b"MWK1";
/// The file format version in the header (and so in the associated data).
pub const FORMAT_VERSION: u8 = 1;
/// Extension of an encrypted file name (without the dot).
pub const EXTENSION: &str = "mwk";
/// Longest logical file name, in UTF-8 bytes (layout report section 8: 132 encoded characters).
pub const MAX_NAME_BYTES: usize = 64;
/// Largest plain content a deflated file may expand to (a data file is far smaller; a photo is
/// stored, not deflated).
pub const MAX_PLAIN_BYTES: usize = 64 * 1024 * 1024;

const FLAG_DEFLATE: u8 = 1;
const HEADER_LEN: usize = 4 + 1 + 1 + 4;
const NONCE_LEN: usize = 24;
const TAG_LEN: usize = 16;
/// Smallest valid file: header, nonce, empty ciphertext, tag.
pub const MIN_SEALED_LEN: usize = HEADER_LEN + NONCE_LEN + TAG_LEN;

const CONTENT_INFO: &[u8] = b"maatwerk content key v1";
const NAME_INFO: &[u8] = b"maatwerk name key v1";

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum VaultError {
    /// No `MWK1` header: not an encrypted Maatwerk file.
    #[error("not an encrypted Maatwerk file")]
    NotVault,
    #[error("unsupported format version {0}")]
    UnsupportedVersion(u8),
    #[error("unknown flags {0:#04x}")]
    UnknownFlags(u8),
    /// The file names a key id the key file does not have.
    #[error("unknown key {0}")]
    UnknownKey(KeyId),
    #[error("file too short")]
    Truncated,
    /// Authentication failed: changed outside Maatwerk, moved, or swapped.
    #[error("changed outside Maatwerk")]
    Tampered,
    #[error("content larger than {MAX_PLAIN_BYTES} bytes")]
    TooLarge,
    #[error("file name of {0} bytes, at most {MAX_NAME_BYTES}")]
    NameTooLong(usize),
    /// A name that cannot be a logical file name (empty, `/`, `\`, NUL), or a physical name that
    /// is not an encrypted name.
    #[error("not a valid file name: {0:?}")]
    BadName(String),
    #[error("key file: {0}")]
    KeyFile(String),
    /// Data under the public test key, opened by a release app.
    #[error("data made with the test key")]
    TestKey,
    /// The key file was made with another KEK (another build of the app).
    #[error("key file of another Maatwerk build")]
    WrongKek,
    #[error("no random numbers from the operating system")]
    Random,
}

/// Whether to deflate before encrypting (layout report Q4: data files yes, photos no).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Compression {
    Deflate,
    Stored,
}

/// A decoded physical file name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedName {
    /// The logical file name.
    pub name: String,
    /// The suffix of a conflict copy (`-PC`, `-PC-2`, ` (1)`), `None` for the original.
    pub conflict: Option<String>,
}

/// Content and name crypto for one school.
pub struct Vault {
    current: KeyId,
    content: BTreeMap<KeyId, XChaCha20Poly1305>,
    names: Zeroizing<[u8; 64]>,
}

impl std::fmt::Debug for Vault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Vault")
            .field("current", &self.current)
            .field("ids", &self.content.keys().collect::<Vec<_>>())
            .finish_non_exhaustive()
    }
}

fn random(buf: &mut [u8]) -> Result<(), VaultError> {
    getrandom::fill(buf).map_err(|_| VaultError::Random)
}

fn subkey<const N: usize>(dek: &[u8; 32], info: &[u8]) -> Zeroizing<[u8; N]> {
    let mut out = Zeroizing::new([0u8; N]);
    Hkdf::<Sha256>::new(None, dek)
        .expand(info, &mut out[..])
        .expect("HKDF output of at most 255 blocks");
    out
}

impl Vault {
    pub fn new(keys: &SchoolKeys) -> Self {
        let content = keys
            .deks
            .iter()
            .map(|(id, dek)| {
                let key = subkey::<32>(dek, CONTENT_INFO);
                let cipher = XChaCha20Poly1305::new_from_slice(&key[..]).expect("32-byte key");
                (*id, cipher)
            })
            .collect();
        let names = subkey::<64>(&keys.deks[&keys.names], NAME_INFO);
        Self {
            current: keys.current,
            content,
            names,
        }
    }

    /// Encrypts `plain` for the file at `logical` (forward slashes, relative to the data root)
    /// with the current key and a fresh random nonce.
    pub fn seal(
        &self,
        logical: &str,
        plain: &[u8],
        compression: Compression,
    ) -> Result<Vec<u8>, VaultError> {
        let mut nonce = [0u8; NONCE_LEN];
        random(&mut nonce)?;
        self.seal_with_nonce(logical, plain, compression, nonce)
    }

    fn seal_with_nonce(
        &self,
        logical: &str,
        plain: &[u8],
        compression: Compression,
        nonce: [u8; NONCE_LEN],
    ) -> Result<Vec<u8>, VaultError> {
        let (flags, body) = match compression {
            Compression::Stored => (0, None),
            Compression::Deflate => {
                let mut enc = flate2::write::DeflateEncoder::new(
                    Vec::with_capacity(plain.len() / 4 + 64),
                    flate2::Compression::default(),
                );
                enc.write_all(plain).expect("write to a Vec");
                (FLAG_DEFLATE, Some(enc.finish().expect("write to a Vec")))
            }
        };
        let header = header(flags, self.current);
        let aad = associated_data(&header, logical);
        let sealed = self.content[&self.current]
            .encrypt(
                &XNonce::from(nonce),
                Payload {
                    msg: body.as_deref().unwrap_or(plain),
                    aad: &aad,
                },
            )
            .map_err(|_| VaultError::TooLarge)?;
        let mut out = Vec::with_capacity(HEADER_LEN + NONCE_LEN + sealed.len());
        out.extend_from_slice(&header);
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&sealed);
        Ok(out)
    }

    /// Decrypts a file read from `logical`. Any change to the bytes, or the bytes of another
    /// path, gives an error, never wrong content.
    pub fn open(&self, logical: &str, sealed: &[u8]) -> Result<Vec<u8>, VaultError> {
        self.open_with_cap(logical, sealed, MAX_PLAIN_BYTES)
    }

    fn open_with_cap(
        &self,
        logical: &str,
        sealed: &[u8],
        cap: usize,
    ) -> Result<Vec<u8>, VaultError> {
        if sealed.len() < MAGIC.len() || sealed[..MAGIC.len()] != MAGIC {
            return Err(if MAGIC.starts_with(sealed) {
                VaultError::Truncated
            } else {
                VaultError::NotVault
            });
        }
        if sealed.len() < MIN_SEALED_LEN {
            return Err(VaultError::Truncated);
        }
        let (header, rest) = sealed.split_at(HEADER_LEN);
        if header[4] != FORMAT_VERSION {
            return Err(VaultError::UnsupportedVersion(header[4]));
        }
        let flags = header[5];
        if flags & !FLAG_DEFLATE != 0 {
            return Err(VaultError::UnknownFlags(flags));
        }
        let id = KeyId([header[6], header[7], header[8], header[9]]);
        let cipher = self.content.get(&id).ok_or(VaultError::UnknownKey(id))?;
        let (nonce, body) = rest.split_at(NONCE_LEN);
        let nonce: [u8; NONCE_LEN] = nonce.try_into().expect("nonce length");
        let aad = associated_data(header, logical);
        let plain = cipher
            .decrypt(
                &XNonce::from(nonce),
                Payload {
                    msg: body,
                    aad: &aad,
                },
            )
            .map_err(|_| VaultError::Tampered)?;
        if flags & FLAG_DEFLATE == 0 {
            return Ok(plain);
        }
        let mut out = Vec::with_capacity(plain.len() * 4);
        flate2::read::DeflateDecoder::new(plain.as_slice())
            .take(cap as u64 + 1)
            .read_to_end(&mut out)
            // Authenticated, so only a writer with the key made this: still refuse, never panic.
            .map_err(|_| VaultError::Tampered)?;
        if out.len() > cap {
            return Err(VaultError::TooLarge);
        }
        Ok(out)
    }

    /// The physical name (`<base32>.mwk`) of the logical file `name` in the folder `parent`
    /// (logical, forward slashes, `""` for the data root).
    pub fn encrypt_name(&self, parent: &str, name: &str) -> Result<String, VaultError> {
        check_name(name)?;
        let mut siv = Aes256Siv::new_from_slice(&self.names[..]).expect("64-byte key");
        let sealed = siv
            .encrypt([parent.as_bytes()], name.as_bytes())
            .map_err(|_| VaultError::BadName(name.to_owned()))?;
        Ok(format!("{}.{EXTENSION}", base32::encode(&sealed)))
    }

    /// The logical name behind a physical name in `parent`. A name that is not
    /// `<base32>[suffix].mwk`, or that does not authenticate for this folder, is
    /// [`VaultError::BadName`].
    pub fn decrypt_name(&self, parent: &str, physical: &str) -> Result<DecodedName, VaultError> {
        let bad = || VaultError::BadName(physical.to_owned());
        let stem = physical
            .len()
            .checked_sub(EXTENSION.len() + 1)
            .and_then(|i| {
                let (stem, ext) = physical.split_at_checked(i)?;
                ext.strip_prefix('.')
                    .filter(|e| e.eq_ignore_ascii_case(EXTENSION))
                    .map(|_| stem)
            })
            .ok_or_else(bad)?;
        let end = stem
            .find(|c: char| !base32::is_alphabet(c))
            .unwrap_or(stem.len());
        let (encoded, suffix) = stem.split_at(end);
        let sealed = base32::decode(encoded).ok_or_else(bad)?;
        let mut siv = Aes256Siv::new_from_slice(&self.names[..]).expect("64-byte key");
        let plain = siv
            .decrypt([parent.as_bytes()], &sealed)
            .map_err(|_| bad())?;
        let name = String::from_utf8(plain).map_err(|_| bad())?;
        check_name(&name).map_err(|_| bad())?;
        Ok(DecodedName {
            name,
            conflict: (!suffix.is_empty()).then(|| suffix.to_owned()),
        })
    }
}

fn header(flags: u8, id: KeyId) -> [u8; HEADER_LEN] {
    let mut h = [0u8; HEADER_LEN];
    h[..4].copy_from_slice(&MAGIC);
    h[4] = FORMAT_VERSION;
    h[5] = flags;
    h[6..].copy_from_slice(&id.0);
    h
}

fn associated_data(header: &[u8], logical: &str) -> Vec<u8> {
    let mut aad = Vec::with_capacity(header.len() + logical.len());
    aad.extend_from_slice(header);
    aad.extend_from_slice(logical.as_bytes());
    aad
}

fn check_name(name: &str) -> Result<(), VaultError> {
    if name.len() > MAX_NAME_BYTES {
        return Err(VaultError::NameTooLong(name.len()));
    }
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', '\0']) {
        return Err(VaultError::BadName(name.to_owned()));
    }
    Ok(())
}

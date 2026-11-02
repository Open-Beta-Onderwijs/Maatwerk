// SPDX-License-Identifier: AGPL-3.0-or-later

//! PIN login (Step 7b): Argon2id hashes of each teacher's PIN and of the admin's single-use
//! recovery codes, stored in `gebruikers/<id>.json` as `pinHash` and `recoveryCodeHashes`. An
//! absent `pinHash` means "no PIN yet": that user sets one at the next login.
//!
//! The PIN guards the shared PC, not the files (anyone with write access to the folder can edit
//! them). [`Auth`] keeps who logged in on this machine, so the admin-only operations (resetting
//! a teacher's PIN) do not trust the UI, and a growing delay per wrong attempt (local, in
//! memory: a restart clears it, which takes longer than the first delays anyway).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use argon2::Argon2;
use argon2::password_hash::rand_core::{OsRng, RngCore};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use serde_json::{Map, Value};

use crate::error::{Error, Result};
use crate::paths::RelPath;
use crate::storage::{Storage, stamp_meta};

/// PIN length in digits.
pub const PIN_MIN: usize = 4;
pub const PIN_MAX: usize = 8;
/// Recovery codes made at the admin's PIN setup.
pub const RECOVERY_CODES: usize = 10;
/// Characters of a recovery code: no `0/O`, `1/I/L` to misread.
const CODE_ALPHABET: &[u8] = b"23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LEN: usize = 8;
/// The longest wait after wrong attempts.
const MAX_DELAY: Duration = Duration::from_secs(60);

pub const PIN_FIELD: &str = "pinHash";
pub const RECOVERY_FIELD: &str = "recoveryCodeHashes";

fn invalid(message: &str) -> Error {
    Error::InvalidArgument {
        message: message.to_owned(),
    }
}

/// 4-8 digits, nothing else.
pub fn check_pin_format(pin: &str) -> Result<()> {
    if (PIN_MIN..=PIN_MAX).contains(&pin.len()) && pin.bytes().all(|b| b.is_ascii_digit()) {
        Ok(())
    } else {
        Err(invalid("Een pincode heeft 4 tot 8 cijfers."))
    }
}

/// Argon2id (default parameters) with a random salt, as a PHC string.
pub fn hash_secret(secret: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(secret.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| invalid(&format!("Pincode versleutelen mislukt: {e}")))
}

/// False also for a hash that does not parse.
pub fn verify_secret(secret: &str, phc: &str) -> bool {
    PasswordHash::new(phc).is_ok_and(|h| {
        Argon2::default()
            .verify_password(secret.as_bytes(), &h)
            .is_ok()
    })
}

/// Ten fresh codes, `ABCD-EFGH` (40 random bits each).
pub fn new_recovery_codes() -> Vec<String> {
    (0..RECOVERY_CODES)
        .map(|_| {
            let mut code = String::with_capacity(CODE_LEN + 1);
            for i in 0..CODE_LEN {
                if i == CODE_LEN / 2 {
                    code.push('-');
                }
                // Rejection sampling keeps every character equally likely.
                let c = loop {
                    let b = (OsRng.next_u32() & 0xff) as usize;
                    if b < 256 - 256 % CODE_ALPHABET.len() {
                        break CODE_ALPHABET[b % CODE_ALPHABET.len()];
                    }
                };
                code.push(c as char);
            }
            code
        })
        .collect()
}

/// What was typed, compared without dashes, spaces and case.
fn normalise_code(code: &str) -> String {
    code.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

/// `ABCDEFGH` -> `ABCD-EFGH`, the form that is hashed.
fn canonical_code(code: &str) -> String {
    let n = normalise_code(code);
    if n.len() == CODE_LEN {
        format!("{}-{}", &n[..CODE_LEN / 2], &n[CODE_LEN / 2..])
    } else {
        n
    }
}

/// The wait after `failures` wrong attempts in a row: none after the first, then 2, 4, 8 ...
/// seconds, at most a minute.
pub fn delay_after(failures: u32) -> Duration {
    if failures < 2 {
        Duration::ZERO
    } else {
        Duration::from_secs(1u64 << (failures - 1).min(6)).min(MAX_DELAY)
    }
}

/// Outcome of a PIN or recovery code check.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Check {
    Ok,
    /// Wrong; the next attempt is allowed after `retry_after`.
    Wrong {
        retry_after: Duration,
    },
    /// Too soon after a wrong attempt: not checked.
    Wait {
        retry_after: Duration,
    },
    /// The user has no PIN yet (sets one first).
    NoPin,
}

/// A PIN that was set, with the user record as written. `recovery_codes` is set only when new
/// codes were made (admin's first PIN): shown once, never stored in plain text.
#[derive(Debug, Clone)]
pub struct PinSet {
    pub user: Value,
    pub recovery_codes: Option<Vec<String>>,
}

#[derive(Debug, Default, Clone, Copy)]
struct Failures {
    count: u32,
    last: Option<Instant>,
}

/// Login state of this app instance.
#[derive(Debug, Default)]
pub struct Auth {
    failures: Mutex<HashMap<String, Failures>>,
    session: Mutex<Option<String>>,
}

pub fn user_path(user_id: &str) -> Result<RelPath> {
    let ok = !user_id.is_empty()
        && user_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !ok {
        return Err(Error::InvalidPath {
            path: user_id.to_owned(),
            reason: "not a user id",
        });
    }
    RelPath::parse(&format!("gebruikers/{user_id}.json"))
}

fn read_user(storage: &Storage, user_id: &str) -> Result<Map<String, Value>> {
    let rel = user_path(user_id)?;
    match storage.read_json(&rel)? {
        Some(Value::Object(user)) => Ok(user),
        _ => Err(Error::NotFound {
            path: rel.to_string(),
        }),
    }
}

fn is_admin(user: &Map<String, Value>) -> bool {
    user.get("isAdmin") == Some(&Value::Bool(true))
}

fn is_active(user: &Map<String, Value>) -> bool {
    user.get("actief") != Some(&Value::Bool(false))
}

fn pin_hash(user: &Map<String, Value>) -> Option<&str> {
    user.get(PIN_FIELD)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
}

impl Auth {
    pub fn new() -> Auth {
        Auth::default()
    }

    /// The user logged in on this machine, if any.
    pub fn session(&self) -> Option<String> {
        self.session
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    pub fn logout(&self) {
        *self.session.lock().unwrap_or_else(|p| p.into_inner()) = None;
    }

    fn login(&self, user_id: &str) {
        *self.session.lock().unwrap_or_else(|p| p.into_inner()) = Some(user_id.to_owned());
    }

    /// Checks `secret` against what `check` finds, with the per-key delay. The lock is held
    /// throughout, so parallel attempts cannot skip the wait (review 7b m2); checks of other
    /// users wait for one Argon2 verification at most.
    fn throttled(&self, key: &str, now: Instant, check: impl FnOnce() -> bool) -> Check {
        let mut failures = self.failures.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(f) = failures.get(key)
            && let Some(last) = f.last
        {
            let until = last + delay_after(f.count);
            if until > now {
                return Check::Wait {
                    retry_after: until - now,
                };
            }
        }
        if check() {
            failures.remove(key);
            return Check::Ok;
        }
        let f = failures.entry(key.to_owned()).or_default();
        f.count += 1;
        f.last = Some(now);
        Check::Wrong {
            retry_after: delay_after(f.count),
        }
    }

    /// Login: checks the user's PIN; on success the user is logged in on this machine. A
    /// deactivated user cannot log in.
    pub fn verify_pin(
        &self,
        storage: &Storage,
        user_id: &str,
        pin: &str,
        now: Instant,
    ) -> Result<Check> {
        let user = read_user(storage, user_id)?;
        if !is_active(&user) {
            return Err(invalid("Deze gebruiker is gedeactiveerd."));
        }
        let Some(hash) = pin_hash(&user) else {
            return Ok(Check::NoPin);
        };
        let result = self.throttled(&format!("pin:{user_id}"), now, || verify_secret(pin, hash));
        if result == Check::Ok {
            self.login(user_id);
        }
        Ok(result)
    }

    /// First login (or after a reset): sets the PIN of a user who has none and logs them in.
    /// The admin also gets fresh recovery codes. Refused when a PIN exists by then (someone set
    /// it on another PC meanwhile).
    pub fn set_first_pin(
        &self,
        storage: &Storage,
        user_id: &str,
        pin: &str,
        at: SystemTime,
    ) -> Result<PinSet> {
        check_pin_format(pin)?;
        let user = read_user(storage, user_id)?;
        if !is_active(&user) {
            return Err(invalid("Deze gebruiker is gedeactiveerd."));
        }
        let pin_hash_new = hash_secret(pin)?;
        let codes = is_admin(&user).then(new_recovery_codes);
        let code_hashes = match &codes {
            Some(codes) => Some(
                codes
                    .iter()
                    .map(|c| hash_secret(c))
                    .collect::<Result<Vec<_>>>()?,
            ),
            None => None,
        };
        let written = self.write_user(storage, user_id, at, |user| {
            if pin_hash(user).is_some() {
                return Err(invalid(
                    "Er is intussen al een pincode ingesteld. Log in met die pincode.",
                ));
            }
            user.insert(PIN_FIELD.into(), Value::String(pin_hash_new.clone()));
            if let Some(hashes) = &code_hashes {
                user.insert(RECOVERY_FIELD.into(), Value::from(hashes.clone()));
            }
            Ok(())
        })?;
        self.login(user_id);
        Ok(PinSet {
            user: written,
            recovery_codes: codes,
        })
    }

    /// The logged-in user changes their own PIN, confirming the current one (throttled like a
    /// login).
    pub fn change_pin(
        &self,
        storage: &Storage,
        current: &str,
        new_pin: &str,
        now: Instant,
        at: SystemTime,
    ) -> Result<(Check, Option<Value>)> {
        check_pin_format(new_pin)?;
        let user_id = self.session().ok_or_else(|| invalid("Niet ingelogd."))?;
        let check = self.verify_pin(storage, &user_id, current, now)?;
        if check != Check::Ok {
            return Ok((check, None));
        }
        let hash = hash_secret(new_pin)?;
        let written = self.write_user(storage, &user_id, at, |user| {
            user.insert(PIN_FIELD.into(), Value::String(hash.clone()));
            Ok(())
        })?;
        Ok((Check::Ok, Some(written)))
    }

    /// The logged-in admin (active, re-read from disk), or an error for anyone else.
    pub fn require_admin(&self, storage: &Storage) -> Result<String> {
        let id = self.session().ok_or_else(|| invalid("Niet ingelogd."))?;
        let user = read_user(storage, &id)?;
        if is_admin(&user) && is_active(&user) {
            Ok(id)
        } else {
            Err(invalid("Alleen de beheerder mag dit."))
        }
    }

    /// Admin only: removes a teacher's PIN; they set a new one at their next login.
    pub fn reset_pin(&self, storage: &Storage, target: &str, at: SystemTime) -> Result<Value> {
        let admin = self.require_admin(storage)?;
        if admin == target {
            return Err(invalid("Wijzig je eigen pincode via je profiel."));
        }
        self.write_user(storage, target, at, |user| {
            user.remove(PIN_FIELD);
            Ok(())
        })
    }

    /// "Pincode vergeten": the admin logs in with an unused recovery code (which is used up)
    /// and sets a new PIN at once. The other codes stay valid.
    pub fn recover(
        &self,
        storage: &Storage,
        user_id: &str,
        code: &str,
        new_pin: &str,
        now: Instant,
        at: SystemTime,
    ) -> Result<(Check, Option<Value>)> {
        check_pin_format(new_pin)?;
        let user = read_user(storage, user_id)?;
        if !is_admin(&user) {
            return Err(invalid("Alleen de beheerder heeft herstelcodes."));
        }
        if !is_active(&user) {
            return Err(invalid("Deze gebruiker is gedeactiveerd."));
        }
        let hashes: Vec<String> = user
            .get(RECOVERY_FIELD)
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        let code = canonical_code(code);
        let mut used = None;
        let check = self.throttled(&format!("recover:{user_id}"), now, || {
            used = hashes.iter().find(|h| verify_secret(&code, h)).cloned();
            used.is_some()
        });
        let Some(used) = used else {
            return Ok((check, None));
        };
        let pin = hash_secret(new_pin)?;
        let written = self.write_user(storage, user_id, at, |user| {
            let codes = user.get_mut(RECOVERY_FIELD).and_then(Value::as_array_mut);
            let Some(codes) = codes.filter(|c| c.iter().any(|h| h.as_str() == Some(&used))) else {
                // Used up on another PC in the meantime.
                return Err(invalid("Deze herstelcode is al gebruikt."));
            };
            codes.retain(|h| h.as_str() != Some(&used));
            user.insert(PIN_FIELD.into(), Value::String(pin.clone()));
            Ok(())
        })?;
        self.login(user_id);
        Ok((Check::Ok, Some(written)))
    }

    /// Admin only, confirming the PIN: replaces all recovery codes with ten new ones.
    pub fn renew_recovery_codes(
        &self,
        storage: &Storage,
        pin: &str,
        now: Instant,
        at: SystemTime,
    ) -> Result<(Check, Option<PinSet>)> {
        let admin = self.require_admin(storage)?;
        let check = self.verify_pin(storage, &admin, pin, now)?;
        if check != Check::Ok {
            return Ok((check, None));
        }
        let codes = new_recovery_codes();
        let hashes = codes
            .iter()
            .map(|c| hash_secret(c))
            .collect::<Result<Vec<_>>>()?;
        let written = self.write_user(storage, &admin, at, |user| {
            user.insert(RECOVERY_FIELD.into(), Value::from(hashes.clone()));
            Ok(())
        })?;
        Ok((
            Check::Ok,
            Some(PinSet {
                user: written,
                recovery_codes: Some(codes),
            }),
        ))
    }

    /// Read-modify-write of a user file with a new `_meta` (rev + 1, `updatedBy` = the user
    /// logged in, else the user itself).
    fn write_user(
        &self,
        storage: &Storage,
        user_id: &str,
        at: SystemTime,
        mut change: impl FnMut(&mut Map<String, Value>) -> Result<()>,
    ) -> Result<Value> {
        let rel = user_path(user_id)?;
        let by = self.session().unwrap_or_else(|| user_id.to_owned());
        storage.update(
            &rel,
            || Value::Null,
            |current, on_disk| {
                let Value::Object(mut user) = current else {
                    return Err(Error::NotFound {
                        path: rel.to_string(),
                    });
                };
                change(&mut user)?;
                Ok(stamp_meta(user, on_disk, Some(&by), at))
            },
        )
    }
}

/// `maatwerk-cli admin reset-pin`: removes the PIN and the recovery codes of every admin, so
/// the next admin login sets a new PIN (and gets new codes). Returns the admin ids.
pub fn reset_admin_pins(storage: &Storage, at: SystemTime) -> Result<Vec<String>> {
    let dir = RelPath::parse("gebruikers")?;
    let mut reset = Vec::new();
    for user in storage.read_all_json(&dir)? {
        let Value::Object(user) = user else { continue };
        let Some(id) = user.get("id").and_then(Value::as_str) else {
            continue;
        };
        if !is_admin(&user) {
            continue;
        }
        let rel = user_path(id)?;
        storage.update(
            &rel,
            || Value::Null,
            |current, on_disk| {
                let Value::Object(mut user) = current else {
                    return Err(Error::NotFound {
                        path: rel.to_string(),
                    });
                };
                user.remove(PIN_FIELD);
                user.remove(RECOVERY_FIELD);
                Ok(stamp_meta(user, on_disk, None, at))
            },
        )?;
        reset.push(id.to_owned());
    }
    Ok(reset)
}

#[cfg(test)]
mod tests;

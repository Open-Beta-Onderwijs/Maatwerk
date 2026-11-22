// SPDX-License-Identifier: AGPL-3.0-or-later

//! "Kopieer naar…" (step 36, PLAN-2 decision 82): a gast copies an opdracht to another sectie.
//! The gast picks the target vak and a teacher of it, who types their PIN here; the copy is
//! written as that teacher, for this one operation only (the gast itself writes nothing). The
//! copy's `vakken` is the target vak; its linked observaties (of the source vak) are dropped.

use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value};

use crate::auth::{Auth, Check, user_path};
use crate::error::{Error, Result};
use crate::opdracht_images;
use crate::paths::RelPath;
use crate::rights::Role;
use crate::storage::{Expect, Storage, stamp_meta};

/// What "Kopieer naar…" did.
#[derive(Debug, Clone)]
pub struct Copied {
    /// The target teacher's PIN check; anything but `Ok` copied nothing.
    pub check: Check,
    /// The new `opdracht.json`, when copied.
    pub opdracht: Option<Value>,
    /// How many linked observaties the copy left out.
    pub dropped_observaties: usize,
}

fn invalid(message: &str) -> Error {
    Error::InvalidArgument {
        message: message.to_owned(),
    }
}

fn opdracht_json(id: &str) -> Result<RelPath> {
    opdracht_images::folder(id)?.join("opdracht.json")
}

/// The teacher must be active, not the admin, and teach `vak`.
fn check_teacher(storage: &Storage, teacher_id: &str, vak: &str) -> Result<()> {
    let user = match storage.read_json(&user_path(teacher_id)?)? {
        Some(Value::Object(user)) => user,
        _ => return Err(invalid("Deze docent bestaat niet.")),
    };
    let teaches = user.get("actief") != Some(&Value::Bool(false))
        && user.get("isAdmin") != Some(&Value::Bool(true))
        && user
            .get("vakken")
            .and_then(Value::as_array)
            .is_some_and(|v| v.iter().any(|x| x.as_str() == Some(vak)));
    if teaches {
        Ok(())
    } else {
        Err(invalid("Kies een actieve docent van dat vak."))
    }
}

/// Copies opdracht `from_id` to sectie `vak` as `teacher_id`, after that teacher's PIN (throttled
/// like a login). Only a gast session may do this; teachers use Kopiëren.
#[allow(clippy::too_many_arguments)]
pub fn copy_opdracht_to_sectie(
    storage: &Storage,
    auth: &Auth,
    from_id: &str,
    vak: &str,
    teacher_id: &str,
    pin: &str,
    now: Instant,
    at: SystemTime,
) -> Result<Copied> {
    let Some(Role::Gast(own)) = auth.current().map(|s| s.role) else {
        return Err(invalid(
            "Alleen een gast kopieert een opdracht naar een andere sectie.",
        ));
    };
    if own == vak {
        return Err(invalid("Kies een andere sectie dan die van de gast."));
    }
    if Role::parse(&format!("bestuur:{vak}")).is_err() {
        return Err(invalid("Onbekend vak."));
    }
    check_teacher(storage, teacher_id, vak)?;
    let check = auth.confirm_pin(storage, teacher_id, pin, now)?;
    if check != Check::Ok {
        return Ok(Copied {
            check,
            opdracht: None,
            dropped_observaties: 0,
        });
    }
    let Some(Value::Object(source)) = storage.read_json(&opdracht_json(from_id)?)? else {
        return Err(invalid("Opdracht niet gevonden."));
    };
    let ms = at.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis());
    let new_id = format!("opdracht_{ms}");
    let dropped = source
        .get("observaties")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    let mut copy: Map<String, Value> = source;
    copy.remove("_meta");
    copy.remove("typFile");
    copy.insert("id".into(), Value::String(new_id.clone()));
    copy.insert("vakken".into(), Value::from(vec![vak]));
    copy.insert("observaties".into(), Value::Array(vec![]));
    let copy = stamp_meta(copy, None, Some(teacher_id), at);
    // `opdracht.json` first claims the id (review m7); a failure after it removes the folder.
    storage.as_teacher(|| {
        storage.write_json(&opdracht_json(&new_id)?, &copy, Expect::Missing)?;
        if let Err(e) = opdracht_images::copy(storage, from_id, &new_id) {
            let _ = opdracht_images::delete_all(storage, &new_id);
            return Err(e);
        }
        Ok(())
    })?;
    tracing::info!("opdracht {from_id} copied to {vak} as {new_id} by {teacher_id} (gast)");
    Ok(Copied {
        check,
        opdracht: Some(copy),
        dropped_observaties: dropped,
    })
}

#[cfg(test)]
mod tests;

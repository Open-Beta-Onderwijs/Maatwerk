// SPDX-License-Identifier: AGPL-3.0-or-later

//! Maatwerk core. Pure Rust; must never depend on `tauri`.
//!
//! The modules from PLAN.md section 4 (paths, storage, watcher, model,
//! migrate, typst_svc, pdf_merge, assets) are added from Step 4 onward.

/// Version of the core crate, shown in the UI for diagnostics.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Bootstrap round-trip check: builds the greeting the hello-world UI shows.
pub fn greeting(name: &str) -> String {
    let name = name.trim();
    if name.is_empty() {
        "Hallo!".to_owned()
    } else {
        format!("Hallo, {name}!")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greets_by_trimmed_name() {
        assert_eq!(greeting("  Jan "), "Hallo, Jan!");
    }

    #[test]
    fn greets_without_name() {
        assert_eq!(greeting("   "), "Hallo!");
    }

    #[test]
    fn keeps_non_ascii_names() {
        assert_eq!(greeting("Zoë"), "Hallo, Zoë!");
    }
}

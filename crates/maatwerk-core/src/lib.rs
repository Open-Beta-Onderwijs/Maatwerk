// SPDX-License-Identifier: AGPL-3.0-or-later

//! Maatwerk core. Pure Rust; must never depend on `tauri`.
//!
//! Modules follow ADR-0002 section 1; model, migrate, typst_svc, pdf_merge and assets
//! are added in later steps.

pub mod error;
pub mod jsonfmt;
pub mod paths;
pub mod presence;
pub mod storage;
pub mod watcher;

pub use error::{Error, Result};

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

// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fonts for every compile: the embedded template fonts first (as the reference's
//! `--font-path include/fonts`), then system fonts (emoji come from Segoe UI Emoji on Windows,
//! `typst-contract.md` 7.1), then Typst's own embedded fonts (Libertinus Serif, New Computer
//! Modern, DejaVu Sans Mono). System fonts are searched once per process.

use std::sync::{Arc, OnceLock};

use typst::foundations::Bytes;
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst_kit::fonts::{FontSearcher, FontSlot};

use crate::assets;

/// The font book and the fonts behind it. Cheap to share between compiles and threads.
pub struct FontStore {
    book: LazyHash<FontBook>,
    slots: Vec<Slot>,
}

enum Slot {
    Embedded(Font),
    /// System or Typst-embedded font, loaded on first use.
    Kit(FontSlot),
}

impl FontStore {
    /// The process-wide store with system fonts. The first call searches the system fonts
    /// (a few hundred ms); later calls return the same store.
    pub fn shared() -> Arc<FontStore> {
        static SHARED: OnceLock<Arc<FontStore>> = OnceLock::new();
        SHARED
            .get_or_init(|| Arc::new(FontStore::new(true)))
            .clone()
    }

    /// A new store; `system_fonts: false` gives a machine-independent set (tests, headless use).
    pub fn new(system_fonts: bool) -> FontStore {
        let mut book = FontBook::new();
        let mut slots = Vec::new();
        for data in assets::FONTS {
            for font in Font::iter(Bytes::new(*data)) {
                book.push(font.info().clone());
                slots.push(Slot::Embedded(font));
            }
        }
        let kit = FontSearcher::new()
            .include_system_fonts(system_fonts)
            .include_embedded_fonts(true)
            .search();
        for (index, slot) in kit.fonts.into_iter().enumerate() {
            if let Some(info) = kit.book.info(index) {
                book.push(info.clone());
                slots.push(Slot::Kit(slot));
            }
        }
        FontStore {
            book: LazyHash::new(book),
            slots,
        }
    }

    pub fn book(&self) -> &LazyHash<FontBook> {
        &self.book
    }

    pub fn font(&self, index: usize) -> Option<Font> {
        match self.slots.get(index)? {
            Slot::Embedded(font) => Some(font.clone()),
            Slot::Kit(slot) => slot.get(),
        }
    }

    /// Number of font faces (for diagnostics and tests).
    pub fn len(&self) -> usize {
        self.slots.len()
    }

    pub fn is_empty(&self) -> bool {
        self.slots.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use typst::text::{FontStyle, FontVariant, FontWeight};

    use super::*;

    fn family_index(store: &FontStore, family: &str, variant: FontVariant) -> Option<usize> {
        store.book().select(family, variant)
    }

    #[test]
    fn template_fonts_come_first_and_resolve() {
        let store = FontStore::new(false);
        let regular = FontVariant::default();
        let serif = family_index(&store, "source serif 4", regular).expect("Source Serif 4");
        assert!(
            serif < assets::FONTS.len(),
            "embedded template fonts are first"
        );
        let semibold = FontVariant {
            weight: FontWeight::SEMIBOLD,
            ..regular
        };
        let italic = FontVariant {
            style: FontStyle::Italic,
            ..regular
        };
        for variant in [semibold, italic] {
            let i = family_index(&store, "source serif 4", variant).unwrap();
            assert_eq!(store.book().info(i).unwrap().variant, variant);
        }
        assert!(family_index(&store, "stix two math", regular).is_some());
        // Typst's own fonts: the rapport uses Libertinus Serif Bold for the table header glyphs.
        assert!(family_index(&store, "libertinus serif", regular).is_some());
        assert!(store.font(serif).is_some());
    }
}

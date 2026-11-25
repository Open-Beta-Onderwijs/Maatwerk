// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fonts for every compile: the embedded fonts first (the template fonts, as the reference's
//! `--font-path include/fonts`, and Noto Color Emoji, which wins over a system emoji font such
//! as Segoe UI Emoji: quirk T2), then Typst's own embedded fonts (Libertinus Serif, New Computer
//! Modern, DejaVu Sans Mono), then system fonts. A family in both wins by its first face, so an
//! installed Libertinus Serif does not replace Typst's copy (review 5a n8): the app draws what
//! the goldens (no system fonts) show. System fonts are searched once per process.

use std::sync::{Arc, OnceLock};

use typst::foundations::Bytes;
use typst::text::{Coverage, Font, FontBook, FontInfo};
use typst::utils::LazyHash;
use typst_kit::fonts::FontStore as KitStore;

use crate::assets;

/// The font book and the fonts behind it. Cheap to share between compiles and threads.
pub struct FontStore {
    kit: KitStore,
    len: usize,
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
        let mut kit = KitStore::new();
        let mut len = 0;
        let mut emoji = Vec::new();
        for (_, data) in assets::FONTS {
            for font in Font::iter(Bytes::new(*data)) {
                if font.info().family == EMOJI_FAMILY {
                    emoji.extend(font.info().coverage.iter().filter(|&c| c >= 0x80));
                }
                let info = font.info().clone();
                kit.push((font, info));
                len += 1;
            }
        }
        emoji.sort_unstable();
        // Typst's own fonts stay as they are, as in the goldens.
        for entry in typst_kit::fonts::embedded() {
            kit.push(entry);
            len += 1;
        }
        if system_fonts {
            for (path, info) in typst_kit::fonts::system() {
                kit.push((path, without_emoji(&info, &emoji)));
                len += 1;
            }
        }
        FontStore { kit, len }
    }

    pub fn book(&self) -> &LazyHash<FontBook> {
        self.kit.book()
    }

    pub fn font(&self, index: usize) -> Option<Font> {
        self.kit.font(index)
    }

    /// Number of font faces (for diagnostics and tests).
    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
}

/// Family of the bundled emoji font in `assets::FONTS`.
const EMOJI_FAMILY: &str = "Noto Color Emoji";

/// `info` without the code points of the bundled emoji font (`emoji`, sorted), so a system font
/// is never the fallback for them. Typst's fallback prefers the shorter family name on a tie
/// (`FontBook::find_best_variant`), so Segoe UI Emoji or Segoe UI Symbol would otherwise win
/// over Noto Color Emoji and emoji would differ per machine (quirk T2). A system font chosen by
/// name still draws them: selection by family does not look at the coverage.
fn without_emoji(info: &FontInfo, emoji: &[u32]) -> FontInfo {
    let bundled = |c: &u32| emoji.binary_search(c).is_ok();
    if !info.coverage.iter().any(|c| bundled(&c)) {
        return info.clone();
    }
    FontInfo {
        coverage: Coverage::from_vec(info.coverage.iter().filter(|c| !bundled(c)).collect()),
        ..info.clone()
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

    #[test]
    fn emoji_come_from_the_bundled_font_even_with_system_fonts() {
        // Segoe UI Emoji (Windows) or Apple Color Emoji also cover them; the bundled font must
        // win so every machine renders the same (quirk T2).
        let store = FontStore::new(true);
        let book = store.book();
        for weight in [FontWeight::REGULAR, FontWeight::BOLD] {
            let variant = FontVariant {
                weight,
                ..FontVariant::default()
            };
            let serif = book.select("source serif 4", variant).unwrap();
            for emoji in ["🥈", "👑", "📏", "❌", "👩‍🔬"] {
                let index = book
                    .select_fallback(book.info(serif), variant, emoji)
                    .unwrap_or_else(|| panic!("no font for {emoji}"));
                assert_eq!(
                    book.info(index).unwrap().family,
                    "Noto Color Emoji",
                    "{emoji} ({weight:?})"
                );
                assert!(index < assets::FONTS.len(), "{emoji}: embedded copy");
            }
        }
    }

    #[test]
    fn review_5a_n8_typst_fonts_come_before_system_fonts() {
        // The same faces with and without system fonts: an installed copy of a Typst font
        // family never shadows the one the goldens were drawn with.
        let bare = FontStore::new(false);
        let system = FontStore::new(true);
        for family in [
            "libertinus serif",
            "new computer modern",
            "dejavu sans mono",
        ] {
            for weight in [FontWeight::REGULAR, FontWeight::BOLD] {
                let variant = FontVariant {
                    weight,
                    ..FontVariant::default()
                };
                let want = family_index(&bare, family, variant).expect(family);
                assert_eq!(
                    family_index(&system, family, variant),
                    Some(want),
                    "{family}"
                );
                assert_eq!(
                    system.font(want).unwrap().data(),
                    bare.font(want).unwrap().data(),
                    "{family}"
                );
            }
        }
    }
}

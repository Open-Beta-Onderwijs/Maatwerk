// SPDX-License-Identifier: AGPL-3.0-or-later

//! Files compiled into the binary (ADR-0002 section 1): Typst templates, the vendored Typst
//! packages and the fonts the templates use. Licences: `THIRD_PARTY_LICENSES.md`.

/// The rapport template (the reference's `include/templates/rtti_export.typ`).
pub const RAPPORT_TYP: &str = include_str!("../assets/templates/rapport.typ");

/// Entry point of the rapport World: imports `rapport.typ` and reads `data.json`.
pub const RAPPORT_MAIN_TYP: &str = include_str!("../assets/templates/rapport-main.typ");

/// The PO rapport template (step 24); imports the shared parts of `rapport.typ`.
pub const RAPPORT_PO_TYP: &str = include_str!("../assets/templates/rapport-po.typ");

/// Entry point of the PO rapport World: imports `rapport-po.typ` and reads `data.json`.
pub const RAPPORT_PO_MAIN_TYP: &str = include_str!("../assets/templates/rapport-po-main.typ");

/// Entry point of an opdracht (`main.typ`): the old generated wrapper, driven by `sys.inputs`.
pub const OPDRACHT_MAIN_TYP: &str = include_str!("../assets/templates/opdracht-main.typ");

/// The opdracht library (`include/templates/lib.typ`), with markers renamed to `__maatwerk_*`.
pub const LIB_TYP: &str = include_str!("../assets/templates/lib.typ");

/// Starting point for a new opdracht (`include/templates/base_assignment.typ`); since 0.3.1 with
/// `setup_extra(body)` as a show rule (quirk T31).
pub const BASE_ASSIGNMENT_TYP: &str = include_str!("../assets/templates/base_assignment.typ");

/// A bundled file that every opdracht folder has its own copy of (ADR-0002 5a). Teachers may
/// change their copy; the version line (`// maatwerk-lib 1`) and the hashes of every released
/// version tell an unmodified old copy (update silently) from a changed one (never overwrite).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectFile {
    /// `lib.typ`, version line `// maatwerk-lib <n>`.
    Lib,
    /// `main.typ`, version line `// maatwerk-main <n>`.
    Main,
}

impl ProjectFile {
    /// The bundled text of the current version.
    pub fn bundled(self) -> &'static str {
        match self {
            ProjectFile::Lib => LIB_TYP,
            ProjectFile::Main => OPDRACHT_MAIN_TYP,
        }
    }

    /// Every released version with the SHA-1 of its normalised text, oldest first. Add a row
    /// (never change one) when the bundled file changes; a test checks the last row. The hashes
    /// were recomputed when the normalisation changed (step 39b, backlog 5b n4); a test checks
    /// every row against the released text in `tests/fixtures/project-files`.
    fn releases(self) -> &'static [(u32, &'static str)] {
        match self {
            ProjectFile::Lib => &[
                (1, "280515f2dabec73a64857797a52467b6361f661e"),
                (2, "0d0e3803d2a16e68e797ce328a96e588298dafd0"),
                // 3: vragen after an opgave are outside it (opgave 0 in the marker, review
                // 8b n1), 0.30.0.
                (3, "126387fda018faca15cb52b817490f160ce22179"),
            ],
            ProjectFile::Main => &[
                (1, "48dbdd9d89bf18c5823434b3ebdee24eabf0c502"),
                // 2: `setup_extra(body)` as a show rule (quirk T31) and no cursor marker
                // (review 8b n4), 0.3.1.
                (2, "b014d50a08eff3ed6ee81c8bcc5adf2d15212b8e"),
                // 3: mode "plain" (an opdracht without the student block, printed from the
                // Opdrachten tab), 0.23.1.
                (3, "baa86708af3fb718369bae988d5c6b8f975ebdf3"),
            ],
        }
    }

    fn marker(self) -> &'static str {
        match self {
            ProjectFile::Lib => "// maatwerk-lib ",
            ProjectFile::Main => "// maatwerk-main ",
        }
    }

    /// The version the bundled file has now.
    pub fn current_version(self) -> u32 {
        self.releases().last().expect("at least one release").0
    }

    /// The version a copy claims in its version line (within the first lines), if any.
    pub fn version_line(self, text: &str) -> Option<u32> {
        text.lines()
            .take(5)
            .find_map(|l| l.trim().strip_prefix(self.marker()))
            .and_then(|v| v.trim().parse().ok())
    }

    /// `Some(version)` when `text` is exactly a released version (a BOM, line endings, spaces
    /// and tabs at line ends and trailing empty lines aside), `None` when the teacher changed it.
    pub fn released_version(self, text: &str) -> Option<u32> {
        let hash = normalised_sha1(text);
        self.releases()
            .iter()
            .find(|(_, h)| *h == hash)
            .map(|(v, _)| *v)
    }
}

/// SHA-1 (hex) of the text without a BOM, with CRLF as LF, without spaces and tabs at line ends
/// and without trailing empty lines, so a copy saved by an editor that changes only those still
/// counts as unmodified (backlog 5b n4, user 2026-11-25). None of them changes what Typst renders
/// in these code files.
fn normalised_sha1(text: &str) -> String {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let lines: Vec<&str> = text
        .split('\n')
        .map(|l| l.trim_end_matches(['\r', ' ', '\t']))
        .collect();
    let joined = lines.join("\n");
    crate::storage::hash_hex(joined.trim_end_matches('\n').as_bytes())
}

/// `(file name, bytes)` of a font in `assets/fonts/`.
macro_rules! font {
    ($name:literal) => {
        ($name, include_bytes!(concat!("../assets/fonts/", $name)))
    };
}

/// Noto Color Emoji (COLRv1, googlefonts/noto-emoji `v2026-09-24-unicode18_0`; quirk T2, OFL). One
/// copy: Typst uses it for the PDFs and the window gets it through the `maatwerk-out` scheme, so
/// emoji look the same on screen and on paper.
pub const EMOJI_FONT: &[u8] = include_bytes!("../assets/fonts/NotoColorEmoji-COLRv1.ttf");

/// Source Serif 4 (all 12 static styles, as the reference ships them), STIX Two Math and Noto
/// Color Emoji (COLRv1, googlefonts/noto-emoji `v2026-09-24-unicode18_0`; quirk T2). All OFL.
pub(crate) static FONTS: &[(&str, &[u8])] = &[
    font!("SourceSerif4-ExtraLight.otf"),
    font!("SourceSerif4-ExtraLightIt.otf"),
    font!("SourceSerif4-Light.otf"),
    font!("SourceSerif4-LightIt.otf"),
    font!("SourceSerif4-Regular.otf"),
    font!("SourceSerif4-It.otf"),
    font!("SourceSerif4-Semibold.otf"),
    font!("SourceSerif4-SemiboldIt.otf"),
    font!("SourceSerif4-Bold.otf"),
    font!("SourceSerif4-BoldIt.otf"),
    font!("SourceSerif4-Black.otf"),
    font!("SourceSerif4-BlackIt.otf"),
    font!("STIXTwoMath-Regular.otf"),
    ("NotoColorEmoji-COLRv1.ttf", EMOJI_FONT),
];

// `PACKAGE_FILES: &[(&str, &[u8])]`, sorted by path, generated by build.rs.
include!(concat!(env!("OUT_DIR"), "/packages.rs"));

/// A file of a vendored package, by `<namespace>/<name>/<version>/<path>`.
pub(crate) fn package_file(key: &str) -> Option<&'static [u8]> {
    PACKAGE_FILES
        .binary_search_by(|(path, _)| (*path).cmp(key))
        .ok()
        .map(|i| PACKAGE_FILES[i].1)
}

/// True when any file of `<namespace>/<name>/<version>` is embedded.
pub(crate) fn has_package(namespace: &str, name: &str, version: &str) -> bool {
    let prefix = format!("{namespace}/{name}/{version}/");
    PACKAGE_FILES
        .iter()
        .any(|(path, _)| path.starts_with(&prefix))
}

/// The embedded packages as `(namespace, name, version)`, sorted.
pub(crate) fn packages() -> Vec<(&'static str, &'static str, &'static str)> {
    let mut out: Vec<_> = PACKAGE_FILES
        .iter()
        .filter_map(|(path, _)| {
            let mut parts = path.splitn(4, '/');
            Some((parts.next()?, parts.next()?, parts.next()?))
        })
        .collect();
    out.dedup();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_files_are_sorted_for_binary_search() {
        assert!(PACKAGE_FILES.windows(2).all(|w| w[0].0 < w[1].0));
    }

    #[test]
    fn the_four_packages_of_adr_0002_are_embedded() {
        for (name, version, entry) in [
            ("zero", "0.7.1", "src/zero.typ"),
            ("cetz", "0.3.4", "src/lib.typ"),
            ("oxifmt", "0.2.1", "oxifmt.typ"),
            ("unify", "0.8.0", "lib.typ"),
        ] {
            assert!(package_file(&format!("preview/{name}/{version}/typst.toml")).is_some());
            assert!(package_file(&format!("preview/{name}/{version}/{entry}")).is_some());
            assert!(package_file(&format!("preview/{name}/{version}/LICENSE")).is_some());
        }
        assert!(!has_package("preview", "zero", "0.7.0"));
    }

    #[test]
    fn the_bundled_project_files_are_their_last_released_version() {
        for file in [ProjectFile::Lib, ProjectFile::Main] {
            let text = file.bundled();
            assert_eq!(
                file.releases().last().unwrap().1,
                normalised_sha1(text),
                "{file:?} changed: add a release row with a new version (and bump its version line)"
            );
            assert_eq!(
                file.version_line(text),
                Some(file.current_version()),
                "{file:?}"
            );
            assert_eq!(file.released_version(text), Some(file.current_version()));
        }
    }

    #[test]
    fn every_released_text_has_its_version() {
        let fixture = |name| -> &'static str {
            match name {
                "lib-v1" => include_str!("../tests/fixtures/project-files/lib-v1.typ"),
                "lib-v2" => include_str!("../tests/fixtures/project-files/lib-v2.typ"),
                "main-v1" => include_str!("../tests/fixtures/project-files/main-v1.typ"),
                "main-v2" => include_str!("../tests/fixtures/project-files/main-v2.typ"),
                _ => unreachable!(),
            }
        };
        for (file, version, text) in [
            (ProjectFile::Lib, 1, fixture("lib-v1")),
            (ProjectFile::Lib, 2, fixture("lib-v2")),
            (ProjectFile::Lib, 3, LIB_TYP),
            (ProjectFile::Main, 1, fixture("main-v1")),
            (ProjectFile::Main, 2, fixture("main-v2")),
            (ProjectFile::Main, 3, OPDRACHT_MAIN_TYP),
        ] {
            assert_eq!(
                file.released_version(text),
                Some(version),
                "{file:?} {version}"
            );
        }
    }

    #[test]
    fn review_5b_n4_whitespace_at_line_ends_and_the_end_is_ignored() {
        let lib = ProjectFile::Lib;
        let stripped = LIB_TYP.trim_end();
        assert_ne!(stripped, LIB_TYP);
        let spaces: String = LIB_TYP.lines().map(|l| format!("{l}  \t\r\n")).collect();
        for text in [
            stripped.to_owned(),
            format!("{LIB_TYP}\n\n"),
            spaces,
            format!("\u{feff}{}", LIB_TYP.replace('\n', "\r\n")),
        ] {
            assert_eq!(lib.released_version(&text), Some(3));
        }
        // Leading spaces and an empty line in between are a change.
        let indented = LIB_TYP.replacen("\n", "\n ", 1);
        assert_eq!(lib.released_version(&indented), None);
        let blank = LIB_TYP.replacen("\n", "\n\n", 1);
        assert_eq!(lib.released_version(&blank), None);
    }

    #[test]
    fn a_changed_copy_is_not_a_released_version() {
        let lib = ProjectFile::Lib;
        let crlf = format!("\u{feff}{}", LIB_TYP.replace('\n', "\r\n"));
        assert_eq!(lib.released_version(&crlf), Some(3));
        let v1 = include_str!("../tests/fixtures/project-files/lib-v1.typ");
        assert_eq!(lib.released_version(v1), Some(1));
        let changed = LIB_TYP.replace("size: 10.5pt", "size: 11pt");
        assert_ne!(changed, LIB_TYP);
        assert_eq!(lib.released_version(&changed), None);
        assert_eq!(lib.version_line(&changed), Some(3));
        assert_eq!(lib.version_line("#import \"x\""), None);
        assert_eq!(ProjectFile::Main.released_version(LIB_TYP), None);
    }

    #[test]
    fn templates_use_the_maatwerk_marker_names() {
        assert!(!LIB_TYP.contains("__rtti_"));
        assert!(!LIB_TYP.contains("\"rtti-vraag"));
        assert!(LIB_TYP.contains("<__maatwerk_vraag>"));
        assert!(RAPPORT_MAIN_TYP.contains("\"rapport.typ\""));
        assert!(RAPPORT_PO_MAIN_TYP.contains("\"rapport-po.typ\""));
        assert!(RAPPORT_PO_TYP.contains("\"rapport.typ\""));
    }
}

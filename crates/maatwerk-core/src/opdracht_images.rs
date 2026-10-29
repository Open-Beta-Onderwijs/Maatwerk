// SPDX-License-Identifier: AGPL-3.0-or-later

//! Opdracht images in `opdrachten/images/<opdrachtId>/` (reference `main.js:237-395`, `ipc-api.md`
//! 14-20). An opdracht refers to them as `image("images/<id>/<file>")`.

use std::cmp::Ordering;
use std::io::Cursor;
use std::time::Duration;

use base64::Engine as _;
use image::ImageFormat;
use image::imageops::FilterType;
use unicode_normalization::UnicodeNormalization;
use unicode_normalization::char::is_combining_mark;

use crate::paths::RelPath;
use crate::storage::{Expect, Storage};
use crate::{Error, Result};

/// Image types an opdracht may use (`IMAGE_EXTS`).
pub const IMAGE_EXTS: [&str; 6] = ["png", "jpg", "jpeg", "gif", "svg", "webp"];

/// Height of the editor's thumbnails (`nativeImage.resize({ height: 48 })`).
const THUMB_HEIGHT: u32 = 48;

/// One image of an opdracht.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpdrachtImage {
    /// Relative to `opdrachten/`: `images/<id>/<name>.<ext>`.
    pub file: String,
    /// The file name without extension.
    pub name: String,
    /// PNG data URL 48 px high, `None` for SVG and files that do not decode.
    pub thumb: Option<String>,
}

/// The outcome of storing an image (the reference's `{ ok, ... }` shapes).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Stored {
    /// `{ ok: true, file, name }`.
    Saved { file: String, name: String },
    /// `{ ok: false, exists: true, name }`: an image with that name exists, `overwrite` not set.
    Exists { name: String },
    /// `{ ok: false, error }` with a Dutch message for the teacher.
    Rejected { message: String },
}

/// "Remweg auto!" -> "Remweg-auto" (`cleanImageName`): NFD, combining marks removed, runs of
/// anything but `[A-Za-z0-9_-]` become `-`, `-` trimmed, at most 60 characters.
pub fn clean_image_name(name: &str) -> String {
    let mut out = String::new();
    let mut in_run = false;
    for c in name.nfd().filter(|&c| !is_combining_diacritic(c)) {
        if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
            out.push(c);
            in_run = false;
        } else if !in_run {
            out.push('-');
            in_run = true;
        }
    }
    out.trim_matches('-').chars().take(60).collect()
}

/// The reference strips U+0300-U+036F only; other combining marks become `-` like any other
/// character.
fn is_combining_diacritic(c: char) -> bool {
    ('\u{0300}'..='\u{036f}').contains(&c) && is_combining_mark(c)
}

/// `^[\w-]+$` (`opdrachtImagesDir`), else the reference's rejection.
pub fn check_opdracht_id(id: &str) -> Result<()> {
    let valid = !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if valid {
        Ok(())
    } else {
        Err(Error::InvalidArgument {
            message: "Ongeldige opdracht.".into(),
        })
    }
}

fn images_dir(id: &str) -> Result<RelPath> {
    check_opdracht_id(id)?;
    RelPath::parse(&format!("opdrachten/images/{id}"))
}

/// Lower-case extension without the dot; `""` if none.
pub fn extension_of(file: &str) -> String {
    match file.rfind('.') {
        Some(i) if i > 0 => file[i + 1..].to_ascii_lowercase(),
        _ => String::new(),
    }
}

/// The file name without its last extension (`path.parse(f).name`).
pub fn stem_of(file: &str) -> &str {
    match file.rfind('.') {
        Some(i) if i > 0 => &file[..i],
        _ => file,
    }
}

/// The images of an opdracht, sorted as `localeCompare(…, 'nl')` sorts them (`[]` if the
/// folder is missing).
pub fn list(storage: &Storage, id: &str) -> Result<Vec<OpdrachtImage>> {
    let dir = images_dir(id)?;
    let mut files: Vec<String> = storage
        .list_dir(&dir, false)?
        .into_iter()
        .filter(|f| IMAGE_EXTS.contains(&extension_of(f).as_str()))
        .collect();
    files.sort_by(|a, b| nl_compare(a, b));
    Ok(files
        .into_iter()
        .map(|f| {
            let thumb = match extension_of(&f).as_str() {
                "svg" => None,
                _ => dir
                    .join(&f)
                    .ok()
                    .and_then(|rel| storage.read_bytes(&rel).ok().flatten())
                    .and_then(|bytes| thumbnail_data_url(&bytes)),
            };
            OpdrachtImage {
                file: format!("images/{id}/{f}"),
                name: stem_of(&f).to_owned(),
                thumb,
            }
        })
        .collect())
}

/// Stores an image under a cleaned name (`storeOpdrachtImage`). An existing image with the same
/// name and any extension is replaced only with `overwrite`.
///
/// Names are compared case-insensitively, unlike the reference: on Windows `Foto.png` and
/// `foto.png` are the same file, which the reference overwrote without asking (quirk T30).
pub fn store(
    storage: &Storage,
    id: &str,
    raw_name: &str,
    raw_ext: &str,
    bytes: &[u8],
    overwrite: bool,
) -> Result<Stored> {
    let name = clean_image_name(raw_name);
    if name.is_empty() {
        return Ok(Stored::Rejected {
            message: "Geef de afbeelding een naam.".into(),
        });
    }
    let ext = raw_ext.to_lowercase();
    if !IMAGE_EXTS.contains(&ext.as_str()) {
        return Ok(Stored::Rejected {
            message: format!("Bestandstype .{ext} wordt niet ondersteund."),
        });
    }
    let dir = images_dir(id)?;
    storage.ensure_dir(&dir)?;
    let existing: Vec<String> = storage
        .list_dir(&dir, false)?
        .into_iter()
        .filter(|f| stem_of(f).eq_ignore_ascii_case(&name))
        .collect();
    if !existing.is_empty() && !overwrite {
        return Ok(Stored::Exists { name });
    }
    for f in &existing {
        storage.delete(&dir.join(f)?)?;
    }
    let file = format!("{name}.{ext}");
    storage.write_bytes(&dir.join(&file)?, bytes, Expect::Any)?;
    Ok(Stored::Saved {
        file: format!("images/{id}/{file}"),
        name,
    })
}

/// Copies every file of one opdracht's images to another (`opdracht:copyImages`). Folders inside
/// are skipped (the reference threw on them).
pub fn copy(storage: &Storage, from_id: &str, to_id: &str) -> Result<()> {
    let from = images_dir(from_id)?;
    let to = images_dir(to_id)?;
    for f in storage.list_dir(&from, false)? {
        if let Some(bytes) = storage.read_bytes(&from.join(&f)?)? {
            storage.write_bytes(&to.join(&f)?, &bytes, Expect::Any)?;
        }
    }
    Ok(())
}

/// Deletes an opdracht's images (`opdracht:deleteImages`). Returns the folder if it is still
/// there: OneDrive keeps an emptied folder locked while it syncs, so the caller retries it in
/// the background with [`remove_dir_later`]. Folders inside are left alone.
pub fn delete_all(storage: &Storage, id: &str) -> Result<Option<RelPath>> {
    let dir = images_dir(id)?;
    for f in storage.list_dir(&dir, false)? {
        storage.delete(&dir.join(&f)?)?;
    }
    match storage.remove_empty_dir(&dir) {
        Ok(_) => Ok(None),
        Err(_) => Ok(Some(dir)),
    }
}

/// Retries removing the emptied folder every 5 s, up to 24 times (~2 minutes,
/// `removeDirLater`). Blocks: run it on its own thread. Whatever is left is removed at the next
/// start by [`remove_empty_dirs`].
pub fn remove_dir_later(storage: &Storage, dir: &RelPath) {
    remove_dir_retrying(storage, dir, 24, Duration::from_secs(5));
}

fn remove_dir_retrying(storage: &Storage, dir: &RelPath, attempts: u32, interval: Duration) {
    for attempt in 1..=attempts {
        match storage.remove_empty_dir(dir) {
            Ok(_) => return,
            Err(e) if attempt == attempts => {
                tracing::warn!("could not remove {}: {e}", dir.as_str());
            }
            Err(_) => std::thread::sleep(interval),
        }
    }
}

/// Removes empty folders in `opdrachten/images/` (`removeEmptyImageDirs`, at start). Only empty
/// ones: a folder with images may belong to a colleague's opdracht whose JSON has not synced yet.
pub fn remove_empty_dirs(storage: &Storage) -> Result<()> {
    let root = RelPath::parse("opdrachten/images")?;
    for name in storage.list_dir(&root, true)? {
        let dir = root.join(&name)?;
        let empty =
            storage.list_dir(&dir, false)?.is_empty() && storage.list_dir(&dir, true)?.is_empty();
        if empty {
            let _ = storage.remove_empty_dir(&dir);
        }
    }
    Ok(())
}

/// A 48 px high PNG data URL of an image, or `None` if it does not decode.
pub fn thumbnail_data_url(bytes: &[u8]) -> Option<String> {
    let img = image::load_from_memory(bytes).ok()?;
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 {
        return None;
    }
    let width = ((u64::from(w) * u64::from(THUMB_HEIGHT) + u64::from(h) / 2) / u64::from(h))
        .clamp(1, u64::from(u32::MAX)) as u32;
    let thumb = img.resize_exact(width, THUMB_HEIGHT, FilterType::Triangle);
    let mut png = Vec::new();
    thumb
        .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .ok()?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(png);
    Some(format!("data:image/png;base64,{b64}"))
}

/// RGBA pixels (the clipboard) as base64 PNG (`clipboard.readImage().toPNG()`).
pub fn rgba_to_png_base64(rgba: &[u8], width: u32, height: u32) -> Option<String> {
    let img = image::RgbaImage::from_raw(width, height, rgba.to_vec())?;
    if width == 0 || height == 0 {
        return None;
    }
    let mut png = Vec::new();
    img.write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .ok()?;
    Some(base64::engine::general_purpose::STANDARD.encode(png))
}

/// An approximation of `a.localeCompare(b, 'nl')` (ICU root collation) for file names:
/// punctuation before digits before letters, letters without accents and case first, then
/// accents, then lower case before upper case.
pub fn nl_compare(a: &str, b: &str) -> Ordering {
    fn primary(s: &str) -> Vec<(u8, char)> {
        s.nfd()
            .filter(|&c| !is_combining_mark(c))
            .map(|c| {
                let class = if c.is_alphabetic() {
                    2
                } else if c.is_numeric() {
                    1
                } else {
                    0
                };
                (class, c.to_lowercase().next().unwrap_or(c))
            })
            .collect()
    }
    fn secondary(s: &str) -> Vec<char> {
        s.nfd().filter(|&c| is_combining_mark(c)).collect()
    }
    fn tertiary(s: &str) -> Vec<bool> {
        s.chars().map(char::is_uppercase).collect()
    }
    primary(a)
        .cmp(&primary(b))
        .then_with(|| secondary(a).cmp(&secondary(b)))
        .then_with(|| tertiary(a).cmp(&tertiary(b)))
        .then_with(|| a.cmp(b))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn storage() -> (tempfile::TempDir, Storage) {
        let tmp = tempfile::tempdir().unwrap();
        let locks = tmp.path().join("locks");
        let storage = Storage::open_with_lock_dir(tmp.path().join("data"), &locks).unwrap();
        (tmp, storage)
    }

    fn png(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(w, h, image::Rgba([200, 30, 30, 255]));
        let mut out = Vec::new();
        img.write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
            .unwrap();
        out
    }

    #[test]
    fn names_are_cleaned_as_the_reference_does() {
        assert_eq!(clean_image_name("Remweg auto!"), "Remweg-auto");
        assert_eq!(clean_image_name("  café élève "), "cafe-eleve");
        assert_eq!(clean_image_name("a/b\\c..d"), "a-b-c-d");
        assert_eq!(clean_image_name("--x__y--"), "x__y");
        assert_eq!(clean_image_name("!!!"), "");
        assert_eq!(clean_image_name(&"x".repeat(80)).len(), 60);
        // Not a U+0300-U+036F mark: becomes `-` (the reference's regex range).
        assert_eq!(clean_image_name("a\u{20d7}b"), "a-b");
    }

    #[test]
    fn ids_match_word_characters_and_dashes() {
        assert!(check_opdracht_id("opdracht_1756713600200").is_ok());
        assert!(check_opdracht_id("a-b").is_ok());
        for bad in ["", "..", "a/b", "a b", "é"] {
            let err = check_opdracht_id(bad).unwrap_err();
            assert_eq!(
                err.to_string(),
                "invalid argument: Ongeldige opdracht.",
                "{bad}"
            );
        }
    }

    #[test]
    fn store_list_overwrite_copy_delete() {
        let (_tmp, s) = storage();
        let saved = store(&s, "op_1", "Remweg auto!", "PNG", &png(96, 48), false).unwrap();
        assert_eq!(
            saved,
            Stored::Saved {
                file: "images/op_1/Remweg-auto.png".into(),
                name: "Remweg-auto".into()
            }
        );
        // Same name, other extension and case: exists unless overwrite.
        assert_eq!(
            store(&s, "op_1", "remweg auto", "svg", b"<svg/>", false).unwrap(),
            Stored::Exists {
                name: "remweg-auto".into()
            }
        );
        store(&s, "op_1", "remweg auto", "svg", b"<svg/>", true).unwrap();
        store(&s, "op_1", "b", "jpg", b"not a jpeg", false).unwrap();
        let images = list(&s, "op_1").unwrap();
        let names: Vec<&str> = images.iter().map(|i| i.file.as_str()).collect();
        assert_eq!(names, ["images/op_1/b.jpg", "images/op_1/remweg-auto.svg"]);
        assert_eq!(images[0].thumb, None, "undecodable");
        assert_eq!(images[1].thumb, None, "SVG");

        copy(&s, "op_1", "op_2").unwrap();
        assert_eq!(list(&s, "op_2").unwrap().len(), 2);
        assert_eq!(delete_all(&s, "op_1").unwrap(), None);
        assert!(list(&s, "op_1").unwrap().is_empty());
        assert!(!s.data_dir().root().join("opdrachten/images/op_1").exists());
        // Missing source and missing folder are fine.
        copy(&s, "nope", "op_3").unwrap();
        assert_eq!(delete_all(&s, "nope").unwrap(), None);
    }

    #[test]
    fn store_rejects_names_and_types_before_the_id() {
        let (_tmp, s) = storage();
        let rejected = |message: &str| Stored::Rejected {
            message: message.into(),
        };
        assert_eq!(
            store(&s, "../x", "!!", "png", b"", false).unwrap(),
            rejected("Geef de afbeelding een naam.")
        );
        assert_eq!(
            store(&s, "../x", "a", "BMP", b"", false).unwrap(),
            rejected("Bestandstype .bmp wordt niet ondersteund.")
        );
        assert!(store(&s, "../x", "a", "png", b"", false).is_err());
        assert!(list(&s, "../x").is_err());
        assert!(copy(&s, "a", "b/c").is_err());
        assert!(delete_all(&s, "").is_err());
    }

    #[test]
    fn thumbnails_are_48_px_high_pngs() {
        let url = thumbnail_data_url(&png(200, 100)).unwrap();
        let b64 = url.strip_prefix("data:image/png;base64,").unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .unwrap();
        let thumb = image::load_from_memory(&bytes).unwrap();
        assert_eq!((thumb.width(), thumb.height()), (96, 48));
        // Small images are scaled up, as nativeImage.resize does.
        let url = thumbnail_data_url(&png(10, 4)).unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(url.split_once(',').unwrap().1)
            .unwrap();
        let thumb = image::load_from_memory(&bytes).unwrap();
        assert_eq!((thumb.width(), thumb.height()), (120, 48));
    }

    #[test]
    fn clipboard_pixels_become_a_png() {
        let b64 = rgba_to_png_base64(&[0, 0, 0, 255, 255, 255, 255, 255], 2, 1).unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .unwrap();
        assert_eq!(&bytes[..4], b"\x89PNG");
        assert!(rgba_to_png_base64(&[0; 3], 2, 1).is_none(), "wrong length");
    }

    #[test]
    fn remove_empty_dirs_keeps_folders_with_files() {
        let (_tmp, s) = storage();
        s.seed_initial_data().unwrap();
        s.ensure_dir(&RelPath::parse("opdrachten/images/leeg").unwrap())
            .unwrap();
        store(&s, "vol", "a", "png", &png(2, 2), false).unwrap();
        remove_empty_dirs(&s).unwrap();
        let root = s.data_dir().root().join("opdrachten/images");
        assert!(!root.join("leeg").exists());
        assert!(root.join("vol/a.png").exists());
    }

    #[test]
    fn remove_dir_later_gives_up_after_the_attempts() {
        let (_tmp, s) = storage();
        store(&s, "vol", "a", "png", &png(2, 2), false).unwrap();
        let dir = RelPath::parse("opdrachten/images/vol").unwrap();
        remove_dir_retrying(&s, &dir, 2, Duration::from_millis(1));
        assert!(s.data_dir().root().join("opdrachten/images/vol").exists());
    }

    #[test]
    fn sorting_follows_dutch_collation() {
        let mut names = vec![
            "b.png", "B.png", "a10.png", "a2.png", "É.png", "e.png", "_x.png", "1.png",
        ];
        names.sort_by(|a, b| nl_compare(a, b));
        assert_eq!(
            names,
            [
                "_x.png", "1.png", "a10.png", "a2.png", "b.png", "B.png", "e.png", "É.png"
            ]
        );
    }
}

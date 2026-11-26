// SPDX-License-Identifier: AGPL-3.0-or-later

//! The opdracht's images in the workspace: the real ones when the teacher switched them on,
//! otherwise placeholders of the same size and type.

use super::*;

pub(super) fn copy_images(
    input: &TurnInput,
    workdir: &Path,
    baseline: &mut Baseline,
) -> Result<()> {
    let from = input.opdracht_dir.join(IMAGES_DIR);
    let Ok(entries) = fs::read_dir(&from) else {
        return Ok(());
    };
    let to = workdir.join(IMAGES_DIR);
    fs::create_dir_all(&to).map_err(io(&to))?;
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !entry.file_type().is_ok_and(|t| t.is_file())
            || !IMAGE_EXTS.contains(&extension_of(&name).as_str())
        {
            continue;
        }
        let source = entry.path();
        let bytes = if input.context.images {
            fs::read(&source).map_err(io(&source))?
        } else {
            baseline.placeholders.push(format!("{IMAGES_DIR}/{name}"));
            placeholder(&source, &extension_of(&name))
        };
        let target = to.join(&name);
        fs::write(&target, &bytes).map_err(io(&target))?;
        baseline
            .images
            .insert(format!("{IMAGES_DIR}/{name}"), sha256_hex(&bytes));
    }
    Ok(())
}

/// A grey image with the size and type of `source` (privacy: images could show students).
pub fn placeholder(source: &Path, ext: &str) -> Vec<u8> {
    if ext == "svg" {
        let text = fs::read_to_string(source).unwrap_or_default();
        return svg_placeholder(&text).into_bytes();
    }
    let (w, h) = image::image_dimensions(source).unwrap_or((1, 1));
    // Large photos: the same ratio, at most 2000 px wide or high (memory, not layout: Typst
    // sizes images by the space the opdracht gives them).
    let scale = (2000.0 / f64::from(w.max(h))).min(1.0);
    let (w, h) = (
        ((f64::from(w) * scale).round() as u32).max(1),
        ((f64::from(h) * scale).round() as u32).max(1),
    );
    let img = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
        w,
        h,
        image::Rgb([204, 204, 204]),
    ));
    let format = match ext {
        "jpg" | "jpeg" => image::ImageFormat::Jpeg,
        "gif" => image::ImageFormat::Gif,
        "webp" => image::ImageFormat::WebP,
        _ => image::ImageFormat::Png,
    };
    let img = if format == image::ImageFormat::WebP {
        image::DynamicImage::ImageRgba8(img.to_rgba8())
    } else {
        img
    };
    let mut out = Vec::new();
    if img.write_to(&mut Cursor::new(&mut out), format).is_err() {
        out.clear();
        let _ = img.write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png);
    }
    out
}

/// A grey SVG with the root element's `width`, `height` and `viewBox`.
pub(super) fn svg_placeholder(source: &str) -> String {
    let tag = source
        .find("<svg")
        .and_then(|start| {
            source[start..]
                .find('>')
                .map(|end| &source[start..start + end])
        })
        .unwrap_or("");
    let attr = |name: &str| -> Option<String> {
        let at = tag.find(&format!(" {name}="))? + name.len() + 2;
        let quote = tag[at..].chars().next()?;
        let rest = &tag[at + 1..];
        let end = rest.find(quote)?;
        let value = &rest[..end];
        value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || " .-%".contains(c))
            .then(|| format!(" {name}=\"{value}\""))
    };
    let attrs: String = ["width", "height", "viewBox"]
        .iter()
        .filter_map(|a| attr(a))
        .collect();
    let attrs = if attrs.is_empty() {
        " width=\"100\" height=\"100\"".to_owned()
    } else {
        attrs
    };
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\"{attrs}><rect x=\"-50%\" y=\"-50%\" width=\"200%\" height=\"200%\" fill=\"#cccccc\"/></svg>\n"
    )
}

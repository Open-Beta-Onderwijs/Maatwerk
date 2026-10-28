// SPDX-License-Identifier: AGPL-3.0-or-later

//! Merging PDFs in order (ADR-0002 5a), as the reference does with pdf-lib for a batch
//! (`main.js:896-907`, `typst-contract.md` 4.3): with `duplex`, every new key (student) starts on
//! an odd page, by inserting a blank page the size of the page before it. Jobs with the same key
//! are not padded, nothing is padded after the last key, and only neighbouring keys are compared.
//!
//! As with pdf-lib (quirk T24) only pages are carried over: each document's catalog (outline,
//! named destinations, structure tree) and metadata are dropped. Page annotations (links) stay.

use lopdf::{Dictionary, Document, Object, ObjectId, dictionary};

/// One document to merge and the key it belongs to (`job.key`: student id or opdracht id).
#[derive(Debug, Clone, Copy)]
pub struct MergePart<'a> {
    pub key: &'a str,
    pub pdf: &'a [u8],
}

/// The merged PDF and its page count (blank pages included).
#[derive(Debug, Clone)]
pub struct Merged {
    pub pdf: Vec<u8>,
    pub pages: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum MergeError {
    #[error("PDF {index} kan niet worden gelezen: {source}")]
    Read {
        index: usize,
        #[source]
        source: lopdf::Error,
    },
    #[error("PDF {index} heeft geen pagina's")]
    NoPages { index: usize },
    #[error("het samengevoegde PDF kan niet worden geschreven: {0}")]
    Write(#[source] std::io::Error),
}

/// Page attributes a page may inherit from its page tree (PDF 32000-1, 7.7.3.4).
const INHERITABLE: [&[u8]; 4] = [b"MediaBox", b"CropBox", b"Resources", b"Rotate"];

/// Merges `parts` in order. An empty list gives a valid PDF without pages.
pub fn pdf_merge(parts: &[MergePart<'_>], duplex: bool) -> Result<Merged, MergeError> {
    let mut out = Document::with_version("1.7");
    let pages_id = out.new_object_id();
    let mut kids: Vec<Object> = Vec::new();
    let mut last_media_box: Option<Object> = None;

    for (index, part) in parts.iter().enumerate() {
        let new_key = index > 0 && parts[index - 1].key != part.key;
        if duplex && new_key && kids.len() % 2 == 1 {
            // The reference's `merged.addPage([lastPage.width, lastPage.height])`.
            let mut blank = dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "Resources" => Dictionary::new(),
            };
            if let Some(media_box) = &last_media_box {
                blank.set("MediaBox", media_box.clone());
            }
            kids.push(out.add_object(blank).into());
        }

        let mut doc =
            Document::load_mem(part.pdf).map_err(|source| MergeError::Read { index, source })?;
        doc.renumber_objects_with(out.max_id + 1);
        let pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
        if pages.is_empty() {
            return Err(MergeError::NoPages { index });
        }
        for page_id in pages {
            let mut page = doc
                .get_dictionary(page_id)
                .map_err(|source| MergeError::Read { index, source })?
                .clone();
            for key in INHERITABLE {
                if !page.has(key)
                    && let Some(value) = inherited(&doc, &page, key)
                {
                    page.set(key, value);
                }
            }
            page.set("Parent", pages_id);
            // The structure tree is dropped with the catalog.
            page.remove(b"StructParents");
            last_media_box = page.get(b"MediaBox").ok().cloned();
            doc.objects.insert(page_id, Object::Dictionary(page));
            kids.push(page_id.into());
        }
        out.max_id = doc.max_id;
        out.objects.extend(doc.objects);
    }

    let count = kids.len();
    out.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => kids,
            "Count" => count as i64,
        }),
    );
    let catalog = out.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    out.trailer.set("Root", catalog);
    let info = out.add_object(dictionary! {
        "Producer" => Object::string_literal(format!("Maatwerk {}", crate::VERSION)),
    });
    out.trailer.set("Info", info);
    // Drops the old catalogs, page trees, structure trees and metadata.
    out.prune_objects();
    out.renumber_objects();

    let mut pdf = Vec::new();
    out.save_to(&mut pdf).map_err(MergeError::Write)?;
    Ok(Merged { pdf, pages: count })
}

/// The value of an inheritable attribute from the nearest ancestor that has it.
fn inherited(doc: &Document, page: &Dictionary, key: &[u8]) -> Option<Object> {
    let mut node = page.get(b"Parent").ok()?.as_reference().ok()?;
    // Bounded, in case of a cyclic page tree.
    for _ in 0..64 {
        let dict = doc.get_dictionary(node).ok()?;
        if let Ok(value) = dict.get(key) {
            return Some(value.clone());
        }
        node = dict.get(b"Parent").ok()?.as_reference().ok()?;
    }
    None
}

#[cfg(test)]
mod tests {
    use lopdf::content::{Content, Operation};
    use lopdf::{Stream, dictionary};

    use super::*;

    /// A PDF with one page per text, sized `w` x `h`, with the MediaBox on the page tree only
    /// (inherited), as some producers write it.
    fn pdf(texts: &[&str], (w, h): (i64, i64)) -> Vec<u8> {
        let mut doc = Document::with_version("1.7");
        let pages_id = doc.new_object_id();
        let font = doc.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
        });
        let resources = doc.add_object(dictionary! { "Font" => dictionary! { "F1" => font } });
        let mut kids = Vec::new();
        for text in texts {
            let content = Content {
                operations: vec![
                    Operation::new("BT", vec![]),
                    Operation::new("Tf", vec!["F1".into(), 12.into()]),
                    Operation::new("Td", vec![20.into(), 20.into()]),
                    Operation::new("Tj", vec![Object::string_literal(*text)]),
                    Operation::new("ET", vec![]),
                ],
            };
            let stream = doc.add_object(Stream::new(Dictionary::new(), content.encode().unwrap()));
            kids.push(
                doc.add_object(dictionary! {
                    "Type" => "Page", "Parent" => pages_id, "Contents" => stream,
                })
                .into(),
            );
        }
        let count = kids.len() as i64;
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages", "Kids" => kids, "Count" => count,
                "Resources" => resources,
                "MediaBox" => vec![0.into(), 0.into(), w.into(), h.into()],
            }),
        );
        let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog);
        let mut out = Vec::new();
        doc.save_to(&mut out).unwrap();
        out
    }

    /// Per page of the merged PDF: its text, or `None` for a blank page, and its MediaBox size.
    fn pages(pdf: &[u8]) -> Vec<(Option<String>, (f32, f32))> {
        let doc = Document::load_mem(pdf).unwrap();
        doc.get_pages()
            .into_iter()
            .map(|(n, id)| {
                let page = doc.get_dictionary(id).unwrap();
                let b = page.get(b"MediaBox").unwrap().as_array().unwrap();
                let size = (b[2].as_float().unwrap(), b[3].as_float().unwrap());
                let text = page
                    .has(b"Contents")
                    .then(|| doc.extract_text(&[n]).unwrap().trim().to_owned());
                (text, size)
            })
            .collect()
    }

    #[test]
    fn duplex_starts_every_key_on_an_odd_page() {
        // TC 10.7: page counts 2, 1+2 (same key) and 3 give S1 p1-2, S2 p3-5, blank p6 sized like
        // p5, S3 p7-9.
        let a = pdf(&["a1", "a2"], (595, 842));
        let b1 = pdf(&["b1"], (595, 842));
        let b2 = pdf(&["b2", "b3"], (300, 400));
        let c = pdf(&["c1", "c2", "c3"], (595, 842));
        let parts = [
            MergePart { key: "1", pdf: &a },
            MergePart { key: "2", pdf: &b1 },
            MergePart { key: "2", pdf: &b2 },
            MergePart { key: "3", pdf: &c },
        ];
        let merged = pdf_merge(&parts, true).unwrap();
        assert_eq!(merged.pages, 9);
        let got = pages(&merged.pdf);
        let texts: Vec<Option<&str>> = got.iter().map(|(t, _)| t.as_deref()).collect();
        assert_eq!(
            texts,
            [
                Some("a1"),
                Some("a2"),
                Some("b1"),
                Some("b2"),
                Some("b3"),
                None,
                Some("c1"),
                Some("c2"),
                Some("c3")
            ]
        );
        assert_eq!(
            got[5].1,
            (300.0, 400.0),
            "blank page sized like the page before"
        );
        assert_eq!(got[4].1, (300.0, 400.0), "inherited MediaBox carried over");
    }

    #[test]
    fn without_duplex_nothing_is_padded() {
        let a = pdf(&["a1"], (595, 842));
        let b = pdf(&["b1"], (595, 842));
        let parts = [
            MergePart { key: "x", pdf: &a },
            MergePart { key: "y", pdf: &b },
        ];
        let merged = pdf_merge(&parts, false).unwrap();
        assert_eq!(merged.pages, 2);
        assert_eq!(pages(&merged.pdf).len(), 2);
    }

    #[test]
    fn nothing_is_padded_after_the_last_key_and_only_neighbours_are_compared() {
        let one = pdf(&["p"], (595, 842));
        let parts = [
            MergePart {
                key: "1",
                pdf: &one,
            },
            MergePart {
                key: "2",
                pdf: &one,
            },
            MergePart {
                key: "1",
                pdf: &one,
            },
        ];
        // 1 | blank | 2 | blank | 1 (key 1 again counts as a new key) = 5 pages, none after.
        let merged = pdf_merge(&parts, true).unwrap();
        assert_eq!(merged.pages, 5);
    }

    #[test]
    fn unreadable_input_names_the_part() {
        let ok = pdf(&["a"], (595, 842));
        let parts = [
            MergePart { key: "1", pdf: &ok },
            MergePart {
                key: "2",
                pdf: b"geen pdf",
            },
        ];
        let err = pdf_merge(&parts, true).unwrap_err();
        assert!(matches!(err, MergeError::Read { index: 1, .. }), "{err}");
    }

    #[test]
    fn old_catalogs_are_dropped() {
        let a = pdf(&["a"], (595, 842));
        let merged = pdf_merge(&[MergePart { key: "1", pdf: &a }], true).unwrap();
        let doc = Document::load_mem(&merged.pdf).unwrap();
        let catalogs = doc
            .objects
            .values()
            .filter(|o| {
                o.as_dict().is_ok_and(|d| {
                    d.get(b"Type")
                        .is_ok_and(|t| t.as_name().ok() == Some(b"Catalog"))
                })
            })
            .count();
        assert_eq!(catalogs, 1);
    }
}

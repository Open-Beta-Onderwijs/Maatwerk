// SPDX-License-Identifier: AGPL-3.0-or-later

//! Editor help from `typst-ide` (Step 8b): autocomplete, hover text, go to definition, and the
//! jumps between source and preview that replace the old cursor marker (ADR-0002 section 12).
//!
//! Positions are UTF-16 offsets into the file's text after a leading BOM, as CodeMirror counts
//! them; preview positions are points (pt) from the top left of a 0-based page. A query can pass
//! the editor's current text, so it never answers for text the user no longer sees. Jumps use the
//! document only while it was compiled from the sources as they are now (review 8a n7).

use serde::Serialize;
use typst::layout::{Abs, Point};
use typst::syntax::{FileId, Side, Source, VirtualPath};
use typst::{World, WorldExt};
use typst_ide::{Definition, Jump, Tooltip};

use super::editor::EditorSession;
use super::world::INTERNAL_DIR;
use crate::error::Result;
use crate::paths::RelPath;

/// Completions for one cursor position.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Completions {
    /// Where the completed text starts (UTF-16); it runs to the cursor.
    pub from: usize,
    pub items: Vec<CompletionItem>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CompletionItem {
    /// `func`, `type`, `param`, `constant`, `path`, `package`, `label`, `font`, `symbol`,
    /// `syntax`.
    pub kind: &'static str,
    pub label: String,
    /// The text to insert, in snippet syntax (`${name}` placeholders); the label when `None`.
    pub apply: Option<String>,
    pub detail: Option<String>,
}

/// Hover text: plain text or Typst code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "text", rename_all = "lowercase")]
pub enum HoverText {
    Text(String),
    Code(String),
}

/// A range in a project file (UTF-16).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SourceRange {
    /// Relative to the project root, e.g. `opdracht.typ`.
    pub file: String,
    pub from: usize,
    pub to: usize,
}

/// A point in the preview.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct PreviewPoint {
    /// 0-based page index.
    pub page: usize,
    pub x: f64,
    pub y: f64,
}

/// Where a click in the preview leads.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ClickTarget {
    /// The source position of the clicked text or shape.
    Source { file: String, offset: usize },
    /// An internal link (e.g. a reference): another place in the preview.
    Preview { point: PreviewPoint },
}

/// The answer to a jump, tagged with the generation of the preview it belongs to, so the client
/// can ignore it when it has moved on.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct JumpAnswer<T> {
    pub generation: u64,
    pub target: T,
}

impl EditorSession {
    /// Autocomplete at `offset` in `path`. `explicit`: the user asked (Ctrl+Space).
    pub fn complete(
        &mut self,
        path: &RelPath,
        text: Option<String>,
        offset: usize,
        explicit: bool,
    ) -> Result<Option<Completions>> {
        let Some((source, cursor)) = self.source_at(path, text, offset)? else {
            return Ok(None);
        };
        let answer =
            typst_ide::autocomplete(self.world(), self.document(), &source, cursor, explicit);
        Ok(answer.and_then(|(from, items)| {
            Some(Completions {
                from: source.lines().byte_to_utf16(from)?,
                items: items
                    .into_iter()
                    .map(|c| CompletionItem {
                        kind: kind_name(&c.kind),
                        label: c.label.into(),
                        apply: c.apply.map(Into::into),
                        detail: c.detail.map(Into::into),
                    })
                    .collect(),
            })
        }))
    }

    /// The hover text for the item at `offset` in `path`.
    pub fn hover(
        &mut self,
        path: &RelPath,
        text: Option<String>,
        offset: usize,
    ) -> Result<Option<HoverText>> {
        let Some((source, cursor)) = self.source_at(path, text, offset)? else {
            return Ok(None);
        };
        let tooltip =
            typst_ide::tooltip(self.world(), self.document(), &source, cursor, Side::After);
        Ok(tooltip.map(|t| match t {
            Tooltip::Text(s) => HoverText::Text(s.into()),
            Tooltip::Code(s) => HoverText::Code(s.into()),
        }))
    }

    /// Where the item at `offset` in `path` is defined, if in a project file (not the standard
    /// library, a package or an internal file).
    pub fn definition(
        &mut self,
        path: &RelPath,
        text: Option<String>,
        offset: usize,
    ) -> Result<Option<SourceRange>> {
        let Some((source, cursor)) = self.source_at(path, text, offset)? else {
            return Ok(None);
        };
        let definition =
            typst_ide::definition(self.world(), self.document(), &source, cursor, Side::After);
        let Some(Definition::Span(span)) = definition else {
            return Ok(None);
        };
        let world = self.world();
        let Some(id) = span.id() else {
            return Ok(None);
        };
        let (Some(file), Some(range)) = (project_path(id), world.range(span)) else {
            return Ok(None);
        };
        let Ok(target) = world.source(id) else {
            return Ok(None);
        };
        let lines = target.lines();
        Ok(
            match (
                lines.byte_to_utf16(range.start),
                lines.byte_to_utf16(range.end),
            ) {
                (Some(from), Some(to)) => Some(SourceRange { file, from, to }),
                _ => None,
            },
        )
    }

    /// The source position behind a click at `point` (pt) on preview page `page` (0-based).
    pub fn jump_from_click(&self, page: usize, x: f64, y: f64) -> Option<JumpAnswer<ClickTarget>> {
        let (document, generation) = self.current_document()?;
        let frame = &document.pages.get(page)?.frame;
        let click = Point::new(Abs::pt(x), Abs::pt(y));
        let target = match typst_ide::jump_from_click(self.world(), document, frame, click)? {
            Jump::File(id, byte) => {
                let file = project_path(id)?;
                let offset = self.world().source(id).ok()?.lines().byte_to_utf16(byte)?;
                ClickTarget::Source { file, offset }
            }
            Jump::Position(pos) => ClickTarget::Preview {
                point: PreviewPoint {
                    page: pos.page.get() - 1,
                    x: pos.point.x.to_pt(),
                    y: pos.point.y.to_pt(),
                },
            },
            Jump::Url(_) => return None,
        };
        Some(JumpAnswer { generation, target })
    }

    /// The preview positions of the text at `offset` in `path` (the editor's cursor). Uses the
    /// buffer the last compile saw: when the editor has changed since, the answer is `None`.
    pub fn jump_from_cursor(
        &self,
        path: &RelPath,
        offset: usize,
    ) -> Option<JumpAnswer<Vec<PreviewPoint>>> {
        let (document, generation) = self.current_document()?;
        let source = self.world().source(file_id(path)).ok()?;
        let cursor = source.lines().utf16_to_byte(offset)?;
        let points = typst_ide::jump_from_cursor(document, &source, cursor)
            .into_iter()
            .map(|pos| PreviewPoint {
                page: pos.page.get() - 1,
                x: pos.point.x.to_pt(),
                y: pos.point.y.to_pt(),
            })
            .collect();
        Some(JumpAnswer {
            generation,
            target: points,
        })
    }

    /// The parsed source of `path` with `text` set first (if given), and `offset` as a byte
    /// index; `None` when the file cannot be read or the offset is outside it.
    fn source_at(
        &mut self,
        path: &RelPath,
        text: Option<String>,
        offset: usize,
    ) -> Result<Option<(Source, usize)>> {
        if let Some(text) = text {
            self.set_file(path, text)?;
        }
        let Ok(source) = self.world().source(file_id(path)) else {
            return Ok(None);
        };
        Ok(source
            .lines()
            .utf16_to_byte(offset)
            .map(|cursor| (source, cursor)))
    }
}

fn file_id(path: &RelPath) -> FileId {
    FileId::new(None, VirtualPath::new(format!("/{}", path.as_str())))
}

/// `id` as a path relative to the project root, if it is a project file (not in a package and
/// not one of the app's internal files).
fn project_path(id: FileId) -> Option<String> {
    if id.package().is_some() {
        return None;
    }
    let path = id.vpath().as_rootless_path().to_str()?.replace('\\', "/");
    if path.split('/').next() == Some(INTERNAL_DIR) {
        return None;
    }
    Some(path)
}

fn kind_name(kind: &typst_ide::CompletionKind) -> &'static str {
    use typst_ide::CompletionKind as K;
    match kind {
        K::Syntax => "syntax",
        K::Func => "func",
        K::Type => "type",
        K::Param => "param",
        K::Constant => "constant",
        K::Path => "path",
        K::Package => "package",
        K::Label => "label",
        K::Font => "font",
        K::Symbol(_) => "symbol",
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::sync::{Arc, OnceLock};

    use time::OffsetDateTime;

    use super::*;
    use crate::typst_svc::{FontStore, TypstProject};

    fn fonts() -> Arc<FontStore> {
        static FONTS: OnceLock<Arc<FontStore>> = OnceLock::new();
        FONTS
            .get_or_init(|| Arc::new(FontStore::new(false)))
            .clone()
    }

    fn now() -> OffsetDateTime {
        OffsetDateTime::from_unix_timestamp(1_767_225_600).unwrap()
    }

    fn rel(p: &str) -> RelPath {
        RelPath::parse(p).unwrap()
    }

    /// A project with `main.typ` = `text` in the buffer and `deel.typ` on disk.
    fn session(dir: &Path, text: &str) -> EditorSession {
        std::fs::write(dir.join("main.typ"), "").unwrap();
        std::fs::write(dir.join("deel.typ"), "#let groet(naam) = [Hallo #naam]\n").unwrap();
        let world = TypstProject::folder(dir, &rel("main.typ")).world(fonts(), now());
        let mut s = EditorSession::new(world).with_clock(now);
        s.set_file(&rel("main.typ"), text).unwrap();
        s
    }

    fn utf16(text: &str, needle: &str) -> usize {
        text[..text.find(needle).unwrap()].encode_utf16().count()
    }

    #[test]
    fn completes_functions_and_own_definitions_with_the_editor_text() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = session(tmp.path(), "");
        // The buffer the session has is empty; the query brings the editor's text.
        let text = "😀 #let mijn-functie(x) = x\n#mij";
        let at = text.encode_utf16().count();
        let done = s
            .complete(&rel("main.typ"), Some(text.into()), at, true)
            .unwrap()
            .unwrap();
        assert_eq!(done.from, at - 3, "from the start of `mij` (UTF-16)");
        assert!(done.items.iter().any(|c| c.label == "mijn-functie"));

        let text = "#tab";
        let done = s
            .complete(&rel("main.typ"), Some(text.into()), 4, true)
            .unwrap()
            .unwrap();
        assert!(done.items.iter().any(|c| c.label == "table"));
    }

    #[test]
    fn an_offset_outside_the_text_gives_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = session(tmp.path(), "#tab");
        assert_eq!(s.complete(&rel("main.typ"), None, 99, true).unwrap(), None);
        assert_eq!(s.hover(&rel("main.typ"), None, 99).unwrap(), None);
    }

    #[test]
    fn hover_describes_a_standard_function() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = session(tmp.path(), "#table()");
        let hover = s.hover(&rel("main.typ"), None, 2).unwrap().unwrap();
        let HoverText::Text(text) = hover else {
            panic!("{hover:?}")
        };
        assert!(text.to_lowercase().contains("table"), "{text}");
    }

    #[test]
    fn definition_finds_a_function_in_another_project_file() {
        let tmp = tempfile::tempdir().unwrap();
        let text = "#import \"deel.typ\": groet\n#groet[Sam]";
        let mut s = session(tmp.path(), text);
        let at = utf16(text, "groet[") + 1;
        let target = s.definition(&rel("main.typ"), None, at).unwrap().unwrap();
        assert_eq!(target.file, "deel.typ");
        assert_eq!(target.from, "#let ".len());
        // The standard library is not a place to go to.
        let mut s = session(tmp.path(), "#table()");
        assert_eq!(s.definition(&rel("main.typ"), None, 2).unwrap(), None);
    }

    #[test]
    fn click_and_cursor_jumps_go_both_ways_on_the_current_document() {
        let tmp = tempfile::tempdir().unwrap();
        let text = "#set page(width: 8cm, height: 4cm)\nEerste pagina\n#pagebreak()\nTweede pagina";
        let mut s = session(tmp.path(), text);
        assert!(s.compile(3, &|| false).unwrap().ok);

        // Cursor in "Tweede" -> page 2.
        let cursor = utf16(text, "Tweede") + 2;
        let jump = s.jump_from_cursor(&rel("main.typ"), cursor).unwrap();
        assert_eq!(jump.generation, 3);
        let point = jump.target[0];
        assert_eq!(point.page, 1);

        // A click on that spot leads back into "Tweede pagina".
        let click = s.jump_from_click(point.page, point.x + 1.0, point.y - 2.0);
        let Some(JumpAnswer {
            generation: 3,
            target: ClickTarget::Source { file, offset },
        }) = click
        else {
            panic!("{click:?}")
        };
        assert_eq!(file, "main.typ");
        let start = utf16(text, "Tweede");
        assert!(
            (start..start + "Tweede pagina".len()).contains(&offset),
            "{offset}"
        );

        // An empty spot leads nowhere; an edit makes the document stale (review 8a n7).
        assert_eq!(s.jump_from_click(0, 200.0, 100.0), None);
        s.set_file(&rel("main.typ"), format!("{text}!")).unwrap();
        assert_eq!(
            s.jump_from_click(point.page, point.x + 1.0, point.y - 2.0),
            None
        );
        assert_eq!(s.jump_from_cursor(&rel("main.typ"), cursor), None);
    }
}

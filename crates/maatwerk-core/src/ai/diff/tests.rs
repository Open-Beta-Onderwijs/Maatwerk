// SPDX-License-Identifier: AGPL-3.0-or-later

use super::*;

const BASE: &str = "a\nb\nc\nd\ne\n";

fn proposal(base: &str, proposed: &str) -> FileProposal {
    FileProposal {
        path: "opdracht.typ".into(),
        base: base.into(),
        proposed: proposed.into(),
        hunks: hunks(base, proposed),
    }
}

#[test]
fn hunks_group_changes() {
    let h = hunks(BASE, "a\nB\nc\nd\nE\nf\n");
    assert_eq!(h.len(), 2);
    assert_eq!(
        (h[0].base_start, h[0].base_lines.clone()),
        (1, vec!["b\n".to_owned()])
    );
    assert_eq!(h[0].new_lines, ["B\n"]);
    assert_eq!(h[1].base_start, 4);
    assert_eq!(h[1].new_lines, ["E\n", "f\n"]);
    assert!(hunks(BASE, BASE).is_empty());
}

#[test]
fn unchanged_buffer_gives_the_proposal() {
    let p = proposal(BASE, "x\na\nB\nc\nd\ne\ny\n");
    let all: Vec<usize> = p.hunks.iter().map(|h| h.id).collect();
    let r = apply(&p, BASE, &all);
    assert_eq!(r.text, p.proposed);
    assert_eq!(r.applied, all);
    assert!(r.conflicts.is_empty());
}

#[test]
fn rebases_onto_edits_elsewhere() {
    // The AI changes b; the teacher meanwhile added a line at the top and changed e.
    let p = proposal(BASE, "a\nB\nc\nd\ne\n");
    let current = "titel\na\nb\nc\nd\nE!\n";
    assert_eq!(
        rebase(&p.hunks, BASE, current),
        [HunkStatus::Clean { at: 2 }]
    );
    let r = apply(&p, current, &[0]);
    assert_eq!(r.text, "titel\na\nB\nc\nd\nE!\n");
}

#[test]
fn conflicts_when_the_same_lines_changed() {
    let p = proposal(BASE, "a\nB\nc\nd\nE\n");
    let current = "a\nb (leraar)\nc\nd\ne\n";
    assert_eq!(
        rebase(&p.hunks, BASE, current),
        [HunkStatus::Conflict, HunkStatus::Clean { at: 4 }]
    );
    let r = apply(&p, current, &[0, 1]);
    assert_eq!(r.text, "a\nb (leraar)\nc\nd\nE\n");
    assert_eq!((r.applied, r.conflicts), (vec![1], vec![0]));
}

#[test]
fn an_insertion_needs_its_neighbours() {
    // The AI inserts between c and d; the teacher inserted there too.
    let p = proposal(BASE, "a\nb\nc\nNEW\nd\ne\n");
    assert_eq!(
        rebase(&p.hunks, BASE, "a\nb\nc\nmine\nd\ne\n"),
        [HunkStatus::Conflict]
    );
    // Elsewhere is fine.
    assert_eq!(
        rebase(&p.hunks, BASE, "mine\na\nb\nc\nd\ne\n"),
        [HunkStatus::Clean { at: 4 }]
    );
}

#[test]
fn selection_and_edges() {
    let p = proposal(BASE, "A\nb\nc\nd\ne\nz\n");
    assert_eq!(apply(&p, BASE, &[1]).text, "a\nb\nc\nd\ne\nz\n");
    assert_eq!(apply(&p, BASE, &[]).text, BASE);
    // A last line without a line break.
    let base = "a\nb";
    let p = proposal(base, "a\nb\nc\n");
    let r = apply(&p, base, &[0]);
    assert!(r.text.starts_with("a\n"));
    assert!(r.text.contains('c'));
    // An empty file takes text only while it is empty.
    let p = proposal("", "nieuw\n");
    assert_eq!(apply(&p, "", &[0]).text, "nieuw\n");
    assert_eq!(rebase(&p.hunks, "", "getypt\n"), [HunkStatus::Conflict]);
}

#[test]
fn collect_restricts_to_opdracht_and_images() {
    let dir = tempfile::tempdir().unwrap();
    let w = dir.path();
    let mut baseline = Baseline::default();
    for (name, text) in [
        ("opdracht.typ", "o\n"),
        ("main.typ", "m\n"),
        ("lib.typ", "l\n"),
    ] {
        fs::write(w.join(name), text).unwrap();
        baseline.files.insert(name.into(), text.into());
    }
    fs::create_dir_all(w.join("images")).unwrap();
    fs::write(w.join("images/oud.png"), b"old").unwrap();
    fs::write(w.join("images/weg.png"), b"gone").unwrap();
    baseline
        .images
        .insert("images/oud.png".into(), sha256_hex(b"old"));
    baseline
        .images
        .insert("images/weg.png".into(), sha256_hex(b"gone"));
    assert!(collect(w, &baseline).unwrap().is_empty());

    fs::write(w.join("opdracht.typ"), "o\nnieuw\n").unwrap();
    fs::write(w.join("lib.typ"), "hacked\n").unwrap();
    fs::write(w.join("images/oud.png"), b"changed").unwrap();
    fs::write(w.join("images/Nieuwe grafiek.png"), b"new").unwrap();
    fs::write(w.join("images/notes.txt"), b"x").unwrap();
    fs::remove_file(w.join("images/weg.png")).unwrap();
    fs::write(w.join("scratch.py"), "print()").unwrap();
    let p = collect(w, &baseline).unwrap();
    assert_eq!(p.files.len(), 1);
    assert_eq!(p.files[0].hunks.len(), 1);
    assert_eq!(p.skipped, ["lib.typ", "images/weg.png (verwijderd)"]);
    let images: Vec<(&str, bool)> = p.images.iter().map(|i| (i.path.as_str(), i.new)).collect();
    assert_eq!(
        images,
        [
            ("images/Nieuwe-grafiek.png", true),
            ("images/oud.png", false)
        ]
    );

    fs::write(w.join("opdracht.typ"), "  \n").unwrap();
    let p = collect(w, &baseline).unwrap();
    assert!(p.files.is_empty());
    assert!(p.skipped.contains(&"opdracht.typ (leeg)".to_owned()));
}

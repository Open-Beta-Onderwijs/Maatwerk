// SPDX-License-Identifier: AGPL-3.0-or-later

//! Embeds the vendored Typst packages (`assets/packages/<namespace>/<name>/<version>/...`): writes
//! `$OUT_DIR/packages.rs` with one `include_bytes!` per file, sorted by path.

use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("assets")
        .join("packages");
    println!("cargo:rerun-if-changed={}", root.display());

    let mut files = Vec::new();
    walk(&root, &mut files);
    // Sorted by the key string, which the binary search in `assets` relies on.
    let mut entries: Vec<(String, PathBuf)> = files
        .into_iter()
        .map(|file| {
            let rel: Vec<String> = file
                .strip_prefix(&root)
                .expect("walked below the root")
                .components()
                .map(|c| c.as_os_str().to_str().expect("UTF-8 path").to_owned())
                .collect();
            (rel.join("/"), file)
        })
        // Only what Typst reads; READMEs stay in the repo for reference.
        .filter(|(rel, _)| !rel.ends_with("README.md"))
        .collect();
    entries.sort();

    let mut out = String::from("pub(crate) static PACKAGE_FILES: &[(&str, &[u8])] = &[\n");
    for (rel, file) in &entries {
        out.push_str(&format!(
            "    ({rel:?}, include_bytes!({:?})),\n",
            file.display().to_string()
        ));
    }
    out.push_str("];\n");

    let dest = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR")).join("packages.rs");
    fs::write(dest, out).expect("write packages.rs");
}

fn walk(dir: &Path, files: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).expect("read assets/packages") {
        let path = entry.expect("dir entry").path();
        if path.is_dir() {
            println!("cargo:rerun-if-changed={}", path.display());
            walk(&path, files);
        } else {
            files.push(path);
        }
    }
}

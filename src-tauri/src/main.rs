// SPDX-License-Identifier: AGPL-3.0-or-later

// Release builds have no console window on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `maatwerk --ai-check <folder>`: the AI assistant's bundled check command (step 32a); runs
    // without a window and exits.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(code) = maatwerk_core::ai::check::main_from_args(&args) {
        std::process::exit(code);
    }
    maatwerk_app::run();
}

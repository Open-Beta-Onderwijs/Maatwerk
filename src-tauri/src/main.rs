// SPDX-License-Identifier: AGPL-3.0-or-later

// Release builds have no console window on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    maatwerk_app::run();
}

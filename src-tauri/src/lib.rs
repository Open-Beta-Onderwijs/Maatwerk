// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri shell. Command handlers parse arguments, call `maatwerk_core` and map
//! errors; they hold no business logic.

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GreetReply {
    message: String,
    core_version: &'static str,
}

#[tauri::command]
fn greet(name: &str) -> GreetReply {
    GreetReply {
        message: maatwerk_core::greeting(name),
        core_version: maatwerk_core::VERSION,
    }
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("failed to start the Tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    // ui/src/greet.ts reads exactly these camelCase keys.
    #[test]
    fn greet_reply_matches_the_ui_contract() {
        let reply = serde_json::to_value(greet(" Jan ")).unwrap();
        assert_eq!(
            reply,
            serde_json::json!({
                "message": "Hallo, Jan!",
                "coreVersion": maatwerk_core::VERSION,
            })
        );
    }
}

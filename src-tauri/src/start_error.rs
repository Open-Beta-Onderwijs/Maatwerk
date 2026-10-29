// SPDX-License-Identifier: AGPL-3.0-or-later

//! A failed start gets a Dutch message box instead of a silent exit (PLAN Step 6b). The main
//! case: the portable exe has no installer to fetch the WebView2 runtime, and without it Tauri
//! panics when it creates the window ("Could not find the webview runtime"). Shown with `rfd`,
//! which needs no webview.

pub const TITLE: &str = "Maatwerk kan niet starten";

const WEBVIEW2_MISSING: &str = "Maatwerk heeft Microsoft Edge WebView2 nodig, maar dat kon niet \
     worden gestart op deze computer.\n\nInstalleer de \"Evergreen\"-versie van WebView2 via \
     https://developer.microsoft.com/microsoft-edge/webview2/ of vraag de ICT-afdeling om het \
     te installeren. Start Maatwerk daarna opnieuw.";

/// The Dutch text for a failed start; `error` is Tauri's (English) error, kept for support.
pub fn start_error_text(error: &str) -> String {
    let advice = if is_webview_error(error) {
        WEBVIEW2_MISSING
    } else {
        "Er ging iets mis bij het starten van Maatwerk. Start Maatwerk opnieuw; lukt dat niet, \
         stuur dan deze melding en het logbestand naar de beheerder."
    };
    format!("{advice}\n\nTechnische melding: {error}")
}

/// wry reports a missing or broken runtime as a WebView2 error when it creates the webview.
fn is_webview_error(error: &str) -> bool {
    error.to_lowercase().contains("webview")
}

/// Shows the message for a panic on the main thread (the event loop: setup and window
/// creation run there, and a panic there ends the app anyway). Panics on worker threads are
/// only logged: a command's blocking task reports them as an `internal` error.
pub fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        default(info);
        let payload = info.payload();
        let message = payload
            .downcast_ref::<&str>()
            .map(|s| (*s).to_owned())
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "panic".to_owned());
        tracing::error!("panic: {message}");
        if std::thread::current().name() == Some("main") {
            explain_start_error(&message);
        }
    }));
}

/// Shows the start error and returns; the caller exits.
pub fn explain_start_error(error: &str) {
    rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title(TITLE)
        .set_description(start_error_text(error))
        .set_buttons(rfd::MessageButtons::Ok)
        .show();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_webview_error_asks_for_webview2() {
        // Tauri 2.12's panic without a runtime (seen with WEBVIEW2_BROWSER_EXECUTABLE_FOLDER
        // pointing at a missing folder).
        let error = "Failed to setup app: runtime error: Could not find the webview runtime,                      make sure it is installed";
        let text = start_error_text(error);
        assert!(text.contains("Microsoft Edge WebView2 nodig"), "{text}");
        assert!(text.ends_with(&format!("Technische melding: {error}")));
    }

    #[test]
    fn other_errors_get_the_general_text() {
        let text = start_error_text("failed to setup app: no config dir");
        assert!(!text.contains("WebView2"), "{text}");
        assert!(text.contains("logbestand"), "{text}");
    }
}

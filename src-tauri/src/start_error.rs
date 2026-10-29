// SPDX-License-Identifier: AGPL-3.0-or-later

//! A failed start gets a Dutch message box instead of a silent exit (PLAN Step 6b). The main
//! case: the portable exe has no installer to fetch the WebView2 runtime. `check_webview` runs
//! before Tauri, because Tauri's own (English) box would come first in a release build (review
//! 6 M1); a panic during setup or window creation is caught by the panic hook. Shown with `rfd`,
//! which needs no webview.

use std::sync::atomic::{AtomicBool, Ordering};

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
         stuur dan deze melding en het logbestand naar de beheerder (map \
         %LOCALAPPDATA%\\nl.openbetaonderwijs.maatwerk\\logs)."
    };
    format!("{advice}\n\nTechnische melding: {error}")
}

/// wry reports a missing or broken runtime as a WebView2 error when it creates the webview.
fn is_webview_error(error: &str) -> bool {
    error.to_lowercase().contains("webview")
}

/// Set once the event loop reports `Ready` after setup: later panics are not start failures.
static STARTED: AtomicBool = AtomicBool::new(false);

pub fn mark_started() {
    STARTED.store(true, Ordering::SeqCst);
}

/// `Err` with the reason when there is no usable webview runtime (on Windows: WebView2).
pub fn check_webview() -> Result<(), String> {
    wry::webview_version()
        .map(|version| tracing::info!("webview runtime {version}"))
        .map_err(|e| format!("WebView2 runtime not found: {e}"))
}

/// Shows the message for a panic on the main thread before the app has started (setup and
/// window creation run in the event loop there, and such a panic ends the app). Other panics
/// are only logged: a command's blocking task reports them as an `internal` error.
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
        if std::thread::current().name() == Some("main") && !STARTED.load(Ordering::SeqCst) {
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
        let error = "Failed to setup app: runtime error: Could not find the webview runtime, \
                     make sure it is installed";
        let text = start_error_text(error);
        assert!(text.contains("Microsoft Edge WebView2 nodig"), "{text}");
        assert!(text.ends_with(&format!("Technische melding: {error}")));
    }

    #[test]
    fn the_pre_check_reason_asks_for_webview2() {
        let text = start_error_text("WebView2 runtime not found: WebView2 error: 0x80070002");
        assert!(text.contains("Microsoft Edge WebView2 nodig"), "{text}");
    }

    /// CI and dev machines have WebView2; the pre-check must not stop the app there.
    #[cfg(windows)]
    #[test]
    fn this_machine_has_a_webview_runtime() {
        assert_eq!(check_webview(), Ok(()));
    }

    #[test]
    fn other_errors_get_the_general_text() {
        let text = start_error_text("failed to setup app: no config dir");
        assert!(!text.contains("WebView2"), "{text}");
        assert!(text.contains("logbestand"), "{text}");
    }
}

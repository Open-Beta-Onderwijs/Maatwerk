// SPDX-License-Identifier: AGPL-3.0-or-later

//! The `maatwerk-out` URI scheme (ADR-0002 section 9): serves a PDF from the output folder by its
//! output ID, so pdf.js gets the bytes without `file:///` URLs and without large IPC messages. On
//! Windows the webview reaches it as `http://maatwerk-out.localhost/<id>`.

use std::borrow::Cow;

use tauri::http::{Method, Request, Response, StatusCode, header};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::state::Shared;

pub const SCHEME: &str = "maatwerk-out";

/// Origins of the app's own pages: production on Windows and other platforms, plus the Vite dev
/// server in debug builds only (review 6a n6).
fn is_app_origin(origin: &str) -> bool {
    matches!(origin, "http://tauri.localhost" | "tauri://localhost")
        || (cfg!(debug_assertions) && origin == "http://localhost:1420")
}

/// The handler for `register_asynchronous_uri_scheme_protocol`. Reads on a blocking thread.
pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let core = ctx
        .app_handle()
        .try_state::<Shared>()
        .map(|s| Shared::clone(s.inner()));
    tauri::async_runtime::spawn_blocking(move || {
        let response = match core {
            Some(core) => respond(&request, |id| core.outputs().ok()?.read(id).ok()),
            None => status(StatusCode::SERVICE_UNAVAILABLE),
        };
        responder.respond(response);
    });
}

/// The response for one request; `read` returns an output's bytes by ID.
fn respond(
    request: &Request<Vec<u8>>,
    read: impl FnOnce(&str) -> Option<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    if request.method() != Method::GET {
        return status(StatusCode::METHOD_NOT_ALLOWED);
    }
    // Output IDs are plain ASCII (`<n>-<name>.pdf`); anything else is not found.
    let id = request.uri().path().trim_start_matches('/');
    let Some(pdf) = read(id) else {
        return status(StatusCode::NOT_FOUND);
    };
    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/pdf")
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff");
    // The viewer page and the scheme are different origins, so pdf.js's fetch needs CORS.
    if let Some(origin) = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|o| o.to_str().ok())
        .filter(|o| is_app_origin(o))
    {
        builder = builder.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
    }
    builder
        .body(Cow::Owned(pdf))
        .unwrap_or_else(|_| status(StatusCode::INTERNAL_SERVER_ERROR))
}

fn status(code: StatusCode) -> Response<Cow<'static, [u8]>> {
    let mut response = Response::new(Cow::Borrowed(&b""[..]));
    *response.status_mut() = code;
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(uri: &str, origin: Option<&str>) -> Request<Vec<u8>> {
        let mut b = Request::builder().method(Method::GET).uri(uri);
        if let Some(o) = origin {
            b = b.header(header::ORIGIN, o);
        }
        b.body(Vec::new()).unwrap()
    }

    fn store(id: &str) -> Option<Vec<u8>> {
        (id == "1-rapport_preview.pdf").then(|| b"%PDF-1.7".to_vec())
    }

    #[test]
    fn serves_a_known_output_with_cors_for_the_app_only() {
        let r = respond(
            &get(
                "http://maatwerk-out.localhost/1-rapport_preview.pdf",
                Some("http://tauri.localhost"),
            ),
            store,
        );
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(r.body().as_ref(), b"%PDF-1.7");
        assert_eq!(r.headers()[header::CONTENT_TYPE], "application/pdf");
        assert_eq!(
            r.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN],
            "http://tauri.localhost"
        );

        let r = respond(
            &get(
                "maatwerk-out://localhost/1-rapport_preview.pdf",
                Some("https://example.org"),
            ),
            store,
        );
        assert_eq!(r.status(), StatusCode::OK);
        assert!(
            r.headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .is_none()
        );
    }

    #[test]
    fn unknown_ids_and_other_methods_are_refused() {
        let r = respond(
            &get("http://maatwerk-out.localhost/..%2Fsecret", None),
            store,
        );
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
        let post = Request::builder()
            .method(Method::POST)
            .uri("http://maatwerk-out.localhost/1-rapport_preview.pdf")
            .body(Vec::new())
            .unwrap();
        assert_eq!(
            respond(&post, store).status(),
            StatusCode::METHOD_NOT_ALLOWED
        );
    }
}

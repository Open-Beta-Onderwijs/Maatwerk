// SPDX-License-Identifier: AGPL-3.0-or-later

//! The error every command returns: `{ code, message, details }` (ADR-0002 section 2). The UI
//! maps `code` to Dutch text or to a method's compat shape (`ui/src/bridge/tauri-api.ts`).

use maatwerk_core::Error;
use serde::Serialize;
use specta::Type;

/// Stable error codes. One per core error variant, plus `internal` for failures of the shell
/// itself (a crashed blocking task).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidPath,
    NotFound,
    CorruptJson,
    Conflict,
    Locked,
    UnsupportedSchema,
    InvalidArgument,
    Io,
    Internal,
}

/// Structured context; only the fields that apply are set.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ErrorDetails {
    /// Data-relative path the error is about.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// `conflict`: the colleague who wrote the file, from `_meta.updatedBy`, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_by: Option<String>,
    /// `unsupported_schema`: the `schema_version` found.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub found: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
pub struct CommandError {
    pub code: ErrorCode,
    /// English, for logs and developers; the UI shows its own Dutch text per `code`.
    pub message: String,
    pub details: ErrorDetails,
}

impl CommandError {
    pub fn internal(message: impl Into<String>) -> CommandError {
        CommandError {
            code: ErrorCode::Internal,
            message: message.into(),
            details: ErrorDetails::default(),
        }
    }
}

impl From<Error> for CommandError {
    fn from(e: Error) -> CommandError {
        let message = e.to_string();
        let path = |p: &str| ErrorDetails {
            path: Some(p.to_owned()),
            ..ErrorDetails::default()
        };
        let (code, details) = match &e {
            Error::InvalidPath { path: p, .. } => (ErrorCode::InvalidPath, path(p)),
            Error::NotFound { path: p } => (ErrorCode::NotFound, path(p)),
            Error::CorruptJson { path: p, .. } => (ErrorCode::CorruptJson, path(p)),
            Error::Conflict {
                path: p,
                updated_by,
            } => (
                ErrorCode::Conflict,
                ErrorDetails {
                    updated_by: updated_by.clone(),
                    ..path(p)
                },
            ),
            Error::Locked { path: p } => (ErrorCode::Locked, path(p)),
            Error::UnsupportedSchema { found } => (
                ErrorCode::UnsupportedSchema,
                ErrorDetails {
                    found: Some(found.clone()),
                    ..ErrorDetails::default()
                },
            ),
            Error::InvalidArgument { .. } => (ErrorCode::InvalidArgument, ErrorDetails::default()),
            Error::Io { path: p, .. } => (ErrorCode::Io, path(p)),
        };
        CommandError {
            code,
            message,
            details,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_match_the_core_codes() {
        let errors = [
            Error::InvalidPath {
                path: "a".into(),
                reason: "r",
            },
            Error::NotFound { path: "a".into() },
            Error::CorruptJson {
                path: "a".into(),
                message: "m".into(),
            },
            Error::Conflict {
                path: "a".into(),
                updated_by: None,
            },
            Error::Locked { path: "a".into() },
            Error::UnsupportedSchema { found: "9".into() },
            Error::InvalidArgument {
                message: "m".into(),
            },
            Error::Io {
                path: "a".into(),
                source: std::io::Error::other("x"),
            },
        ];
        for e in errors {
            let core_code = e.code();
            let json = serde_json::to_value(CommandError::from(e)).unwrap();
            assert_eq!(json["code"], core_code);
        }
    }

    #[test]
    fn serialises_as_code_message_details() {
        let e = CommandError::from(Error::Conflict {
            path: "2025-2026/exams/t1.json".into(),
            updated_by: Some("jan".into()),
        });
        assert_eq!(
            serde_json::to_value(e).unwrap(),
            serde_json::json!({
                "code": "conflict",
                "message": "conflict on 2025-2026/exams/t1.json",
                "details": { "path": "2025-2026/exams/t1.json", "updatedBy": "jan" }
            })
        );
    }
}

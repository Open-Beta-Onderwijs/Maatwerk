// SPDX-License-Identifier: AGPL-3.0-or-later

//! The one error type of the core (ADR-0002 section 2). Each variant has a stable `code` that the
//! bridge sends to the UI, which maps it to Dutch text.

use std::io;

/// Result alias for the core.
pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A path from the UI that is not a safe relative path inside the data folder.
    #[error("invalid path {path:?}: {reason}")]
    InvalidPath { path: String, reason: &'static str },

    /// A file that must exist does not.
    #[error("not found: {path}")]
    NotFound { path: String },

    /// A file exists but does not parse as JSON (or is not UTF-8). Never overwritten (S24).
    #[error("corrupt JSON in {path}: {message}")]
    CorruptJson { path: String, message: String },

    /// Compare-and-swap failed: someone else wrote the file since it was read. `updated_by` is the
    /// other user's id from `_meta.updatedBy` when known (S27).
    #[error("conflict on {path}")]
    Conflict {
        path: String,
        updated_by: Option<String>,
    },

    /// The commit lock could not be taken in time (another process holds it).
    #[error("data folder busy, try again: {path}")]
    Locked { path: String },

    /// The data folder has a `schema_version` this build does not understand (ADR-0003 C1).
    #[error("unsupported schema_version {found} in config.json")]
    UnsupportedSchema { found: String },

    /// Invalid argument that is not a path (e.g. bad base64, bad year name).
    #[error("invalid argument: {message}")]
    InvalidArgument { message: String },

    /// Any other I/O error.
    #[error("I/O error on {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: io::Error,
    },
}

impl Error {
    /// Stable machine-readable code (`conflict`, `corrupt_json`, ...).
    pub fn code(&self) -> &'static str {
        match self {
            Error::InvalidPath { .. } => "invalid_path",
            Error::NotFound { .. } => "not_found",
            Error::CorruptJson { .. } => "corrupt_json",
            Error::Conflict { .. } => "conflict",
            Error::Locked { .. } => "locked",
            Error::UnsupportedSchema { .. } => "unsupported_schema",
            Error::InvalidArgument { .. } => "invalid_argument",
            Error::Io { .. } => "io",
        }
    }

    pub(crate) fn io(path: impl Into<String>, source: io::Error) -> Self {
        Error::Io {
            path: path.into(),
            source,
        }
    }
}

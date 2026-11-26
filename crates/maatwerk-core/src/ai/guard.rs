// SPDX-License-Identifier: AGPL-3.0-or-later

//! Stop and the time limit outside the CLI run (review 32 m7): preparing the workspace (the
//! diagnostics and PDF-output chips) and Maatwerk's own checks can take up to 30 s each. A
//! [`Guard`] waits for such work on its own thread and gives up as soon as the teacher presses
//! Stop or the turn's time limit passes. The work only computes; whatever it would write is
//! written by the caller, so work given up on leaves nothing behind.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

/// How often the guard looks at Stop and the clock.
const TICK: Duration = Duration::from_millis(50);

/// Why a guarded step ended early.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Interrupt {
    Stopped,
    TimedOut,
}

/// The turn's Stop flag and deadline.
#[derive(Debug, Clone, Copy)]
pub struct Guard<'a> {
    pub stop: &'a AtomicBool,
    pub deadline: Instant,
}

impl Guard<'_> {
    /// Stop pressed or the deadline passed.
    pub fn interrupted(&self) -> Option<Interrupt> {
        if self.stop.load(Ordering::SeqCst) {
            Some(Interrupt::Stopped)
        } else if Instant::now() >= self.deadline {
            Some(Interrupt::TimedOut)
        } else {
            None
        }
    }

    /// Runs `work` on its own thread; `None` when it did not finish within `limit`, or Stop or
    /// the deadline came first ([`Guard::interrupted`] tells which).
    pub fn wait<T: Send + 'static>(
        &self,
        limit: Duration,
        work: impl FnOnce() -> T + Send + 'static,
    ) -> Option<T> {
        if self.interrupted().is_some() {
            return None;
        }
        let (tx, rx) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            let _ = tx.send(work());
        });
        let until = Instant::now() + limit;
        loop {
            let left = until.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return None;
            }
            match rx.recv_timeout(left.min(TICK)) {
                Ok(v) => return Some(v),
                Err(RecvTimeoutError::Disconnected) => return None,
                Err(RecvTimeoutError::Timeout) => {}
            }
            if self.interrupted().is_some() {
                return None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn slow() -> impl FnOnce() -> u8 + Send + 'static {
        || {
            std::thread::sleep(Duration::from_secs(5));
            1
        }
    }

    #[test]
    fn work_that_finishes_gives_its_value() {
        let stop = AtomicBool::new(false);
        let g = Guard {
            stop: &stop,
            deadline: Instant::now() + Duration::from_secs(60),
        };
        assert_eq!(g.wait(Duration::from_secs(5), || 7), Some(7));
        assert_eq!(g.interrupted(), None);
    }

    #[test]
    fn stop_ends_the_wait_at_once() {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(150));
            flag.store(true, Ordering::SeqCst);
        });
        let g = Guard {
            stop: &stop,
            deadline: Instant::now() + Duration::from_secs(60),
        };
        let t = Instant::now();
        assert_eq!(g.wait(Duration::from_secs(30), slow()), None);
        assert!(t.elapsed() < Duration::from_secs(2), "{:?}", t.elapsed());
        assert_eq!(g.interrupted(), Some(Interrupt::Stopped));
    }

    #[test]
    fn the_deadline_ends_the_wait() {
        let stop = AtomicBool::new(false);
        let g = Guard {
            stop: &stop,
            deadline: Instant::now() + Duration::from_millis(200),
        };
        let t = Instant::now();
        assert_eq!(g.wait(Duration::from_secs(30), slow()), None);
        assert!(t.elapsed() < Duration::from_secs(2), "{:?}", t.elapsed());
        assert_eq!(g.interrupted(), Some(Interrupt::TimedOut));
    }

    #[test]
    fn the_step_limit_is_not_an_interrupt() {
        let stop = AtomicBool::new(false);
        let g = Guard {
            stop: &stop,
            deadline: Instant::now() + Duration::from_secs(60),
        };
        assert_eq!(g.wait(Duration::from_millis(100), slow()), None);
        assert_eq!(g.interrupted(), None);
    }
}

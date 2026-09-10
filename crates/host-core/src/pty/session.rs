//! True PTY sessions over `portable-pty` (ADR 0210).
//!
//! Allocates a real pseudo-terminal (ConPTY on Windows, pty on Unix) so
//! interactive programs (sudo, ssh, REPLs) behave as on a terminal. Output
//! pumps on a background thread into a queue; consumers drain with timeouts
//! and classify via [`crate::pty::detector`]. Drop kills the child.

use anyhow::{Context, Result};
use portable_pty::{CommandBuilder, MasterPty, PtySize};
use std::io::Read;
use std::path::Path;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

/// One live PTY session.
pub struct PtySession {
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    queue: Arc<Mutex<Vec<u8>>>,
    done: Arc<std::sync::atomic::AtomicBool>,
}

impl PtySession {
    /// Spawn `program args` in `cwd` with a `cols`×`rows` terminal.
    pub fn spawn(
        program: &str,
        args: &[&str],
        cwd: &Path,
        cols: u16,
        rows: u16,
    ) -> Result<Arc<Self>> {
        let pty_system = portable_pty::native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("pty open")?;
        let mut cmd = CommandBuilder::new(program);
        cmd.args(args);
        cmd.cwd(cwd);
        let child = pair.slave.spawn_command(cmd).context("pty spawn")?;
        drop(pair.slave);
        let mut reader = pair
            .master
            .try_clone_reader()
            .context("pty reader")?;
        let session = Arc::new(PtySession {
            master: Arc::new(Mutex::new(pair.master)),
            child: Arc::new(Mutex::new(child)),
            queue: Arc::new(Mutex::new(Vec::new())),
            done: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        });
        // Background pump: blocking reads never stall the async runtime.
        let pump = session.clone();
        std::thread::Builder::new()
            .name("pi-pty-pump".into())
            .spawn(move || {
                let mut buf = [0u8; 8192];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            if let Ok(mut q) = pump.queue.lock() {
                                q.extend_from_slice(&buf[..n]);
                                if q.len() > 512 * 1024 {
                                    let excess = q.len() - 512 * 1024;
                                    q.drain(..excess);
                                }
                            }
                        }
                        Err(_) => break,
                    }
                }
                pump.done
                    .store(true, std::sync::atomic::Ordering::SeqCst);
            })
            .context("pty pump thread")?;
        Ok(session)
    }

    /// Write bytes (keystrokes) to the terminal.
    pub fn write(&self, bytes: &[u8]) -> Result<()> {
        let mut master = self.master.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        use std::io::Write;
        let mut writer = master.take_writer().context("pty writer")?;
        writer.write_all(bytes).context("pty write")?;
        writer.flush().ok();
        Ok(())
    }

    /// Drain queued output, waiting up to `timeout` for the first bytes.
    /// Returns what arrived (possibly empty on timeout).
    pub fn drain(&self, timeout: Duration) -> Vec<u8> {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            let chunk = self.queue.lock().map(|mut q| std::mem::take(&mut *q)).unwrap_or_default();
            if !chunk.is_empty() || std::time::Instant::now() >= deadline {
                return chunk;
            }
            if self
                .done
                .load(std::sync::atomic::Ordering::SeqCst)
            {
                return chunk;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    /// Resize the terminal.
    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        self.master
            .lock()
            .map_err(|e| anyhow::anyhow!("{e}"))?
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("pty resize")
    }

    /// Exit status when the child finished, else `None`.
    pub fn try_exit(&self) -> Option<i32> {
        self.child
            .lock()
            .ok()?
            .try_wait()
            .ok()?
            .map(|s| s.exit_code() as i32)
    }

    /// Kill the child process.
    pub fn kill(&self) -> Result<()> {
        self.child
            .lock()
            .map_err(|e| anyhow::anyhow!("{e}"))?
            .kill()
            .context("pty kill")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn echo_round_trips_through_a_real_pty() {
        let dir = tempfile::tempdir().expect("dir");
        #[cfg(windows)]
        let win_args = vec!["/C", "echo hi-pty"];
        #[cfg(not(windows))]
        let nix_args = vec!["-c", "echo hi-pty"];
        #[cfg(windows)]
        let (program, args) = ("cmd", win_args.as_slice());
        #[cfg(not(windows))]
        let (program, args) = ("sh", nix_args.as_slice());
        let session = PtySession::spawn(program, args, dir.path(), 80, 24).expect("spawn");
        // ConPTY emits init sequences first; poll until the echo lands.
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        let mut text = String::new();
        while std::time::Instant::now() < deadline {
            let out = session.drain(Duration::from_millis(200));
            text.push_str(&String::from_utf8_lossy(&out));
            if text.contains("hi-pty") {
                break;
            }
        }
        assert!(text.contains("hi-pty"), "pty output: {text:?}");
        // Reap with a bounded wait.
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while session.try_exit().is_none() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(25));
        }
        let _ = session.kill();
    }

    #[test]
    fn resize_is_accepted() {
        let dir = tempfile::tempdir().expect("dir");
        #[cfg(windows)]
        let win_args = vec!["/C", "echo x"];
        #[cfg(not(windows))]
        let nix_args = vec!["-c", "echo x"];
        #[cfg(windows)]
        let (program, args) = ("cmd", win_args.as_slice());
        #[cfg(not(windows))]
        let (program, args) = ("sh", nix_args.as_slice());
        let session = PtySession::spawn(program, args, dir.path(), 80, 24).expect("spawn");
        assert!(session.resize(100, 30).is_ok());
        let _ = session.kill();
    }
}

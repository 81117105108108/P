//! Native PTY supervision: interactive prompt detection plus a supervised
//! piped runner (ADR 0209).
//!
//! `detector` classifies output text (sudo/ssh prompts, generic REPL prompts,
//! question suffixes) so supervisors can pause and ask instead of hanging.
//! True PTY allocation (`portable-pty`) is the follow-up; the runner below
//! uses piped stdio with timeouts over the existing tokio runtime.

pub mod detector;

use anyhow::{Context, Result};
use std::process::Stdio;
use std::time::Duration;

/// Bounded command result.
#[derive(Debug, Clone)]
pub struct SupervisedOutput {
    pub exit_code: Option<i32>,
    pub stdout_tail: String,
    pub stderr_tail: String,
    pub timed_out: bool,
    /// Prompt class seen in the tail, if any.
    pub prompt: Option<detector::PromptClass>,
}

/// Run `program args` in `cwd` with piped stdio, killing after `timeout`.
/// Keeps the last 10 lines per stream (matches history-pruning policy).
pub async fn run_supervised(
    program: &str,
    args: &[&str],
    cwd: &std::path::Path,
    timeout: Duration,
) -> Result<SupervisedOutput> {
    let mut child = tokio::process::Command::new(program)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .with_context(|| format!("spawn {program}"))?;
    let out = child.stdout.take();
    let err = child.stderr.take();
    let wait = tokio::time::timeout(timeout, async move {
        let mut stdout = String::new();
        let mut stderr = String::new();
        if let Some(mut o) = out {
            use tokio::io::AsyncReadExt;
            let mut buf = Vec::new();
            let _ = o.read_to_end(&mut buf).await;
            stdout = String::from_utf8_lossy(&buf).into_owned();
        }
        if let Some(mut e) = err {
            use tokio::io::AsyncReadExt;
            let mut buf = Vec::new();
            let _ = e.read_to_end(&mut buf).await;
            stderr = String::from_utf8_lossy(&buf).into_owned();
        }
        let status = child.wait().await;
        (status, stdout, stderr)
    })
    .await;
    match wait {
        Err(_) => Ok(SupervisedOutput {
            exit_code: None,
            stdout_tail: String::new(),
            stderr_tail: String::new(),
            timed_out: true,
            prompt: None,
        }),
        Ok((status, stdout, stderr)) => {
            let stdout_tail = tail_lines(&stdout, 10);
            let stderr_tail = tail_lines(&stderr, 10);
            let prompt = detector::detect(&format!("{stdout_tail}\n{stderr_tail}"));
            Ok(SupervisedOutput {
                exit_code: status.ok().and_then(|s| s.code()),
                stdout_tail,
                stderr_tail,
                timed_out: false,
                prompt,
            })
        }
    }
}

fn tail_lines(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

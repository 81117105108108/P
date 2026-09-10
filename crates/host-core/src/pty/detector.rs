//! ANSI-aware interactive prompt detector.
//!
//! Strips escape sequences, then classifies the tail text so a supervisor can
//! stop and surface a question instead of blocking on stdin forever.

/// What kind of input the output appears to request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromptClass {
    /// `sudo` password request.
    SudoPassword,
    /// SSH passphrase / host-key confirmation.
    SshAuth,
    /// Generic REPL/shell prompt (`$`, `#`, `>>>`, `>` at line end).
    ShellPrompt,
    /// Natural-language question (`?` suffix on the last line).
    Question,
}

/// Remove ANSI escape sequences (`\x1b[...`) and carriage returns.
pub fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if matches!(chars.peek(), Some('[') | Some('(')) {
                chars.next();
                for n in chars.by_ref() {
                    if n.is_ascii_alphabetic() {
                        break;
                    }
                }
                continue;
            }
            continue;
        }
        if c != '\r' {
            out.push(c);
        }
    }
    out
}

/// Classify the tail of process output. Returns `None` when no input looks
/// requested.
pub fn detect(output: &str) -> Option<PromptClass> {
    let clean = strip_ansi(output);
    let last: Vec<&str> = clean.lines().filter(|l| !l.trim().is_empty()).collect();
    let tail = last.last().copied().unwrap_or("").trim();
    let lower = tail.to_lowercase();
    if lower.contains("[sudo]") && lower.contains("password") || lower.starts_with("password:") {
        return Some(PromptClass::SudoPassword);
    }
    if lower.contains("passphrase")
        || lower.contains("are you sure you want to continue connecting")
    {
        return Some(PromptClass::SshAuth);
    }
    if tail.ends_with('$') || tail.ends_with('#') || tail.ends_with(">>>") || tail.ends_with('>') {
        return Some(PromptClass::ShellPrompt);
    }
    if tail.ends_with('?') {
        return Some(PromptClass::Question);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_ansi_sequences() {
        assert_eq!(strip_ansi("\x1b[32mok\x1b[0m\r\n"), "ok\n");
    }

    #[test]
    fn classifies_prompts() {
        assert_eq!(
            detect("[sudo] password for ada: "),
            Some(PromptClass::SudoPassword)
        );
        assert_eq!(
            detect("Enter passphrase for key '/home/ada/.ssh/id': "),
            Some(PromptClass::SshAuth)
        );
        assert_eq!(detect("ada@host:~/repo$ "), Some(PromptClass::ShellPrompt));
        assert_eq!(detect(">>> "), Some(PromptClass::ShellPrompt));
        assert_eq!(detect("Proceed with merge? "), Some(PromptClass::Question));
        assert_eq!(detect("build finished in 2s"), None);
    }
}

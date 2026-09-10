//! Rule hierarchy parser: nearest scope wins, every source labeled.

use std::path::{Path, PathBuf};

/// Rule filenames in precedence order (highest first per directory).
pub const RULE_FILES: &[&str] = &["AGENTS.md", "CLAUDE.md", ".cursorrules", ".clinerules"];

/// Max bytes read per rule file (keeps the semi-static block bounded).
pub const MAX_RULE_BYTES: usize = 32 * 1024;

/// One ingested rule source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleSource {
    /// File the text came from.
    pub path: PathBuf,
    /// Scope directory containing the file.
    pub scope: PathBuf,
    /// Raw text (truncated at [`MAX_RULE_BYTES`]).
    pub text: String,
}

/// Collect rule sources from `start` upward to the filesystem root, then
/// `<root>/.pi/rules/*.md`. Nearest directory first.
///
/// Ancestor scopes are intentional (repo → home hierarchy), so callers that
/// need isolation (tests, snapshots) use [`discover_rules_up_to`] with an
/// explicit ceiling instead.
pub fn discover_rules(start: &Path) -> Vec<RuleSource> {
    discover_rules_up_to(start, None)
}

/// Like [`discover_rules`] but never walks above `ceiling` (inclusive); the
/// `.pi/rules` extras resolve under `ceiling` (or the topmost visited dir).
pub fn discover_rules_up_to(start: &Path, ceiling: Option<&Path>) -> Vec<RuleSource> {
    let mut out = Vec::new();
    let mut dir = if start.is_file() {
        start.parent().map(|p| p.to_path_buf())
    } else {
        Some(start.to_path_buf())
    };
    let mut chain: Vec<PathBuf> = Vec::new();
    while let Some(d) = dir {
        chain.push(d.clone());
        if ceiling.is_some_and(|c| d == c) {
            break;
        }
        dir = d.parent().map(Path::to_path_buf).filter(|p| *p != d);
        if chain.len() > 64 {
            break;
        }
    }
    for scope in &chain {
        for name in RULE_FILES {
            let path = scope.join(name);
            if let Ok(text) = read_capped(&path) {
                out.push(RuleSource {
                    path,
                    scope: scope.clone(),
                    text,
                });
            }
        }
    }
    // Project-local extras, sorted for determinism.
    if let Some(root) = chain.last() {
        let extra = root.join(".pi").join("rules");
        if let Ok(rd) = std::fs::read_dir(&extra) {
            let mut names: Vec<PathBuf> = rd
                .filter_map(|e| e.ok().map(|e| e.path()))
                .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("md"))
                .collect();
            names.sort();
            for path in names {
                if let Ok(text) = read_capped(&path) {
                    out.push(RuleSource {
                        path,
                        scope: extra.clone(),
                        text,
                    });
                }
            }
        }
    }
    out
}

fn read_capped(path: &Path) -> std::io::Result<String> {
    let bytes = std::fs::read(path)?;
    let mut text = String::from_utf8_lossy(&bytes).into_owned();
    if text.len() > MAX_RULE_BYTES {
        text.truncate(MAX_RULE_BYTES);
    }
    if text.trim().is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "empty rule file",
        ));
    }
    Ok(text)
}

/// Render sources for the semi-static prompt block.
pub fn render_rules(sources: &[RuleSource]) -> String {
    sources
        .iter()
        .map(|s| format!("# Rules: {}\n\n{}", s.path.display(), s.text.trim()))
        .collect::<Vec<_>>()
        .join("\n\n---\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovers_nearest_first_with_labels() {
        let root = tempfile::tempdir().expect("root");
        std::fs::write(root.path().join("AGENTS.md"), "root rules\n").expect("w");
        let sub = root.path().join("pkg");
        std::fs::create_dir(&sub).expect("mkdir");
        std::fs::write(sub.join(".cursorrules"), "pkg rules\n").expect("w");
        // Ceiling keeps machine ancestors (home configs) out of the test.
        let found = discover_rules_up_to(&sub, Some(root.path()));
        assert_eq!(found.len(), 2);
        assert!(found[0].path.ends_with(".cursorrules"));
        assert!(found[1].path.ends_with("AGENTS.md"));
        let rendered = render_rules(&found);
        assert!(rendered.contains("# Rules:"));
    }

    #[test]
    fn skips_missing_gracefully() {
        let root = tempfile::tempdir().expect("root");
        assert!(discover_rules_up_to(root.path(), Some(root.path())).is_empty());
    }
}

/**
 * Pre-completion verification guard (ADR 0208).
 *
 * When the agent finishes code edits without running associated tests/builds,
 * the runtime injects one synthetic system turn naming the missing check
 * instead of accepting an unverified patch.
 */

export type VerifyTarget = { command: string; reason: string };

const TARGETS: ReadonlyArray<{ match: RegExp; target: VerifyTarget }> = [
  { match: /\.rs$/, target: { command: "cargo test -p host-core", reason: "Rust sources changed" } },
  { match: /\.(ts|tsx|mts|mjs)$/, target: { command: "pnpm test", reason: "TypeScript sources changed" } },
  { match: /\.py$/, target: { command: "pytest", reason: "Python sources changed" } },
];

/** Deduplicated verify targets for modified files. */
export function verificationTargets(modifiedFiles: readonly string[]): VerifyTarget[] {
  const out = new Map<string, VerifyTarget>();
  for (const file of modifiedFiles) {
    for (const { match, target } of TARGETS) {
      if (match.test(file)) out.set(target.command, target);
    }
  }
  return [...out.values()];
}

/** True when none of the run commands satisfies a required target. */
export function needsVerification(
  modifiedFiles: readonly string[],
  runCommands: readonly string[],
): boolean {
  const targets = verificationTargets(modifiedFiles);
  if (!targets.length) return false;
  return targets.some(
    (t) => !runCommands.some((c) => c.includes(t.command.split(" ")[0])),
  );
}

/** Synthetic system turn injected before an unverified completion. */
export function verificationTurn(modifiedFiles: readonly string[]): string {
  const targets = verificationTargets(modifiedFiles);
  const files = modifiedFiles.slice(0, 5).join(", ");
  const cmds = targets.map((t) => t.command).join(" / ") || "the test suite";
  return (
    `[SYSTEM: Verification Required: You modified ${files}. ` +
    `Run ${cmds} to verify no regressions before completing the task.]`
  );
}

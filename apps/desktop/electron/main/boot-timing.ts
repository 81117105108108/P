/**
 * Startup and diagnostic timing helpers.
 *
 * Agent-turn latency already lives in host/agent `timing` logs (D183). Boot,
 * clipboard sampling, and updater checks were silent, so a 30s blank window or
 * a 60s GitHub hang could not be attributed from `~/.pi-desktop/logs`.
 */

export type TimingFields = Record<string, string | number | boolean | undefined>;

export type TimingWriter = (message: string, data?: Record<string, unknown>) => void;

export function timingMessage(
  kind: string,
  phase: string,
  fields?: TimingFields,
): string {
  const parts = [`[timing] kind=${kind} phase=${phase}`];
  if (!fields) return parts.join(" ");
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    parts.push(`${key}=${value}`);
  }
  return parts.join(" ");
}

export class BootTiming {
  private readonly write: TimingWriter;
  readonly startedAt: number;

  constructor(write: TimingWriter, startedAt = Date.now()) {
    this.write = write;
    this.startedAt = startedAt;
  }

  elapsedMs(now = Date.now()): number {
    return now - this.startedAt;
  }

  mark(phase: string, fields?: TimingFields): void {
    const elapsedMs = this.elapsedMs();
    const payload = { kind: "boot", phase, elapsedMs, ...fields };
    this.write(timingMessage("boot", phase, { elapsedMs, ...fields }), payload);
  }

  async span<T>(
    phase: string,
    fn: () => Promise<T>,
    fields?: TimingFields,
  ): Promise<T> {
    const started = Date.now();
    try {
      const result = await fn();
      this.mark(phase, { ...fields, durationMs: Date.now() - started, ok: true });
      return result;
    } catch (error) {
      this.mark(phase, {
        ...fields,
        durationMs: Date.now() - started,
        ok: false,
      });
      throw error;
    }
  }
}

/** Log a clipboard sample at info when it exceeds this cost. */
export const CLIPBOARD_SAMPLE_SLOW_MS = 25;
/** Always log a sample this slow, even inside the debounce window. */
export const CLIPBOARD_SAMPLE_ALWAYS_MS = 100;
/** Slow-but-not-extreme samples are rate-limited to this interval. */
export const CLIPBOARD_SAMPLE_LOG_GAP_MS = 5_000;

export function shouldLogClipboardSample(input: {
  sampleIndex: number;
  durationMs: number;
  lastLoggedAt: number;
  now?: number;
}): boolean {
  if (input.sampleIndex === 0) return true;
  if (input.durationMs >= CLIPBOARD_SAMPLE_ALWAYS_MS) return true;
  if (input.durationMs < CLIPBOARD_SAMPLE_SLOW_MS) return false;
  const now = input.now ?? Date.now();
  return now - input.lastLoggedAt >= CLIPBOARD_SAMPLE_LOG_GAP_MS;
}

export const UPDATE_CHECK_TIMEOUT_CODE = "UPDATE_CHECK_TIMEOUT";

/**
 * Settle a promise after `timeoutMs` without cancelling the work. Used so a
 * hung GitHub feed cannot pin updater state on `checking` for Chromium's ~60s
 * socket timeout.
 */
export function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        Object.assign(new Error(`${label} timed out`), {
          code: UPDATE_CHECK_TIMEOUT_CODE,
        }),
      );
    }, timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

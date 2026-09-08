export type TaskNotificationVisibility = {
  finishingSessionId: string;
  viewingSessionId: string | null;
  windowVisible: boolean;
  windowFocused: boolean;
};

export type NativeNotificationSource = "task" | "interactive";

export type NativeNotificationVisibility = TaskNotificationVisibility & {
  source: NativeNotificationSource;
};

/**
 * Durable task notifications are only suppressed for the exact chat result
 * currently visible in a focused window. Every unknown or background state
 * fails safe to notification.
 */
export function shouldCreateTaskNotification({
  finishingSessionId,
  viewingSessionId,
  windowVisible,
  windowFocused,
}: TaskNotificationVisibility): boolean {
  const resultIsVisible =
    windowVisible &&
    windowFocused &&
    viewingSessionId !== null &&
    viewingSessionId === finishingSessionId;
  return !resultIsVisible;
}

/**
 * Keep terminal task delivery unfocused-only while allowing interactive
 * prompts to reach users who are focused on a different session.
 */
export function shouldShowNativeNotification({
  source,
  finishingSessionId,
  viewingSessionId,
  windowVisible,
  windowFocused,
}: NativeNotificationVisibility): boolean {
  if (source === "task") return !windowFocused;

  const promptIsVisible =
    windowVisible &&
    windowFocused &&
    viewingSessionId !== null &&
    viewingSessionId === finishingSessionId;
  return !promptIsVisible;
}

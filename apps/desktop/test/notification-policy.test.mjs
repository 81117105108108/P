import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldCreateTaskNotification,
  shouldShowNativeNotification,
} from "../electron/main/notification-policy.ts";

const focusedCurrent = {
  finishingSessionId: "session-a",
  viewingSessionId: "session-a",
  windowVisible: true,
  windowFocused: true,
};

test("suppresses a focused completion for the exact visible session", () => {
  assert.equal(shouldCreateTaskNotification(focusedCurrent), false);
});

test("keeps notifications for focused background sessions", () => {
  assert.equal(
    shouldCreateTaskNotification({
      ...focusedCurrent,
      finishingSessionId: "session-b",
    }),
    true,
  );
});

test("keeps notifications when the current session is unfocused or hidden", () => {
  assert.equal(
    shouldCreateTaskNotification({ ...focusedCurrent, windowFocused: false }),
    true,
  );
  assert.equal(
    shouldCreateTaskNotification({ ...focusedCurrent, windowVisible: false }),
    true,
  );
});

test("fails safe when the viewing context is unknown", () => {
  assert.equal(
    shouldCreateTaskNotification({ ...focusedCurrent, viewingSessionId: null }),
    true,
  );
});

test("keeps focused-background task completions native-silent", () => {
  assert.equal(
    shouldShowNativeNotification({
      ...focusedCurrent,
      source: "task",
      finishingSessionId: "session-b",
    }),
    false,
  );
});

test("shows focused-background interactive prompts", () => {
  assert.equal(
    shouldShowNativeNotification({
      ...focusedCurrent,
      source: "interactive",
      finishingSessionId: "session-b",
    }),
    true,
  );
});

test("suppresses interactive prompts in the focused visible session", () => {
  assert.equal(
    shouldShowNativeNotification({
      ...focusedCurrent,
      source: "interactive",
    }),
    false,
  );
});

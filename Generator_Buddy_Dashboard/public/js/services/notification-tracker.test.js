import test from "node:test";
import assert from "node:assert/strict";
import { createNotificationTracker } from "./notification-tracker.js";

test("notification polling ignores resolved history, emits new active alerts once, and resets for a new session", () => {
  const tracker = createNotificationTracker();
  const old = { notification_id: 1, status: "active" };
  const fresh = { notification_id: 2, status: "active" };
  const resolved = { notification_id: 3, status: "resolved" };
  assert.deepEqual(tracker.update([old]), [old]);
  assert.deepEqual(tracker.update([resolved, fresh, old]), [fresh]);
  assert.deepEqual(tracker.update([fresh, old]), []);
  tracker.update([]);
  assert.deepEqual(tracker.update([old]), []);
  tracker.reset();
  assert.deepEqual(tracker.update([fresh, old]), [old, fresh]);
});

test("severity changes on existing alerts produce one popup", () => {
  const tracker = createNotificationTracker();
  const warning = { notification_id: 10, status: "active", detail: "Temperature: 86 (warning)" };
  assert.equal(tracker.update([warning]).length, 1);
  assert.equal(tracker.update([warning]).length, 0);
  assert.equal(tracker.update([{ ...warning, detail: "Temperature: 96 (critical)" }]).length, 1);
  assert.equal(tracker.update([{ ...warning, status: "resolved" }]).length, 0);
});

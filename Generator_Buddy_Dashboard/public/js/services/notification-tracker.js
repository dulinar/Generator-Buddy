import { severity } from "./notification-view.js";
export function createNotificationTracker() {
  let seen = new Map();
  return {
    reset() { seen = new Map(); },
    update(rows) {
      const fresh = [];
      for (const row of rows) {
        const id = String(row.notification_id);
        const fingerprint = row.status + ":" + severity(row);
        if (row.status === "active" && seen.get(id) !== fingerprint) fresh.push(row);
        seen.set(id, fingerprint);
      }
      return fresh.reverse();
    },
  };
}

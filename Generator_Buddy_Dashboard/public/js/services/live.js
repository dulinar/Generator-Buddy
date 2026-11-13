import { updateDemo } from "./demo.js";
import { api } from "../api.js";
import { state } from "../state.js";
import { createNotificationTracker } from "./notification-tracker.js";
import { showToast } from "../ui/toasts.js";

const tracker = createNotificationTracker();
let owner = null;

export function syncNotifications(rows, render) {
  if (owner !== state.user) { tracker.reset(); owner = state.user; }
  state.notifications = rows;
  const fresh = tracker.update(rows);
  for (const notification of fresh.slice(-4)) {
    showToast(notification, () => { state.route = "notifications"; render(); });
  }
  const badge = document.querySelector("#notification-count");
  if (badge) {
    const count = rows.filter(row => row.status === "active").length;
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.hidden = count === 0;
    if (fresh.length && count > 0) {
      badge.classList.remove("pulse");
      void badge.offsetWidth;
      badge.classList.add("pulse");
    }
  }
}

export function startLiveUpdates(refresh, render) {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy || !state.user) return;
    if (state.demo) {
      updateDemo();
      syncNotifications(state.notifications, render);
      refresh();
      return;
    }
    busy = true;
    const user = state.user;
    const selected = state.selected;
    const notificationRevision = state.notificationRevision || 0;
    try {
      const [notifications, reading, generators, session, config, protocols, maintenance] = await Promise.allSettled([
        api("/api/notifications"),
        selected ? api("/api/generators/" + selected + "/latest") : Promise.resolve({ reading: null }),
        api("/api/generators"),
        api("/api/session"),
        ["dashboard", "maintenance"].includes(state.route) ? api("/api/config") : Promise.resolve(null),
        state.route === "maintenance" ? api("/api/service-protocols") : Promise.resolve(null),
        state.route === "maintenance" ? api("/api/maintenance") : Promise.resolve(null),
      ]);
      if (state.user !== user) return;
      if (session.status === "fulfilled") {
        if (!session.value.user) { state.user = null; state.reading = null; await render(); return; }
        if (session.value.user.role !== state.user.role) {
          Object.assign(state.user, session.value.user);
          await render(); return;
        }
      }
      if (config.status === "fulfilled" && config.value) state.config = config.value.rows || [];
      if (protocols.status === "fulfilled" && protocols.value) { state.protocols = protocols.value.rows || []; state.protocolError = null; }
      if (protocols.status === "rejected") state.protocolError = protocols.reason.message;
      if (maintenance.status === "fulfilled" && maintenance.value) { state.maintenanceRecords = maintenance.value.rows || []; state.maintenanceError = null; }
      if (generators.status === "fulfilled" && generators.value) {
        state.generators = generators.value.rows || [];
        state.generatorError = null;
        if (!state.generators.some(g => String(g.generator_id) === String(state.selected))) {
          state.selected = state.generators[0]?.generator_id ?? null;
          state.reading = null;
          state.history = [];
        }
      } else if (generators.status === "rejected") state.generatorError = generators.reason;
      if (!state.notificationBusy && notificationRevision === (state.notificationRevision || 0)) {
        if (notifications.status === "fulfilled") {
          state.notificationError = null;
          syncNotifications(notifications.value.rows || [], render);
        } else state.notificationError = notifications.reason;
      }
      if (selected === state.selected) state.telemetryError = reading.status === "rejected" ? reading.reason : null;
      if (selected === state.selected && reading.status === "fulfilled") {
        const newReading = reading.value.reading;
        if (newReading && (!state.reading || state.reading.recorded_at !== newReading.recorded_at)) {
          state.history.push(newReading);
          if (state.history.length > 30) state.history.shift();
        }
        state.reading = newReading;
      }
      refresh();
    } finally { busy = false; }
  }, 3000);
  return () => clearInterval(timer);
}

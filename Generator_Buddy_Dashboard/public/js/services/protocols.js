import { state } from "../state.js";
import { api } from "../api.js";
import { escapeHtml as esc } from "./notification-view.js";
import { showToast } from "../ui/toasts.js";

export function oilInterval() {
  const protocol = state.protocols?.find(row => row.protocol_id === "oil-service");
  return protocol ? Number(protocol.interval_hours) : null;
}

export function protocolList() {
  if (state.protocolError) return `<p class="error" role="alert">${esc(state.protocolError)}</p>`;
  return (state.protocols || []).map(p => `<div class="maintenance-checklist-item">
    <div class="interval-badge">${esc(p.interval_hours)} Hours</div>
    <div class="interval-content"><strong>${esc(p.title)}</strong><p>${esc(p.instructions)}</p></div>
    <span class="interval-status-badge status">${p.recurring ? "Recurring" : "One-time"}</span>
  </div>`).join("") || '<p>No service protocols configured.</p>';
}

export function protocolEditor() {
  if (state.user?.role !== "admin") return "";
  const protocols = [...(state.protocols || [])].sort((a, b) => a.interval_hours - b.interval_hours);
  return `<section class="schedule-manager" id="schedule-manager">
    <div class="settings-section-heading"><div><h2>Service Interval Protocols</h2><p>Plan preventive maintenance using your manufacturer's service schedule.</p></div>
    <button class="button" id="add-protocol" ${state.protocolError ? "disabled" : ""}>+ Add service</button></div>
    <div class="settings-note"><strong>How schedules work</strong><p>Intervals use engine running hours. Repeating services recur at the chosen interval. The oil-service schedule sets the countdown on Maintenance.</p></div>
    ${state.protocolError ? `<p class="error" role="alert">${esc(state.protocolError)}</p><button class="button secondary" id="retry-protocols">Try again</button>` : ""}
    <div class="schedule-list">${protocols.map(p => `<article class="panel schedule-row">
      <div class="schedule-hours"><strong>${Number(p.interval_hours).toLocaleString()}</strong><span>running hours</span></div>
      <div class="schedule-description"><div class="schedule-title"><h3>${esc(p.title)}</h3><span class="schedule-tag">${p.recurring ? "Repeating" : "One-time"}</span>${p.protocol_id === "oil-service" ? '<span class="schedule-tag countdown-tag">Maintenance countdown</span>' : ""}</div>
      <p>${esc(p.instructions)}</p><small>${p.recurring ? "Every" : "Once at"} ${Number(p.interval_hours).toLocaleString()} running hours</small></div>
      <button type="button" class="button secondary" data-edit-protocol="${esc(p.protocol_id)}" aria-label="Edit ${esc(p.title)}">Edit service</button>
    </article>`).join("") || (state.protocolError ? "" : '<div class="panel settings-empty"><h3>Build your service schedule</h3><p>Add your first service with a running-hour interval and instructions for your team.</p></div>')}</div>
    <p class="settings-footnote">Use the intervals specified for your generator model and operating conditions.</p>
    <dialog id="protocol-dialog" class="settings-dialog" aria-labelledby="protocol-dialog-title">
      <div class="settings-dialog-heading"><div><span class="eyebrow">Maintenance schedule</span><h2 id="protocol-dialog-title">Add service</h2></div><button type="button" class="icon-button" data-close-protocol aria-label="Close service dialog">×</button></div>
      <form id="protocol-form">
        <div class="field"><label for="protocol-title">Service name</label><input id="protocol-title" name="title" required maxlength="160" placeholder="e.g. Engine oil and filter replacement"></div>
        <div class="settings-field-pair"><div class="field"><label for="protocol-hours">Running-hour interval</label><div class="input-with-unit"><input id="protocol-hours" name="interval_hours" type="number" min="1" max="1000000" step="1" required placeholder="250" aria-describedby="protocol-hours-help"><span>hours</span></div><small id="protocol-hours-help">Count only the hours the engine has run.</small></div>
        <div class="field"><label for="protocol-repeat">Schedule type</label><select id="protocol-repeat" name="recurring"><option value="true">Repeating service</option><option value="false">One-time service</option></select></div></div>
        <p class="settings-note" id="protocol-preview" aria-live="polite">Enter an interval to preview the schedule.</p>
        <p id="protocol-oil-note" class="settings-footnote" hidden>This service controls the maintenance countdown and must repeat. Its name, interval, and instructions can be updated.</p>
        <div class="field"><label for="protocol-instructions">What needs to be done?</label><textarea id="protocol-instructions" name="instructions" rows="4" required maxlength="10000" placeholder="Describe the inspection or service steps for your maintenance team."></textarea></div>
        <p class="error" id="protocol-error" role="alert"></p>
        <div class="settings-dialog-actions"><button type="button" class="button secondary danger-text" id="delete-protocol">Delete service</button><div><button type="button" class="button secondary" data-close-protocol>Cancel</button><button type="submit" class="button" id="save-protocol">Save service</button></div></div>
      </form>
    </dialog>
  </section>`;
}

export function bindProtocolEditor() {
  const root = document.getElementById("schedule-manager");
  if (!root || state.user?.role !== "admin") return;
  const count = document.querySelector('[data-settings-section="schedules"] span');
  if (count) count.textContent = String(state.protocols?.length || 0);
  const dialog = root.querySelector("dialog");
  const form = root.querySelector("form");
  const error = root.querySelector("#protocol-error");
  const submit = root.querySelector("#save-protocol");
  const remove = root.querySelector("#delete-protocol");
  let editingId = null;
  let original = "";
  let busy = false;
  const draft = () => JSON.stringify({ title: form.elements.title.value, interval_hours: form.elements.interval_hours.value,
    recurring: form.elements.recurring.value === "true", instructions: form.elements.instructions.value });
  const preview = () => {
    const hours = Number(form.elements.interval_hours.value);
    root.querySelector("#protocol-preview").textContent = hours > 0
      ? (form.elements.recurring.value === "true" ? "Schedule this service every " : "Schedule this service once at ") + hours.toLocaleString() + " engine running hours."
      : "Enter an interval to preview the schedule.";
  };
  const close = () => {
    if (busy) return;
    if (draft() !== original && !confirm("Discard your unsaved service changes?")) return;
    dialog.close();
  };
  function open(protocol) {
    form.reset();
    editingId = protocol?.protocol_id || "protocol-" + crypto.randomUUID().slice(0, 20);
    root.querySelector("#protocol-dialog-title").textContent = protocol ? "Edit service" : "Add service";
    form.elements.title.value = protocol?.title || "";
    form.elements.interval_hours.value = protocol?.interval_hours || "";
    form.elements.instructions.value = protocol?.instructions || "";
    form.elements.recurring.value = protocol && !protocol.recurring ? "false" : "true";
    form.elements.recurring.disabled = editingId === "oil-service";
    root.querySelector("#protocol-oil-note").hidden = editingId !== "oil-service";
    remove.hidden = !protocol || editingId === "oil-service";
    error.textContent = "";
    original = draft();
    preview();
    dialog.showModal();
    form.elements.title.focus();
  }
  function refresh(message) {
    dialog.close();
    root.outerHTML = protocolEditor();
    bindProtocolEditor();
    document.getElementById("add-protocol")?.focus();
    showToast({ title: message, detail: "Your maintenance schedule is up to date." });
  }
  root.querySelector("#add-protocol").onclick = () => open();
  root.querySelectorAll("[data-edit-protocol]").forEach(button => {
    button.onclick = () => open(state.protocols.find(p => p.protocol_id === button.dataset.editProtocol));
  });
  root.querySelectorAll("[data-close-protocol]").forEach(button => { button.onclick = close; });
  dialog.oncancel = event => { event.preventDefault(); close(); };
  form.oninput = preview;
  form.onchange = preview;
  const retry = root.querySelector("#retry-protocols");
  if (retry) retry.onclick = async () => {
    retry.disabled = true;
    try {
      const result = await api("/api/service-protocols");
      state.protocols = result.rows || [];
      state.protocolError = null;
      root.outerHTML = protocolEditor();
      bindProtocolEditor();
    } catch (err) { root.querySelector('[role="alert"]').textContent = err.message; retry.disabled = false; }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    const body = JSON.parse(draft());
    body.title = body.title.trim();
    body.instructions = body.instructions.trim();
    body.interval_hours = Number(body.interval_hours);
    if (!body.title || !body.instructions) { error.textContent = "Enter a service name and maintenance instructions."; return; }
    busy = true;
    submit.disabled = remove.disabled = true;
    submit.textContent = "Saving…";
    error.textContent = "";
    try {
      await api("/api/service-protocols/" + editingId, { method: "PUT", body: JSON.stringify(body) });
      state.protocols = [...(state.protocols || []).filter(p => p.protocol_id !== editingId), { ...body, protocol_id: editingId }];
      refresh("Service saved");
    } catch (err) { error.textContent = err.message; }
    finally { busy = false; submit.disabled = remove.disabled = false; submit.textContent = "Save service"; }
  };
  remove.onclick = async () => {
    if (busy || !confirm('Delete "' + form.elements.title.value + '" from the service schedule? Existing service records will be retained.')) return;
    busy = true;
    submit.disabled = remove.disabled = true;
    try {
      await api("/api/service-protocols/" + editingId, { method: "DELETE" });
      state.protocols = state.protocols.filter(p => p.protocol_id !== editingId);
      refresh("Service deleted");
    } catch (err) { error.textContent = err.message; }
    finally { busy = false; submit.disabled = remove.disabled = false; }
  };
}

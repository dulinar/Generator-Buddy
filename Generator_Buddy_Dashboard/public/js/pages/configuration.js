import { protocolEditor, bindProtocolEditor } from "../services/protocols.js";
import { $$ } from "../icons.js";
import { api } from "../api.js";
import { state } from "../state.js";
import { showToast } from "../ui/toasts.js";
import { escapeHtml as esc } from "../services/notification-view.js";

let activeSection = "schedules";
export function config() {
  const cfg = Object.fromEntries(state.config.map(row => [row.parameter, row]));
  const card = (key, title, unit, description, lowerOnly = false, range = false) => {
    const fields = range ? [["Lower limit", "min"], ["Upper limit", "max"]] : [[lowerOnly ? "At or below" : "At or above", lowerOnly ? "min" : "max"]];
    return `<form class="panel threshold-card config-form" data-parameter="${key}">
      <div class="threshold-heading"><h3>${title}</h3><span class="schedule-tag">${unit}</span></div><p>${description}</p>
      <div class="threshold-levels">${["warning", "critical"].map(level => `<fieldset class="threshold-level ${level}"><legend>${level === "warning" ? "Warning" : "Critical"}</legend>
        ${fields.map(([label, suffix]) => `<div class="field"><label for="${key}-${level}-${suffix}">${label} (${unit})</label><input id="${key}-${level}-${suffix}" name="${level}_${suffix}" type="number" step="0.01" ${key === "fuel" ? 'min="0" max="100"' : ''} value="${esc(cfg[key]?.[level + "_" + suffix] ?? "")}" required></div>`).join("")}
      </fieldset>`).join("")}</div>
      <div class="threshold-footer"><span class="config-message" role="status" aria-live="polite">Save this parameter after making changes.</span><button class="button" type="submit">Save ${title.toLowerCase()}</button></div>
    </form>`;
  };
  return `<div class="page-heading"><div><div class="eyebrow">Administration</div><h1>System Configuration</h1><p>Set maintenance schedules and the limits that trigger generator alerts.</p></div></div>
    <div class="settings-switch" role="group" aria-label="Configuration sections">
      <button type="button" data-settings-section="schedules" aria-controls="settings-schedules" aria-pressed="${activeSection === "schedules"}">Service schedules <span>${state.protocols?.length || 0}</span></button>
      <button type="button" data-settings-section="thresholds" aria-controls="settings-thresholds" aria-pressed="${activeSection === "thresholds"}">Alert thresholds <span>4</span></button>
    </div>
    <div id="settings-schedules" ${activeSection !== "schedules" ? "hidden" : ""}>${protocolEditor()}</div>
    <section id="settings-thresholds" ${activeSection !== "thresholds" ? "hidden" : ""}>
      <div class="settings-section-heading"><div><h2>Alert thresholds</h2><p>These limits apply to all generators. Critical conditions take priority over warnings.</p></div></div>
      <div class="settings-note"><strong>Choose limits from your equipment specifications</strong><p>Warnings flag conditions that need attention. Critical limits flag conditions requiring urgent review. Keep warning ranges inside critical ranges.</p></div>
      <div class="threshold-grid">
        ${card("temperature", "Temperature", "°C", "Alert when engine temperature reaches or exceeds a limit.")}
        ${card("fuel", "Fuel level", "%", "Alert when remaining fuel reaches or falls below a limit.", true)}
        ${card("voltage", "Voltage", "V", "Alert when output voltage falls outside the selected range.", false, true)}
        ${card("frequency", "Frequency", "Hz", "Alert when output frequency falls outside the selected range.", false, true)}
      </div>
    </section>`;
}
export function bindConfiguration() {
  bindProtocolEditor();
  $$("[data-settings-section]").forEach(button => {
    button.onclick = () => {
      activeSection = button.dataset.settingsSection;
      $$("[data-settings-section]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
      document.getElementById("settings-schedules").hidden = activeSection !== "schedules";
      document.getElementById("settings-thresholds").hidden = activeSection !== "thresholds";
    };
  });
  $$(".config-form").forEach(form => {
    form.oninput = () => { form.querySelector(".config-message").textContent = "Unsaved changes"; };
  });
  $$(".config-form").forEach(
    (form) =>
      (form.onsubmit = async (e) => {
        e.preventDefault();
        const message = form.querySelector(".config-message");
        const button = form.querySelector("button[type=submit]");
        if (button.disabled) return;
        button.disabled = true;
        try {
          const body = Object.fromEntries(new FormData(form));
          
          // Basic Client-Side Validation
          if (body.warning_max && body.critical_max && Number(body.warning_max) >= Number(body.critical_max)) {
            throw new Error("Warning max must be less than Critical max.");
          }
          if (body.warning_min && body.critical_min && Number(body.warning_min) <= Number(body.critical_min)) {
            throw new Error("Warning min must be greater than Critical min.");
          }
          if (body.warning_min && body.warning_max && Number(body.warning_min) >= Number(body.warning_max)) {
            throw new Error("Warning min must be less than Warning max.");
          }

          message.style.color = "var(--text-muted)";
          message.textContent = "Saving...";

          const result = await api("/api/config", {
            method: "PUT",
            body: JSON.stringify({
              parameter: form.dataset.parameter,
              ...body,
            }),
          });
          
          message.style.color = "var(--primary)";
          message.textContent = "Changes Saved Successfully";
          setTimeout(() => { if (message.textContent === "Changes Saved Successfully") message.textContent = ""; }, 3000);
          
          const saved = result.configuration;
          state.config = [...state.config.filter(row => row.parameter !== saved.parameter), saved];
          const labels = { temperature: "Temperature", voltage: "Voltage", frequency: "Frequency", fuel: "Fuel" };
          const units = { temperature: "°C", voltage: "V", frequency: "Hz", fuel: "%" };
          const values = saved.parameter === "temperature"
            ? "Warning ≥ " + saved.warning_max + "; critical ≥ " + saved.critical_max
            : saved.parameter === "fuel"
              ? "Warning ≤ " + saved.warning_min + "; critical ≤ " + saved.critical_min
              : "Warning outside " + saved.warning_min + "–" + saved.warning_max + "; critical outside " + saved.critical_min + "–" + saved.critical_max;
          showToast({
            title: labels[saved.parameter] + " thresholds saved",
            detail: values + " " + units[saved.parameter] + ". New readings submitted to the system will use these limits for alerts.",
            generator_name: "Configuration",
          });
        } catch (err) {
          message.style.color = "#a43d35";
          message.textContent = err.message || "Unable to save. Please try again.";
          showToast({
            title: "Configuration not saved",
            detail: err.message || "Failed to save configuration.",
            generator_name: "Configuration"
          });
        } finally { button.disabled = false; }
      }),
  );
}


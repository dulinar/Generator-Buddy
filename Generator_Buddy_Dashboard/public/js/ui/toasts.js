import { state } from "../state.js";
function playToastChime(isCritical) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.onended = () => ctx.close();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    if (isCritical) {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(440, now + 0.15);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else {
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.setValueAtTime(880, now + 0.1);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    }
  } catch {
    // Audio autoplay or permission restriction
  }
}

export function showToast({ title, detail, generator_name }, onOpen) {
  let region = document.querySelector("#toast-region");
  if (!region) {
    region = document.createElement("div");
    region.id = "toast-region";
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-label", "New notifications");
    document.body.append(region);
  }
  const isCritical = /\bcritical\b/i.test(`${title || ""} ${detail || ""}`);
  const isWarning = /\bwarning\b/i.test(`${title || ""} ${detail || ""}`);
  if (state.soundEnabled) playToastChime(isCritical);

  const toast = document.createElement("article");
  toast.className = `notification-toast ${isCritical ? "critical" : isWarning ? "warning" : ""}`;
  const heading = document.createElement("strong");
  heading.textContent = title;
  const body = document.createElement("p");
  body.textContent = [generator_name, detail].filter(Boolean).join(" · ");
  const close = document.createElement("button");
  close.className = "toast-close";
  close.setAttribute("aria-label", "Dismiss notification");
  close.textContent = "×";
  close.onclick = () => toast.remove();
  toast.append(heading, body, close);
  if (onOpen) {
    const open = document.createElement("button");
    open.className = "toast-open";
    open.textContent = "View notifications";
    open.onclick = () => { toast.remove(); onOpen(); };
    toast.append(open);
  }
  region.append(toast);
  while (region.children.length > 4) region.firstElementChild.remove();
  let timer = setTimeout(() => toast.remove(), 12000);
  toast.onmouseenter = toast.onfocusin = () => clearTimeout(timer);
  toast.onmouseleave = () => { timer = setTimeout(() => toast.remove(), 12000); };
}

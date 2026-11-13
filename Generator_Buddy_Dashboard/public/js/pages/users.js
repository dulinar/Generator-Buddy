import { escapeHtml as esc } from "../services/notification-view.js";
import { state } from "../state.js";
import { $, $$ } from "../icons.js";
import { api } from "../api.js";

export function users() {
  return `<div class="page-heading"><div><div class="eyebrow">Administration</div><h1>Users</h1><p>People who can manage or monitor generators.</p></div><button class="button" id="add-user">+ Add user</button></div><div class="panel table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead><tbody>${state.users.length ? state.users.map((u) => `<tr><td class="table-name">${esc(u.name)}</td><td>${esc(u.email)}</td><td><span class="status normal">${esc(u.role)}</span></td><td><button class="button secondary user-edit" data-id="${esc(u.user_id)}">Edit</button> <button class="button secondary user-delete" data-id="${esc(u.user_id)}">Delete</button></td></tr>`).join("") : `<tr><td colspan="4" class="empty">No users available.</td></tr>`}</tbody></table></div><dialog class="create-alert-modal" id="user-dialog" aria-labelledby="user-dialog-title"><div class="modal-inner">
 <div class="modal-header"><h2 id="user-dialog-title">Add User</h2><button type="button" class="icon-button" id="close-user-dialog" aria-label="Close dialog">×</button></div>
 <form id="user-form">
 <div class="field"><label for="user-name">Name</label><input id="user-name" name="name" required maxlength="100" autocomplete="name"></div>
 <div class="field"><label for="user-email">Email</label><input id="user-email" name="email" type="email" required maxlength="254" autocomplete="email"></div>
 <div class="field"><label for="user-role">Role</label><select id="user-role" name="role"><option value="viewer">Viewer · Read only</option><option value="operator">Operator · Assigned generators</option><option value="admin">Administrator · Full access</option></select></div>
 <div class="field" id="user-password-field"><label for="user-password">Password</label><input id="user-password" name="password" type="password" minlength="8" autocomplete="new-password"><small>At least 8 characters</small></div>
 <div class="field"><label for="user-generators">Assigned generators</label><select id="user-generators" name="generator_ids" multiple size="4"></select><small>Use Ctrl or Command to select multiple. Administrators can access all generators.</small></div><p class="error" id="user-error" role="alert"></p><div class="form-actions"><button type="button" class="button secondary" id="cancel-user-dialog">Cancel</button><button type="submit" class="button">Save user</button></div></form></div></dialog>`;
}

export function bindUsers(render) {
  if (state.user?.role !== "admin") return;
  const dialog = $("#user-dialog"), form = $("#user-form"), error = $("#user-error");
  let editing = null;
  function open(user = null) {
    editing = user;
    form.reset();
    error.textContent = "";
    $("#user-dialog-title").textContent = user ? "Edit User" : "Add User";
    form.elements.name.value = user?.name || "";
    form.elements.email.value = user?.email || "";
    form.elements.role.value = user?.role || "viewer";
    form.elements.password.required = !user;
    form.elements.password.disabled = Boolean(user);
    $("#user-password-field").hidden = Boolean(user);
    const assignments = new Set((user?.generator_ids || []).map(String));
    const select = $("#user-generators");
    select.replaceChildren(...state.generators.map(generator => {
      const option = new Option(generator.name, String(generator.generator_id));
      option.selected = assignments.has(String(generator.generator_id));
      return option;
    }));
    dialog.showModal();
    form.elements.name.focus();
  }
  $("#add-user").onclick = () => open();
  $("#close-user-dialog").onclick = $("#cancel-user-dialog").onclick = () => dialog.close();
  $$(".user-edit").forEach(button => { button.onclick = () => open(state.users.find(u => String(u.user_id) === button.dataset.id)); });
  $$(".user-delete").forEach(button => { button.onclick = async () => {
    if (!confirm("Delete this user?")) return;
    try { await api("/api/users/" + button.dataset.id, { method: "DELETE" }); await render(); }
    catch (err) { alert(err.message); }
  }; });
  form.onsubmit = async event => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    error.textContent = "";
    try {
      const body = Object.fromEntries(new FormData(form));
      body.generator_ids = Array.from($("#user-generators").selectedOptions, option => Number(option.value));
      await api("/api/users" + (editing ? "/" + editing.user_id : ""), {
        method: editing ? "PUT" : "POST", body: JSON.stringify(body)
      });
      dialog.close();
      await render();
    } catch (err) { error.textContent = err.message; }
    finally { submit.disabled = false; }
  };
}

/* Login layer UI (window.Auth): login card, session bar, home page, Users view (admin only).
   Logic lives in auth_core.js (FlexiAuth), storage in auth_store.js (AuthStore), seed credentials in auth_config.js.
   workspace.js calls Auth.route(view) before it switches views and Auth.shown(view) after, so every way into a
   view (menu, home buttons, links in other views, the address bar hash) passes the same check. */
(function () {
  "use strict";
  const F = window.FlexiAuth, S = window.AuthStore, CFG = window.FLEXI_AUTH_CONFIG;
  const el = id => document.getElementById(id);
  const h = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
  const note = (msg, bad) => { if (typeof toast === "function") toast(msg, bad ? "bad" : undefined); };
  const domReady = () => (document.readyState === "loading" ? new Promise(r => document.addEventListener("DOMContentLoaded", r, {once: true})) : Promise.resolve());
  const A = {user: null};
  const isAdmin = () => F.isAdminRecord(A.user, CFG);
  const ICON = {
    eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c4.97 0 8.9 3.18 9.94 6.65a1 1 0 0 1 0 .7 10.8 10.8 0 0 1-1.44 2.49"/><path d="M14.08 14.16a3 3 0 0 1-4.17-4.17"/><path d="M17.48 17.5A10.75 10.75 0 0 1 2.06 12.35a1 1 0 0 1 0-.7 10.8 10.8 0 0 1 4.45-5.14"/><path d="m2 2 20 20"/>',
    home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .71-1.53l7-6a2 2 0 0 1 2.58 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>'
  };
  const svg = (p, size) => `<svg viewBox="0 0 24 24" width="${size || 20}" height="${size || 20}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;

  // ---- logo: the build embeds flexitog/assets/brand/refrigiwear_logo.* as window.FLEXI_LOGO; until then a sized box
  function paintLogos() {
    document.querySelectorAll("[data-logo]").forEach(slot => {
      const big = slot.dataset.logo === "big";
      slot.innerHTML = window.FLEXI_LOGO ? `<img src="${h(window.FLEXI_LOGO)}" alt="RefrigiWear">`
        : big ? `<span class="logo-ph" role="img" aria-label="RefrigiWear logo">${svg(ICON.image, 28)}<span>RefrigiWear logo</span></span>` : "";
      slot.classList.toggle("has-img", !!window.FLEXI_LOGO);
    });
  }

  // ---- gate
  const setState = s => { document.documentElement.dataset.auth = s; };
  function showLogin() {
    setState("out");
    const f = el("authForm"); if (f) f.reset();
    loginError("");
    setPwVisible(false);
    const i = el("authIdent"); if (i) i.focus({preventScroll: true});
  }
  async function enter(user, view) {
    A.user = user;
    await domReady();
    el("authName").textContent = user.username;
    el("authRole").textContent = (F.ROLES.find(r => r[0] === user.role) || ["", ""])[1];
    document.querySelectorAll("[data-admin-only]").forEach(x => { x.hidden = !isAdmin(); });
    setState("in");
    if (typeof showView === "function") showView(view || "home");
    window.dispatchEvent(new Event("resize"));   // the map measures itself; it was hidden behind the login
  }
  async function logout() {
    await S.clearSession();
    A.user = null;
    document.querySelectorAll("dialog[open]").forEach(d => d.close());
    const m = el("menu"); if (m && !m.hidden && typeof openMenu === "function") openMenu(false);
    const uv = el("viewUsers"); if (uv) uv.innerHTML = "";
    document.querySelectorAll("[data-admin-only]").forEach(x => { x.hidden = true; });
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* sandboxed frame */ }
    showLogin();
  }

  // ---- login form
  function loginError(msg) { const e = el("authErr"); if (e) { e.textContent = msg; e.hidden = !msg; } }
  function setPwVisible(on) {
    const pw = el("authPw"), b = el("authPwToggle"); if (!pw || !b) return;
    pw.type = on ? "text" : "password";
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", on ? "Hide password" : "Show password");
    b.title = on ? "Hide password" : "Show password";
    b.innerHTML = svg(on ? ICON.eyeOff : ICON.eye, 18);
  }
  async function submitLogin(e) {
    e.preventDefault();
    const ident = el("authIdent").value, pw = el("authPw").value, btn = el("authSubmit");
    loginError(""); btn.disabled = true;
    try {
      const users = await S.getUsers(), u = F.findByLogin(users, ident);
      const ok = u ? await F.verify(u, pw) : (await F.hashPassword("no-user", pw), false);   // same work either way
      if (!ok) { await new Promise(r => setTimeout(r, 350)); loginError("The login details are not correct. Check them and try again."); el("authPw").select(); return; }
      if (u.status !== "active") { loginError("This account is disabled. Ask the administrator to enable it."); return; }
      await S.setSession({userId: u.id, username: u.username, role: u.role, loginAt: new Date().toISOString()});
      el("authPw").value = "";
      await enter(u, "home");
    } catch (err) { console.error(err); loginError("Logging in failed in this browser. Reload the page and try again."); }
    finally { btn.disabled = false; }
  }

  // ---- routing hooks for workspace.js showView
  function route(v) {
    if (!A.user) return "home";
    if (v === "users" && !isAdmin()) { note("The Users page is for the administrator only.", true); return "home"; }
    return v;
  }
  function shown(v) {
    try { if (location.hash !== "#" + v) history.replaceState(null, "", "#" + v); } catch (e) { /* sandboxed frame */ }
    if (v === "users") renderUsers();
  }
  window.addEventListener("hashchange", () => { if (A.user && typeof showView === "function") showView(location.hash.slice(1)); });

  // ---- dialog helper (one dialog for password display and confirmations)
  function dialog(title, bodyHtml, buttons) {
    const d = el("authDlg");
    d.innerHTML = `<form method="dialog" class="adlg"><h2>${h(title)}</h2><div class="adlg-body">${bodyHtml}</div>
      <div class="adlg-foot">${buttons.map((b, i) => `<button type="submit" value="${i}" class="btn${b.primary ? "" : " ghost"}${b.danger ? " danger" : ""}">${h(b.label)}</button>`).join("")}</div></form>`;
    return new Promise(res => {
      d.addEventListener("close", () => { const b = buttons[Number(d.returnValue)]; res(b ? b.value : null); }, {once: true});
      d.returnValue = ""; d.showModal();
    });
  }
  async function copyText(text, input) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* clipboard blocked in this frame */ }
    try { input.select(); return document.execCommand("copy"); } catch (e) { return false; }
  }
  // Shows a new password once. It is not stored anywhere in plain text, so closing the dialog loses it.
  function showPassword(user, password, what) {
    const d = el("authDlg");
    const p = dialog(what, `<p>Give this password to <b>${h(user.username)}</b>. It is shown once. After you close this window only its hash is kept.</p>
      <div class="pwshow"><input type="text" id="authNewPw" class="num" readonly value="${h(password)}" aria-label="New password"><button type="button" class="btn" id="authCopy">Copy</button></div>
      <p class="faint" id="authCopyMsg" aria-live="polite"></p>`, [{label: "Done", value: true, primary: true}]);
    const inp = d.querySelector("#authNewPw"); inp.focus(); inp.select();
    d.querySelector("#authCopy").addEventListener("click", async () => {
      const ok = await copyText(password, inp);
      d.querySelector("#authCopyMsg").textContent = ok ? "Copied to the clipboard." : "Copy is blocked here. Select the password and press Ctrl+C.";
    });
    return p;
  }

  // ---- Users view (admin only)
  const UI = {draft: {username: "", email: "", role: "editor", permissions: F.allPermissions()}, errors: {}};
  const day = iso => String(iso || "").slice(0, 10);
  async function renderUsers() {
    const box = el("viewUsers"); if (!box) return;
    if (!isAdmin()) { box.innerHTML = ""; return; }
    const users = (await S.getUsers()).sort((a, b) => (a.role === "admin" ? -1 : b.role === "admin" ? 1 : String(a.created).localeCompare(String(b.created))));
    const d = UI.draft, err = UI.errors;
    const fld = (key, label, input) => `<div class="fld${err[key] ? " bad" : ""}"><label for="auF_${key}">${label}</label>${input}<span class="err" id="auE_${key}">${h(err[key] || "")}</span></div>`;
    box.innerHTML = `<div class="ausers">
      <div class="card">
        <div class="cardhead"><h2>Users</h2>
          <div class="bacts"><button type="button" class="btn ghost" data-u="export">Export users</button>
            <label class="btn ghost filebtn">Import users<input type="file" id="auImport" accept=".json,application/json" aria-label="Import users from JSON"></label></div></div>
        <p class="muted" style="font-size:13px">${users.length} account${users.length === 1 ? "" : "s"}, saved in ${h(S.where())}. Roles and permissions are recorded on each user and not enforced yet. The export file holds password hashes, so keep it private.</p>
        <div class="tablewrap"><table class="autable"><thead><tr><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th><span class="faint">Actions</span></th></tr></thead><tbody>
        ${users.map(u => { const adm = u.role === "admin";
          return `<tr data-id="${h(u.id)}"><td><b>${h(u.username)}</b>${u.id === A.user.id ? ' <span class="tag">you</span>' : ""}<br><span class="faint num">${h(u.id)}</span></td>
            <td>${h(u.email)}</td><td>${h((F.ROLES.find(r => r[0] === u.role) || ["", u.role])[1])}</td>
            <td><span class="ust ${u.status === "active" ? "on" : "off"}">${u.status === "active" ? "Active" : "Disabled"}</span></td>
            <td class="num">${h(day(u.created))}</td>
            <td><div class="bacts"><button type="button" class="btn ghost sm" data-u="reset">Reset password</button>
              <button type="button" class="btn ghost sm" data-u="toggle"${adm ? ' disabled title="The admin account stays active"' : ""}>${u.status === "active" ? "Disable" : "Enable"}</button>
              <button type="button" class="btn ghost sm danger" data-u="delete"${adm ? ' disabled title="The admin account cannot be deleted"' : ""}>Delete</button></div></td></tr>`; }).join("")}
        </tbody></table></div>
      </div>
      <form class="card" id="auForm" novalidate>
        <div class="cardhead"><h2>Add user</h2><span class="faint" style="font-size:12px">A random 14-character password is created and shown once.</span></div>
        <div class="augrid">
          ${fld("username", "Username", `<input type="text" id="auF_username" autocomplete="off" spellcheck="false" value="${h(d.username)}" aria-describedby="auE_username">`)}
          ${fld("email", "Email", `<input type="email" id="auF_email" autocomplete="off" spellcheck="false" value="${h(d.email)}" aria-describedby="auE_email">`)}
          ${fld("role", "Role", `<select id="auF_role" aria-describedby="auE_role">${F.ROLES.filter(r => r[0] !== "admin").map(([k, l]) => `<option value="${k}"${d.role === k ? " selected" : ""}>${l}</option>`).join("")}</select>`)}
          <div class="fld full"><span class="flab">Permissions</span><div class="mchecks" role="group" aria-label="Permissions">
            ${F.PERMISSIONS.map(([k, l]) => `<label><input type="checkbox" name="auPerm" value="${k}"${d.permissions[k] ? " checked" : ""}> ${l}</label>`).join("")}</div></div>
        </div>
        <div class="aufoot"><span class="ferr" id="auFormErr"></span><button type="submit" class="btn">Add user</button></div>
      </form></div>`;
    const sync = () => { d.username = el("auF_username").value; d.email = el("auF_email").value; d.role = el("auF_role").value;
      d.permissions = Object.fromEntries(F.PERMISSIONS.map(([k]) => [k, !!box.querySelector(`input[name="auPerm"][value="${k}"]`).checked])); };
    box.querySelector("#auForm").addEventListener("input", sync);
    box.querySelector("#auForm").addEventListener("submit", async e => { e.preventDefault(); sync(); await addUser(); });
    box.querySelector('[data-u="export"]').addEventListener("click", exportUsers);
    el("auImport").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) importUsers(f); });
    box.querySelector(".autable tbody").addEventListener("click", e => {
      const b = e.target.closest("button[data-u]"); if (!b || b.disabled) return;
      const id = b.closest("tr").dataset.id;
      if (b.dataset.u === "reset") resetUser(id); else if (b.dataset.u === "toggle") toggleUser(id); else if (b.dataset.u === "delete") deleteUserUi(id);
    });
  }
  async function addUser() {
    if (!isAdmin()) return;
    const users = await S.getUsers(), r = await F.createUser(UI.draft, users, CFG);
    UI.errors = r.errors || {};
    if (r.errors) { await renderUsers(); const first = Object.keys(r.errors)[0]; const f = el("auF_" + first); if (f) f.focus(); return; }
    await S.saveUser(r.user);
    UI.draft = {username: "", email: "", role: "editor", permissions: F.allPermissions()};
    await renderUsers();
    await showPassword(r.user, r.password, "User created");
  }
  async function resetUser(id) {
    if (!isAdmin()) return;
    const u = await S.getUser(id); if (!u) return;
    const go = await dialog("Reset password", `<p>Create a new password for <b>${h(u.username)}</b>? The current password stops working.</p>`,
      [{label: "Cancel", value: false}, {label: "Reset password", value: true, primary: true}]);
    if (!go) return;
    const r = await F.resetPassword(u); await S.saveUser(r.user);
    if (u.id === A.user.id) A.user = r.user;
    await renderUsers();
    await showPassword(r.user, r.password, "New password");
  }
  async function toggleUser(id) {
    if (!isAdmin()) return;
    const u = await S.getUser(id); if (!u || u.role === "admin") return;
    u.status = u.status === "active" ? "disabled" : "active"; u.updated = new Date().toISOString();
    await S.saveUser(u); await renderUsers();
    note(`${u.username} is ${u.status === "active" ? "enabled" : "disabled"}`);
  }
  async function deleteUserUi(id) {
    if (!isAdmin()) return;
    const u = await S.getUser(id); if (!u || u.role === "admin") return;
    const go = await dialog("Delete user", `<p>Delete <b>${h(u.username)}</b> (${h(u.email)})? The account and its password are removed. This cannot be undone.</p>`,
      [{label: "Cancel", value: false, primary: true}, {label: "Delete user", value: true, danger: true}]);
    if (!go) return;
    await S.deleteUser(id); await renderUsers(); note(`${u.username} deleted`);
  }
  async function exportUsers() {
    if (!isAdmin()) return;
    const users = await S.getUsers(), date = new Date().toISOString().slice(0, 10);
    if (typeof saveFile === "function") saveFile(`FlexiTog_users_${date}.json`, JSON.stringify(F.exportFile(users), null, 2));
  }
  async function importUsers(file) {
    if (!isAdmin()) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { note("This file is not valid JSON.", true); return; }
    const plan = F.planImport(data, await S.getUsers(), CFG);
    if (plan.error) { note(plan.error, true); return; }
    for (const u of plan.save) await S.saveUser(u);
    await renderUsers();
    const msg = `${plan.added} added, ${plan.updated} updated${plan.skipped.length ? `, ${plan.skipped.length} skipped` : ""}`;
    if (plan.skipped.length) await dialog("Users imported", `<p>${h(msg)}.</p><ul class="bfind">${plan.skipped.map(s => `<li>${h(s)}</li>`).join("")}</ul>`, [{label: "Close", value: true, primary: true}]);
    else note("Users imported: " + msg);
  }

  // ---- start
  async function init() {
    paintLogos();
    el("authForm").addEventListener("submit", submitLogin);
    el("authPwToggle").addEventListener("click", () => setPwVisible(el("authPw").type === "password"));
    el("authLogout").addEventListener("click", logout);
    document.addEventListener("click", e => { const g = e.target.closest("[data-home-go]"); if (g && A.user && typeof showView === "function") { e.preventDefault(); showView(g.dataset.homeGo); } });
    try {
      let users = await S.getUsers();
      const fix = F.ensureAdmin(users, CFG);
      for (const u of fix) await S.saveUser(u);
      if (fix.length) users = await S.getUsers();
      const s = await S.getSession(), u = s && users.find(x => x.id === s.userId && x.status === "active");
      if (u) { await domReady(); await enter(u, location.hash.slice(1) || "home"); }
      else { if (s) await S.clearSession(); showLogin(); }
    } catch (e) { console.error(e); showLogin(); }
  }
  window.Auth = {route, shown, isAdmin, logout, user: () => (A.user ? Object.assign({}, A.user, {salt: undefined, passwordHash: undefined}) : null),
    permits: view => F.permits(A.user, view)};
  init();
})();

/* Login layer logic without DOM or storage (window.FlexiAuth). Tested in tests/test_auth.py.
   Password hash: hex(SHA-256(UTF-8(salt + password))) with a random 16-byte hex salt per user (Web Crypto API).
   User record: {id, username, email, role, permissions{view: bool}, status, created, updated,
   salt, passwordHash, algorithm, passwordSet, seededFrom (admin only)}.
   Roles and permissions are saved on every user but not enforced yet: permits() is the hook for that. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api; else root.FlexiAuth = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";
  const C = root.crypto || (typeof globalThis !== "undefined" ? globalThis.crypto : null);
  const ALGORITHM = "sha256-salted-v1";
  // Permission keys are the view ids in workspace.js (VIEWS), labels as on the home page.
  const PERMISSIONS = [["dash", "Route Dashboard"], ["forecast", "Forecast"], ["landed", "Landed Cost"], ["bench", "Benchmarking"], ["report", "Report Extract"], ["md", "Master Data Upload"]];
  const ROLES = [["admin", "Admin"], ["editor", "Editor"], ["viewer", "Viewer"]];
  const STATUSES = [["active", "Active"], ["disabled", "Disabled"]];
  const allPermissions = () => Object.fromEntries(PERMISSIONS.map(([k]) => [k, true]));

  const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
  async function hashPassword(salt, password) {
    const data = new TextEncoder().encode(String(salt) + String(password));
    return hex(await C.subtle.digest("SHA-256", data));
  }
  const newSalt = () => hex(C.getRandomValues(new Uint8Array(16)));

  // Unbiased random integer in [0, n): rejection sampling on 32-bit values.
  function randomInt(n) {
    const lim = Math.floor(0x100000000 / n) * n, b = new Uint32Array(1);
    do C.getRandomValues(b); while (b[0] >= lim);
    return b[0] % n;
  }
  // 14 characters with at least one upper, lower, digit and symbol. Look-alikes (I l O 0 1) left out.
  const SETS = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%&*+-=?_"];
  function randomPassword(len) {
    len = Math.max(len || 14, SETS.length);
    const all = SETS.join(""), out = SETS.map(s => s[randomInt(s.length)]);
    while (out.length < len) out.push(all[randomInt(all.length)]);
    for (let i = out.length - 1; i > 0; i--) { const j = randomInt(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
    return out.join("");
  }
  const classesOf = pw => SETS.map(s => [...pw].some(ch => s.includes(ch)));

  const lc = v => String(v == null ? "" : v).trim().toLowerCase();
  const validEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || "").trim());
  const validUsername = v => /^[A-Za-z0-9._-]{3,32}$/.test(String(v || "").trim());
  const isAdminRecord = (u, cfg) => !!u && !!cfg && u.id === cfg.admin.id && u.role === "admin";

  // Login by username or email, case does not matter. Returns the record or null.
  function findByLogin(users, ident) {
    const k = lc(ident);
    if (!k) return null;
    return users.find(u => lc(u.username) === k || lc(u.email) === k) || null;
  }
  async function verify(user, password) {
    if (!user || !user.salt || !user.passwordHash) return false;
    return (await hashPassword(user.salt, password)) === user.passwordHash;
  }
  function nextId(users) {
    const n = users.map(u => /^USR-(\d+)$/.exec(u.id || "")).filter(Boolean).map(m => Number(m[1]));
    return "USR-" + String((n.length ? Math.max(...n) : 0) + 1).padStart(4, "0");
  }

  // Field errors for a new or edited user: unique username and email, valid email, no second admin.
  function validateUser(input, users, cfg) {
    const e = {}, others = users.filter(u => u.id !== input.id);
    if (!validUsername(input.username)) e.username = "Use 3 to 32 letters, digits, dots, dashes or underscores.";
    else if (others.some(u => lc(u.username) === lc(input.username) || lc(u.email) === lc(input.username))) e.username = "This username is taken.";
    if (!validEmail(input.email)) e.email = "Enter a valid email address.";
    else if (others.some(u => lc(u.email) === lc(input.email) || lc(u.username) === lc(input.email))) e.email = "This email belongs to another user.";
    if (!ROLES.some(([k]) => k === input.role)) e.role = "Pick a role.";
    else if (input.role === "admin" && !(cfg && input.id === cfg.admin.id)) e.role = "There is one admin account only.";
    return e;
  }

  async function createUser(input, users, cfg, now) {
    const password = randomPassword(14), salt = newSalt(), ts = now || new Date().toISOString();
    const perms = Object.fromEntries(PERMISSIONS.map(([k]) => [k, !!(input.permissions && input.permissions[k])]));
    const user = { id: nextId(users), username: String(input.username).trim(), email: String(input.email).trim().toLowerCase(), role: input.role,
      permissions: perms, status: "active", created: ts, updated: ts, salt, passwordHash: await hashPassword(salt, password), algorithm: ALGORITHM, passwordSet: ts };
    const errors = validateUser(user, users, cfg);
    return Object.keys(errors).length ? { errors } : { user, password };
  }
  async function resetPassword(user, now) {
    const password = randomPassword(14), salt = newSalt(), ts = now || new Date().toISOString();
    return { user: Object.assign({}, user, { salt, passwordHash: await hashPassword(salt, password), algorithm: ALGORITHM, passwordSet: ts, updated: ts }), password };
  }

  // Records to write so storage holds exactly one admin, the one in auth_config.js.
  // A new passwordHash in the config replaces the stored admin password (seededFrom tracks it).
  function ensureAdmin(users, cfg, now) {
    const a = cfg.admin, ts = now || new Date().toISOString(), save = [];
    const cur = users.find(u => u.id === a.id);
    if (!cur) save.push({ id: a.id, username: a.username, email: a.email.toLowerCase(), role: "admin", permissions: allPermissions(), status: "active",
      created: a.created, updated: ts, salt: a.salt, passwordHash: a.passwordHash, algorithm: cfg.algorithm || ALGORITHM, passwordSet: a.created, seededFrom: a.passwordHash });
    else {
      const fix = Object.assign({}, cur, { role: "admin", status: "active", permissions: allPermissions() });
      if (cur.seededFrom !== a.passwordHash) Object.assign(fix, { salt: a.salt, passwordHash: a.passwordHash, seededFrom: a.passwordHash, passwordSet: ts });
      if (JSON.stringify(fix) !== JSON.stringify(cur)) save.push(Object.assign(fix, { updated: ts }));
    }
    users.filter(u => u.id !== a.id && u.role === "admin").forEach(u => save.push(Object.assign({}, u, { role: "editor", updated: ts })));
    return save;
  }

  // Import from an Export users file: merge by id, keep the one admin, skip clashes. Returns records to write.
  function planImport(data, users, cfg) {
    const out = { save: [], added: 0, updated: 0, skipped: [] };
    const list = data && data.format === "flexitog-users" && Array.isArray(data.users) ? data.users : null;
    if (!list) { out.error = "This is not an Export users file."; return out; }
    const work = users.slice();
    list.forEach(raw => {
      const u = Object.assign({}, raw), label = u.username || u.email || u.id || "(no name)";
      if (!u.id || !u.salt || !u.passwordHash) { out.skipped.push(label + ": no id or password hash"); return; }
      if (u.id === cfg.admin.id) {   // the admin keeps id, name, role and status; only a newer password comes across
        const cur = work.find(x => x.id === u.id);
        if (cur && u.passwordHash !== cur.passwordHash && (u.passwordSet || "") > (cur.passwordSet || "")) {
          const next = Object.assign({}, cur, { salt: u.salt, passwordHash: u.passwordHash, passwordSet: u.passwordSet, updated: new Date().toISOString() });
          out.save.push(next); work[work.indexOf(cur)] = next; out.updated++;
        }
        return;
      }
      if (u.role === "admin") u.role = "editor";
      u.status = u.status === "disabled" ? "disabled" : "active";
      u.permissions = Object.fromEntries(PERMISSIONS.map(([k]) => [k, !!(u.permissions && u.permissions[k])]));
      const errs = validateUser(u, work, cfg);
      if (Object.keys(errs).length) { out.skipped.push(label + ": " + Object.values(errs)[0]); return; }
      const i = work.findIndex(x => x.id === u.id);
      if (i >= 0) { work[i] = u; out.updated++; } else { work.push(u); out.added++; }
      out.save.push(u);
    });
    return out;
  }
  const exportFile = (users, now) => ({ format: "flexitog-users", version: 1, exported: now || new Date().toISOString(), algorithm: ALGORITHM, users });

  // Hook for later enforcement. Today every logged-in user sees every view except Users.
  const permits = (user, view) => !!user && (user.role === "admin" || !!(user.permissions && user.permissions[view]));

  return { ALGORITHM, PERMISSIONS, ROLES, STATUSES, allPermissions, hashPassword, newSalt, randomInt, randomPassword, classesOf, validEmail, validUsername,
    isAdminRecord, findByLogin, verify, nextId, validateUser, createUser, resetPassword, ensureAdmin, planImport, exportFile, permits };
});

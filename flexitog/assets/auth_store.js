/* User and session storage for the login layer. No other file reads or writes users or sessions:
   swap the bodies below for shared storage or a backend and nothing else changes.
   Every function returns a Promise, so a remote store fits the same calls.
   Now: users in localStorage under one key as JSON, the session in sessionStorage (closing the tab logs out).
   When the browser blocks storage (private window, preview frame) both fall back to memory for this page load. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api; else root.AuthStore = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";
  const USERS_KEY = "flexitog-auth-v1:users";
  const SESSION_KEY = "flexitog-auth-v1:session";
  const mem = {};
  const area = name => { try { const s = root[name]; s.getItem("x"); return s; } catch (e) { return null; } };
  const read = (name, key) => {
    const s = area(name);
    try { const raw = s ? s.getItem(key) : mem[name + key]; return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  };
  const write = (name, key, value) => {
    const raw = value == null ? null : JSON.stringify(value), s = area(name);
    try {
      if (s) { if (raw == null) s.removeItem(key); else s.setItem(key, raw); return; }
    } catch (e) { if (e && e.name === "QuotaExceededError") throw new Error("This browser's storage is full."); }
    if (raw == null) delete mem[name + key]; else mem[name + key] = raw;
  };
  const copy = v => JSON.parse(JSON.stringify(v));
  const list = () => { const u = read("localStorage", USERS_KEY); return Array.isArray(u) ? u : []; };

  async function getUsers() { return copy(list()); }
  async function getUser(id) { const u = list().find(x => x.id === id); return u ? copy(u) : null; }
  // Insert or replace by id.
  async function saveUser(user) {
    if (!user || !user.id) throw new Error("A user needs an id.");
    const all = list(), i = all.findIndex(x => x.id === user.id);
    if (i >= 0) all[i] = copy(user); else all.push(copy(user));
    write("localStorage", USERS_KEY, all);
    return copy(user);
  }
  async function deleteUser(id) {
    const all = list(), next = all.filter(x => x.id !== id);
    write("localStorage", USERS_KEY, next);
    return next.length !== all.length;
  }
  async function getSession() { return read("sessionStorage", SESSION_KEY); }
  async function setSession(session) { write("sessionStorage", SESSION_KEY, session); return copy(session); }
  async function clearSession() { write("sessionStorage", SESSION_KEY, null); }
  const where = () => (area("localStorage") ? "this browser (localStorage)" : "memory only, lost on reload");

  return { getUsers, getUser, saveUser, deleteUser, getSession, setSession, clearSession, where, USERS_KEY, SESSION_KEY };
});

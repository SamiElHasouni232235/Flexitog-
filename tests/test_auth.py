"""Login layer: hashing, random passwords, validation, the single admin, import and the storage module.
Runs auth_core.js and auth_store.js in node (Web Crypto is built in). The real admin password is never in
this file: the seed hash is checked for shape only, the formula against Python's hashlib."""
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from flexitog.dashboard import ASSETS

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")


def run(body: str):
    """Run async JS with A (auth_core), S (auth_store with in-memory localStorage/sessionStorage), CFG (seed config)."""
    src = ("""
const mk = () => { const m = new Map(); return {getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m}; };
globalThis.localStorage = mk(); globalThis.sessionStorage = mk(); globalThis.window = globalThis; globalThis.self = globalThis;
const A = require(process.argv[1]), S = require(process.argv[2]);
require(process.argv[3]); const CFG = globalThis.FLEXI_AUTH_CONFIG;
(async () => {
""" + body + "\nconsole.log(JSON.stringify(out));\n})().catch(e => { console.error(e); process.exit(1); });")
    res = subprocess.run([NODE, "-e", src, str(ASSETS / "auth_core.js"), str(ASSETS / "auth_store.js"), str(ASSETS / "auth_config.js")],
                         capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def test_hash_matches_salted_sha256():
    out = run("const out = {h: await A.hashPassword('a1b2', 'Pässword.1'), salt: A.newSalt()};")
    assert out["h"] == hashlib.sha256(("a1b2" + "Pässword.1").encode("utf-8")).hexdigest()
    assert re.fullmatch(r"[0-9a-f]{32}", out["salt"])


def test_seed_config_holds_hash_only():
    out = run("const out = CFG;")
    a = out["admin"]
    assert a["username"] == "Sami" and a["email"] == "s.hassouni@fresh-brains.com" and a["role"] == "admin"
    assert re.fullmatch(r"[0-9a-f]{64}", a["passwordHash"]) and re.fullmatch(r"[0-9a-f]{32}", a["salt"])
    assert set(a) == {"id", "username", "email", "role", "salt", "passwordHash", "created"}   # no plain password field


def test_random_passwords():
    out = run("const out = Array.from({length: 300}, () => A.randomPassword(14)).map(p => [p, A.classesOf(p)]);")
    pws = [p for p, _ in out]
    assert all(len(p) == 14 for p in pws) and all(all(c) for _, c in out)
    assert len(set(pws)) == len(pws)
    assert not any(ch in p for p in pws for ch in "Il1O0")


def test_validation_and_single_admin():
    out = run("""
const users = A.ensureAdmin([], CFG, '2026-10-14T00:00:00Z');
const v = x => A.validateUser(Object.assign({id: 'USR-0009', username: 'anna', email: 'anna@example.com', role: 'editor'}, x), users, CFG);
const out = {seed: users.length, ok: v({}), dupUser: v({username: 'SAMI'}), dupEmail: v({email: 'S.Hassouni@fresh-brains.com'}), badEmail: v({email: 'anna@x'}),
  badName: v({username: 'a b'}), admin2: v({role: 'admin'}), adminSelf: A.validateUser(users[0], users, CFG),
  login1: (A.findByLogin(users, ' sami ') || {}).id, login2: (A.findByLogin(users, 'S.HASSOUNI@FRESH-BRAINS.COM') || {}).id, login3: A.findByLogin(users, 'nobody'),
  again: A.ensureAdmin(users, CFG, '2026-10-15T00:00:00Z').length,
  demote: A.ensureAdmin(users.concat([{id: 'USR-0002', username: 'x', email: 'x@example.com', role: 'admin'}]), CFG).map(u => [u.id, u.role]),
  rotated: A.ensureAdmin([Object.assign({}, users[0], {seededFrom: 'old', passwordHash: 'old'})], CFG).map(u => u.passwordHash === CFG.admin.passwordHash)};
""")
    assert out["seed"] == 1 and out["ok"] == {}
    assert "username" in out["dupUser"] and "email" in out["dupEmail"] and "email" in out["badEmail"] and "username" in out["badName"]
    assert out["admin2"] == {"role": "There is one admin account only."} and out["adminSelf"] == {}
    assert out["login1"] == "USR-0001" and out["login2"] == "USR-0001" and out["login3"] is None
    assert out["again"] == 0                                 # nothing to fix once seeded
    assert out["demote"] == [["USR-0002", "editor"]]         # a second admin in storage is demoted
    assert out["rotated"] == [True]                          # a new hash in the config replaces the stored one


def test_create_reset_verify():
    out = run("""
const users = A.ensureAdmin([], CFG);
const c = await A.createUser({username: 'planner', email: 'Planner@Example.com', role: 'viewer', permissions: {dash: true, md: false}}, users, CFG);
const r = await A.resetPassword(c.user);
const out = {id: c.user.id, email: c.user.email, perms: c.user.permissions, status: c.user.status, keys: Object.keys(c.user).sort(), plain: JSON.stringify(c.user).includes(c.password),
  ok: await A.verify(c.user, c.password), wrong: await A.verify(c.user, c.password + 'x'), oldAfterReset: await A.verify(r.user, c.password), newAfterReset: await A.verify(r.user, r.password),
  dup: (await A.createUser({username: 'sami', email: 'n@example.com', role: 'editor'}, users, CFG)).errors, permitsMd: A.permits(c.user, 'md'), permitsDash: A.permits(c.user, 'dash')};
""")
    assert out["id"] == "USR-0002" and out["email"] == "planner@example.com" and out["status"] == "active"
    assert out["perms"] == {"dash": True, "forecast": False, "bench": False, "report": False, "md": False}
    assert "password" not in out["keys"] and not out["plain"]
    assert out["ok"] and not out["wrong"] and not out["oldAfterReset"] and out["newAfterReset"]
    assert "username" in out["dup"]
    assert out["permitsDash"] and not out["permitsMd"]


def test_import_merges_and_keeps_one_admin():
    out = run("""
const users = A.ensureAdmin([], CFG);
const c = await A.createUser({username: 'planner', email: 'p@example.com', role: 'editor', permissions: {}}, users, CFG);
const file = A.exportFile(users.concat([c.user, {id: 'USR-0007', username: 'boss', email: 'b@example.com', role: 'admin', salt: 'aa', passwordHash: 'bb'},
  {id: 'USR-0008', username: 'Sami', email: 'z@example.com', role: 'viewer', salt: 'aa', passwordHash: 'bb'}, {username: 'nohash'}]));
const plan = A.planImport(JSON.parse(JSON.stringify(file)), users, CFG);
const out = {added: plan.added, updated: plan.updated, skipped: plan.skipped.length, roles: plan.save.map(u => [u.id, u.role]), bad: A.planImport({x: 1}, users, CFG).error};
""")
    assert out["added"] == 2 and out["updated"] == 0 and out["skipped"] == 2
    assert out["roles"] == [["USR-0002", "editor"], ["USR-0007", "editor"]]   # imported admin demoted, name clash skipped
    assert out["bad"]


def test_store_module_round_trip():
    out = run("""
await S.saveUser({id: 'USR-0001', username: 'a'}); await S.saveUser({id: 'USR-0002', username: 'b'}); await S.saveUser({id: 'USR-0002', username: 'b2'});
const before = await S.getUsers(); const del = await S.deleteUser('USR-0001'); const after = await S.getUsers();
await S.setSession({userId: 'USR-0002'}); const s1 = await S.getSession(); await S.clearSession(); const s2 = await S.getSession();
const out = {before: before.map(u => u.username), del, after: after.map(u => u.id), s1, s2, raw: JSON.parse(localStorage.getItem(S.USERS_KEY)).length,
  keys: [...localStorage._m.keys()], sessKeys: [...sessionStorage._m.keys()]};
""")
    assert out["before"] == ["a", "b2"] and out["del"] is True and out["after"] == ["USR-0002"]
    assert out["s1"] == {"userId": "USR-0002"} and out["s2"] is None
    assert out["raw"] == 1 and out["keys"] == ["flexitog-auth-v1:users"] and out["sessKeys"] == []


def test_only_the_store_touches_user_and_session_storage():
    others = [p for p in ASSETS.glob("*.js") if p.name != "auth_store.js"] + [ASSETS / "dashboard.html"]
    for p in others:
        text = p.read_text(encoding="utf-8")
        assert "flexitog-auth" not in text, p.name
        if p.name.startswith("auth"):
            assert "localStorage" not in text and "sessionStorage" not in text, p.name


def test_logo_file_is_embedded(tmp_path, monkeypatch):
    import flexitog.dashboard as D
    monkeypatch.setattr(D, "LOGO_DIR", tmp_path)
    assert D.logo_data_uri() is None
    (tmp_path / "refrigiwear_logo.png").write_bytes(b"\x89PNG")
    assert D.logo_data_uri().startswith("data:image/png;base64,")
    (tmp_path / "logo.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"/>')
    assert D.logo_data_uri().startswith("data:image/svg+xml;base64,")   # logo.* wins
    assert (ASSETS / "brand" / "logo.jpg").is_file()

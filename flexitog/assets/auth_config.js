/* Seed credentials for the login layer. This is the only place they live.
   The admin password is never stored in plain text: passwordHash = hex(SHA-256(UTF-8(salt + password))),
   checked with the Web Crypto API at login (auth_core.js, hashPassword).
   To change the seed password, compute a new salt and hash with the same formula and replace both values.
   The stored admin record follows this file when passwordHash changes here (auth.js, ensureAdmin). */
window.FLEXI_AUTH_CONFIG = Object.freeze({
  algorithm: "sha256-salted-v1",
  admin: Object.freeze({
    id: "USR-0001",
    username: "Sami",
    email: "s.hassouni@fresh-brains.com",
    role: "admin",
    salt: "e0ddba06f94817116293a2d36dcc1847",
    passwordHash: "6e38df1f179a11efd6643fb7a754ed85e933b97748002c162587d5c4a626f5d0",
    created: "2026-10-14T00:00:00Z"
  })
});

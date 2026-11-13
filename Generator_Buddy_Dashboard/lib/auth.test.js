import test from "node:test";
import assert from "node:assert/strict";
import { readSession, signSession, secureEqual } from "./auth.js";
function request(user) {
  const payload = Buffer.from(JSON.stringify(user)).toString("base64url");
  return { headers: { cookie: "navodya_session=" + payload + "." + signSession(payload) } };
}
test("sessions require expiry and reject malformed cookies and signatures", () => {
  assert.equal(readSession(request({ id: 1, role: "admin" })), null);
  assert.equal(readSession(request({ id: 1, role: "admin", expiresAt: Date.now() - 1 })), null);
  assert.equal(readSession(request({ id: 1, role: "admin", expiresAt: Date.now() + 60000 })).id, 1);
  assert.equal(readSession({ headers: { cookie: "navodya_session=%ZZ" } }), null);
  assert.equal(secureEqual("arbitrary", undefined), false);
  assert.equal(secureEqual("wrong", "secret"), false);
  assert.equal(secureEqual("secret", "secret"), true);
});

import notifications from "./notifications.js";
import protocols from "./protocols.js";
import maintenance from "./maintenance.js";
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import generators from "./generators.js";
import users from "./users.js";
import { pool } from "../lib/db.js";
test("API rejects arbitrary keys, scopes telemetry, and keeps polling read-only", async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { user: req.headers["test-role"] ? { id: 7, role: req.headers["test-role"] } : null }; next(); });
  app.use(generators, users, notifications, protocols, maintenance);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const originalQuery = pool.query;
  const queries = [];
  pool.query = async sql => { queries.push(sql); return sql.includes("generator_readings") ? [[{ temperature: 100 }]] : [[]]; };
  try {
    assert.equal((await fetch(base + "/api/generators/1/readings", { method: "POST", headers: { "x-api-key": "arbitrary" } })).status, 401);
    assert.equal((await fetch(base + "/api/users", { headers: { "test-role": "viewer" } })).status, 403);
    assert.equal((await fetch(base + "/api/generators/1/latest", { headers: { "test-role": "viewer" } })).status, 403);
    for (const [path, method, role] of [
      ["/api/notifications/1/resolve", "POST", "viewer"],
      ["/api/notifications/1", "DELETE", "operator"],
      ["/api/notifications/clear-resolved", "POST", "operator"],
      ["/api/service-protocols/oil-service", "PUT", "operator"],
      ["/api/maintenance", "POST", "viewer"],
      ["/api/users", "POST", "operator"]
    ]) assert.equal((await fetch(base + path, { method, headers: { "test-role": role } })).status, 403, path);
    queries.length = 0;
    assert.equal((await fetch(base + "/api/generators/1/latest", { headers: { "test-role": "admin" } })).status, 200);
    assert.equal(queries.length, 1);
    assert.ok(queries[0].startsWith("SELECT"));
  } finally {
    pool.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "./db.js";
import { pollReadingAlerts } from "./alert-monitor.js";

test("direct database readings and changed configuration are evaluated once with a durable cursor", async t => {
  let cursor = null, latest = { reading_id: 1, fresh: 1, temperature: 80 };
  let limit = 75;
  const events = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {},
    async query(sql, args = []) {
      if (sql.includes("FROM generators")) return [[{ generator_id: 1 }]];
      if (sql.includes("FROM maintenance_config")) return [[{ parameter: "temperature", warning_max: limit, critical_max: 95, enabled: 1 }]];
      if (sql.includes("FROM telemetry_alert_cursor")) return [cursor ? [cursor] : []];
      if (sql.includes("FROM generator_readings")) return [[latest].filter(r => !sql.includes("reading_id>?") || r.reading_id > args[1])];
      if (sql.startsWith("INSERT INTO telemetry_alert_cursor")) { cursor = { reading_id: args[1], config_digest: args[2] }; return [{}]; }
      if (sql.includes("SELECT notification_id")) return [[]];
      if (sql.startsWith("INSERT INTO notifications")) { events.push(args[2]); return [{}]; }
      if (sql.startsWith("UPDATE notifications")) { events.push("resolved"); return [{}]; }
      throw Error(sql);
    }
  };
  t.mock.method(pool, "query", async () => [[{ generator_id: 1 }]]);
  t.mock.method(pool, "getConnection", async () => connection);
  await pollReadingAlerts();
  assert.match(events[0], /warning/);
  await pollReadingAlerts();
  assert.equal(events.length, 1, "same reading must not recreate dismissed alerts");
  limit = 85;
  await pollReadingAlerts();
  assert.equal(events.at(-1), "resolved");
  latest = { ...latest, reading_id: 2, temperature: 100 };
  await pollReadingAlerts();
  assert.match(events.at(-1), /critical/);
  const count = events.length;
  latest = { ...latest, reading_id: 3, fresh: 0 };
  await pollReadingAlerts();
  assert.equal(events.length, count, "stale measurements must not generate new alerts");
});

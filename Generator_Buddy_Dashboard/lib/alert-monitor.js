import crypto from "node:crypto";
import { pool } from "./db.js";
import { evaluateReadingNotifications } from "../routes/generators.js";

export async function pollReadingAlerts() {
  const [generators] = await pool.query("SELECT generator_id FROM generators");
  for (const generator of generators) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query("SELECT generator_id FROM generators WHERE generator_id=? FOR UPDATE", [generator.generator_id]);
      const [config] = await connection.query("SELECT parameter,warning_min,warning_max,critical_min,critical_max,enabled FROM maintenance_config ORDER BY parameter");
      const digest = crypto.createHash("sha256").update(JSON.stringify(config)).digest("hex");
      const [cursors] = await connection.query("SELECT reading_id,config_digest FROM telemetry_alert_cursor WHERE generator_id=?", [generator.generator_id]);
      const cursor = cursors[0];
      const [readings] = await connection.query(
        cursor ? "SELECT *, recorded_at >= DATE_SUB(NOW(), INTERVAL 30 SECOND) AS fresh FROM generator_readings WHERE generator_id=? AND reading_id>? ORDER BY reading_id LIMIT 100"
          : "SELECT *, recorded_at >= DATE_SUB(NOW(), INTERVAL 30 SECOND) AS fresh FROM generator_readings WHERE generator_id=? ORDER BY reading_id DESC LIMIT 1",
        cursor ? [generator.generator_id, cursor.reading_id] : [generator.generator_id]);
      if (!readings.length && cursor && cursor.config_digest !== digest) {
        const [latest] = await connection.query("SELECT *, recorded_at >= DATE_SUB(NOW(), INTERVAL 30 SECOND) AS fresh FROM generator_readings WHERE generator_id=? ORDER BY reading_id DESC LIMIT 1", [generator.generator_id]);
        readings.push(...latest);
      }
      for (const reading of readings) {
        if (reading.fresh) await evaluateReadingNotifications(generator.generator_id, reading, connection);
      }
      if (readings.length) {
        await connection.query("INSERT INTO telemetry_alert_cursor (generator_id,reading_id,config_digest) VALUES (?,?,?) ON DUPLICATE KEY UPDATE reading_id=VALUES(reading_id),config_digest=VALUES(config_digest)",
          [generator.generator_id, readings.at(-1).reading_id, digest]);
      }
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
}
export function startAlertMonitor() {
  let busy = false;
  let lastError = "";
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await pollReadingAlerts(); lastError = ""; }
    catch (error) {
      if (lastError !== error.code) console.error("Alert monitor unavailable. Check database connection and apply migrations/20261110-service-protocols.sql.", { code: error.code });
      lastError = error.code;
    } finally { busy = false; }
  };
  tick();
  const timer = setInterval(tick, 3000);
  timer.unref();
  return () => clearInterval(timer);
}

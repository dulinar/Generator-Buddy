import express from "express";
import { pool } from "../lib/db.js";
import { auth, secureEqual } from "../lib/auth.js";
import { defaults, parameterStatus } from "../lib/status.js";
import { databaseError } from "../lib/database-error.js";

const router = express.Router();

router.get("/api/generators", auth, async (req, res) => {
  try {
    let query = "SELECT generator_id,name,serial_no,location,rated_capacity_kva,install_date FROM generators ORDER BY name";
    let params = [];
    if (req.session.user.role !== "admin") {
      query = "SELECT g.generator_id,g.name,g.serial_no,g.location,g.rated_capacity_kva,g.install_date FROM generators g JOIN generator_users gu ON g.generator_id = gu.generator_id WHERE gu.user_id = ? ORDER BY g.name";
      params = [req.session.user.id];
    }
    const [rows] = await pool.query(query, params);
    res.json({ rows, telemetryAvailable: false });
  } catch (e) {
    res.status(503).json(databaseError(e));
  }
});
router.get("/api/generators/:id/latest", auth, async (req, res) => {
  try {
    if (req.session.user.role !== "admin") {
      const [assigned] = await pool.query("SELECT 1 FROM generator_users WHERE generator_id=? AND user_id=?", [req.params.id, req.session.user.id]);
      if (!assigned.length) return res.status(403).json({ error: "Generator access denied." });
    }
    const [rows] = await pool.query(
      "SELECT status,voltage,current,frequency,temperature,fuel_level,runtime_seconds,recorded_at,source FROM generator_readings WHERE generator_id=? ORDER BY recorded_at DESC LIMIT 1",
      [req.params.id],
    );
    const reading = rows[0] || null;
res.json({ reading });
  } catch (e) {
    console.error("Latest telemetry query failed", { code: e.code || "UNKNOWN" });
    res.status(503).json(databaseError(e));
  }
});
router.post("/api/generators", auth, async (req, res) => {
  if (req.session.user.role !== "admin")
    return res
      .status(403)
      .json({ error: "Only administrators can add generators." });
  try {
    const { name, serial_no, location, rated_capacity_kva, install_date } =
      req.body;
    if (!name || !serial_no)
      return res
        .status(400)
        .json({ error: "Name and serial number are required." });
    const [r] = await pool.query(
      "INSERT INTO generators (name,serial_no,location,rated_capacity_kva,install_date) VALUES (?,?,?,?,?)",
      [
        name,
        serial_no,
        location || null,
        rated_capacity_kva || null,
        install_date || null,
      ],
    );
    res.status(201).json({ generator_id: r.insertId });
  } catch (e) {
    res.status(e.code === "ER_DUP_ENTRY" ? 409 : 503).json({
      error:
        e.code === "ER_DUP_ENTRY"
          ? "Serial number already exists."
          : "Unable to add generator.",
    });
  }
});
export async function evaluateReadingNotifications(generatorId, reading, connection) {
  if (!reading) return;
    const [cfg] = await connection.query(
      "SELECT parameter,warning_min,warning_max,critical_min,critical_max,enabled FROM maintenance_config",
    );
    const limits = { ...defaults };
    for (const x of cfg) {
      if (!x.enabled && x.enabled !== undefined) continue;
      if (x.parameter === "temperature") {
        if (x.warning_max !== null) limits.temperatureWarning = Number(x.warning_max);
        else if (x.warning_min !== null) limits.temperatureWarning = Number(x.warning_min);
        if (x.critical_max !== null) limits.temperatureCritical = Number(x.critical_max);
      }
      if (x.parameter === "fuel") {
        if (x.warning_min !== null) limits.fuelWarning = Number(x.warning_min);
        if (x.critical_min !== null) limits.fuelCritical = Number(x.critical_min);
      }
      if (x.parameter === "voltage") {
        if (x.warning_min !== null) limits.voltageWarningMin = Number(x.warning_min);
        if (x.warning_max !== null) limits.voltageWarningMax = Number(x.warning_max);
        if (x.critical_min !== null) limits.voltageCriticalMin = Number(x.critical_min);
        if (x.critical_max !== null) limits.voltageCriticalMax = Number(x.critical_max);
      }
      if (x.parameter === "frequency") {
        if (x.warning_min !== null) limits.frequencyWarningMin = Number(x.warning_min);
        if (x.warning_max !== null) limits.frequencyWarningMax = Number(x.warning_max);
        if (x.critical_min !== null) limits.frequencyCriticalMin = Number(x.critical_min);
        if (x.critical_max !== null) limits.frequencyCriticalMax = Number(x.critical_max);
      }
    }

    const checks = [
      { title: "High temperature", key: "temperature", value: reading.temperature, label: "Temperature", unit: "°C" },
      { title: "Voltage out of range", key: "voltage", value: reading.voltage, label: "Voltage", unit: "V" },
      { title: "Frequency out of range", key: "frequency", value: reading.frequency, label: "Frequency", unit: "Hz" },
      { title: "Low fuel", key: "fuel", value: reading.fuel_level, label: "Fuel level", unit: "%" },
    ];

    for (const { title, key, value, label, unit } of checks) {
      if (value === null || value === undefined || !Number.isFinite(Number(value))) continue;
      if (cfg.some(row => row.parameter === key && !row.enabled)) continue;
      const status = parameterStatus(key, value, limits);
      const valNum = Number(value);

      if (status === "warning" || status === "critical") {
        const [activeRows] = await connection.query(
          "SELECT notification_id, detail FROM notifications WHERE generator_id = ? AND title = ? AND status = 'active' ORDER BY notification_id DESC LIMIT 1",
          [generatorId, title],
        );
        const existing = activeRows[0];
        const newDetail = `${label}: ${valNum.toFixed(1)}${unit} (${status})`;

        if (!existing) {
          await connection.query(
            "INSERT INTO notifications (generator_id, title, detail, status, created_at) VALUES (?, ?, ?, 'active', NOW())",
            [generatorId, title, newDetail],
          );
        } else {
          // If status escalated to critical while previously warning, resolve old warning and create critical alert
          const wasWarning = existing.detail?.includes("(warning)");
          const isCritical = status === "critical";
          if (wasWarning && isCritical) {
            await connection.query(
              "UPDATE notifications SET status = 'resolved' WHERE notification_id = ?",
              [existing.notification_id],
            );
            await connection.query(
              "INSERT INTO notifications (generator_id, title, detail, status, created_at) VALUES (?, ?, ?, 'active', NOW())",
              [generatorId, title, newDetail],
            );
          } else if (existing.detail !== newDetail) {
            await connection.query("UPDATE notifications SET detail=? WHERE notification_id=?", [newDetail, existing.notification_id]);
          }
        }
      } else if (status === "normal") {
        // Auto-resolve any active notifications when readings return to normal safe range!
        await connection.query(
          "UPDATE notifications SET status = 'resolved' WHERE generator_id = ? AND title = ? AND status = 'active'",
          [generatorId, title],
        );
      }
    }
}

router.post("/api/generators/:id/readings", async (req, res) => {
  const isAuthorized = req.session?.user?.role === "admin" ||
    secureEqual(req.headers["x-api-key"], process.env.TELEMETRY_API_KEY);
  if (!isAuthorized) {
    return res.status(401).json({ error: "Authentication required" });
  }

  let connection;
  try {
    const b = req.body || {};
    const fields = [
      "status",
      "voltage",
      "current",
      "frequency",
      "temperature",
      "fuel_level",
      "runtime_seconds",
    ];
    if (!fields.every((k) => b[k] !== undefined))
      return res
        .status(400)
        .json({ error: "All reading fields are required." });
    if (!["running", "stopped", "fault", "maintenance"].includes(b.status) ||
        !fields.slice(1).every(k => typeof b[k] === "number" && Number.isFinite(b[k])) ||
        b.fuel_level < 0 || b.fuel_level > 100 || b.runtime_seconds < 0)
      return res.status(400).json({ error: "Invalid telemetry values." });
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [generator] = await connection.query("SELECT generator_id FROM generators WHERE generator_id=? FOR UPDATE", [req.params.id]);
    if (!generator.length) {
      await connection.rollback();
      return res.status(404).json({ error: "Generator not found." });
    }
    await connection.query(
      "INSERT INTO generator_readings (generator_id,status,voltage,current,frequency,temperature,fuel_level,runtime_seconds,source) VALUES (?,?,?,?,?,?,?,?,?)",
      [
        req.params.id,
        b.status,
        b.voltage,
        b.current,
        b.frequency,
        b.temperature,
        b.fuel_level,
        b.runtime_seconds,
        "device",
      ],
    );
    // The alert monitor evaluates every telemetry source using a durable cursor.
    await connection.commit();
    res.status(201).json({ ok: true });
  } catch (e) {
    if (connection) await connection.rollback();
    res.status(503).json({ error: "Unable to save reading." });
  } finally { connection?.release(); }
});

export default router;

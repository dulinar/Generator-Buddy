import express from "express";
import { pool } from "../lib/db.js";
import { auth } from "../lib/auth.js";
const router = express.Router();
let schema;
function ensureSchema() {
  schema ??= pool.query(`CREATE TABLE IF NOT EXISTS maintenance_records (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    generator_id INT NOT NULL, service_type VARCHAR(200) NOT NULL,
    runtime_hours DOUBLE NOT NULL, performed_by VARCHAR(200) NOT NULL,
    date DATE NOT NULL, notes TEXT NOT NULL, reset_baseline BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX maintenance_generator (generator_id, id)
  )`).catch(error => { schema = null; throw error; });
  return schema;
}
router.get("/api/maintenance", auth, async (req, res) => {
  try {
    await ensureSchema();
    const admin = req.session.user.role === "admin";
    const [rows] = await pool.query(
      "SELECT m.*, g.name AS generator_name, 'Completed' AS status FROM maintenance_records m JOIN generators g ON g.generator_id=m.generator_id " +
      (admin ? "" : "WHERE EXISTS (SELECT 1 FROM generator_users gu WHERE gu.generator_id=m.generator_id AND gu.user_id=?) ") +
      "ORDER BY m.id DESC", admin ? [] : [req.session.user.id]);
    res.json({ rows });
  } catch { res.status(503).json({ error: "Maintenance records unavailable." }); }
});
router.post("/api/maintenance", auth, async (req, res) => {
  if (!["admin", "operator"].includes(req.session.user.role))
    return res.status(403).json({ error: "Operator access required to record service." });
  const b = req.body || {};
  if (!Number.isInteger(Number(b.generator_id)) || !Number.isFinite(Number(b.runtime_hours)) ||
      Number(b.runtime_hours) < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ||
      !b.service_type || String(b.service_type).length > 200 || !b.performed_by ||
      String(b.performed_by).length > 200 || String(b.notes || "").length > 10000)
    return res.status(400).json({ error: "Enter valid service details and runtime." });
  try {
    await ensureSchema();
    const [allowed] = await pool.query(
      "SELECT generator_id FROM generators WHERE generator_id=?" +
      (req.session.user.role === "admin" ? "" : " AND EXISTS (SELECT 1 FROM generator_users gu WHERE gu.generator_id=generators.generator_id AND gu.user_id=?)"),
      req.session.user.role === "admin" ? [b.generator_id] : [b.generator_id, req.session.user.id]);
    if (!allowed.length) return res.status(403).json({ error: "Generator access denied." });
    await pool.query("INSERT INTO maintenance_records (generator_id,service_type,runtime_hours,performed_by,date,notes,reset_baseline) VALUES (?,?,?,?,?,?,?)",
      [b.generator_id, String(b.service_type), Number(b.runtime_hours), String(b.performed_by), b.date, String(b.notes || ""), b.reset_baseline === true]);
    res.status(201).json({ ok: true });
  } catch { res.status(503).json({ error: "Unable to save service record." }); }
});
export default router;

import express from "express";
import { pool } from "../lib/db.js";
import { auth } from "../lib/auth.js";
const router = express.Router();
router.get("/api/service-protocols", auth, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM service_protocols ORDER BY interval_hours,protocol_id");
    res.json({ rows });
  } catch { res.status(503).json({ error: "Service protocols unavailable. Ask an administrator to apply the service-protocols migration." }); }
});
router.put("/api/service-protocols/:id", auth, async (req, res) => {
  if (req.session.user.role !== "admin") return res.status(403).json({ error: "Administrator access required." });
  const { title, interval_hours, instructions, recurring } = req.body || {};
  if (!/^[a-z0-9-]{1,40}$/.test(req.params.id) || typeof title !== "string" || !title.trim() || title.length > 160 ||
      !Number.isInteger(Number(interval_hours)) || Number(interval_hours) <= 0 || Number(interval_hours) > 1000000 ||
      typeof instructions !== "string" || instructions.length > 10000 || typeof recurring !== "boolean" ||
      (req.params.id === "oil-service" && !recurring))
    return res.status(400).json({ error: "Enter a title, positive whole-hour interval, and instructions. Oil service must repeat." });
  try {
    await pool.query("INSERT INTO service_protocols (protocol_id,title,interval_hours,instructions,recurring) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),interval_hours=VALUES(interval_hours),instructions=VALUES(instructions),recurring=VALUES(recurring)",
      [req.params.id, title.trim(), Number(interval_hours), instructions, recurring]);
    res.json({ ok: true });
  } catch { res.status(503).json({ error: "Unable to save service protocol." }); }
});
router.delete("/api/service-protocols/:id", auth, async (req, res) => {
  if (req.session.user.role !== "admin") return res.status(403).json({ error: "Administrator access required." });
  if (req.params.id === "oil-service") return res.status(400).json({ error: "The oil-service countdown protocol must be retained." });
  try {
    await pool.query("DELETE FROM service_protocols WHERE protocol_id=?", [req.params.id]);
    res.json({ ok: true });
  } catch { res.status(503).json({ error: "Unable to delete service protocol." }); }
});
export default router;

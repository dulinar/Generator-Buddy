import { pool } from "../lib/db.js";
import protocolRoutes from "./protocols.js";
import maintenanceRoutes from "./maintenance.js";
import express from "express";
import authRoutes from "./auth.js";
import configRoutes from "./config.js";
import generatorsRoutes from "./generators.js";
import notificationsRoutes from "./notifications.js";
import usersRoutes from "./users.js";
import reportsRoutes from "./reports.js";

const router = express.Router();
router.use(async (req, res, next) => {
  if (!req.path.startsWith("/api/") || !req.session?.user || ["/api/login", "/api/logout"].includes(req.path)) return next();
  try {
    const [rows] = await pool.query("SELECT user_id,name,email,role FROM users WHERE user_id=?", [req.session.user.id]);
    req.session.user = rows[0] ? { ...req.session.user, id: rows[0].user_id, name: rows[0].name, email: rows[0].email, role: rows[0].role } : null;
    next();
  } catch { res.status(503).json({ error: "Unable to verify your current access." }); }
});

router.use(authRoutes);
router.use(protocolRoutes);
router.use(maintenanceRoutes);
router.use(configRoutes);
router.use(generatorsRoutes);
router.use(notificationsRoutes);
router.use(usersRoutes);
router.use(reportsRoutes);

export default router;

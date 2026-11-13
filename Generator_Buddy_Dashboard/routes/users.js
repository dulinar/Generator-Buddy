import express from "express";
import bcrypt from "bcryptjs";
import { pool } from "../lib/db.js";
import { auth } from "../lib/auth.js";
const router = express.Router();
router.use("/api/users", auth, (req, res, next) => {
  if (req.session.user.role !== "admin") return res.status(403).json({ error: "Administrator access required." });
  next();
});
router.get("/api/users", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT user_id,name,email,role,created_at FROM users ORDER BY name");
    const [assignments] = await pool.query("SELECT user_id,generator_id FROM generator_users");
    res.json({ rows: rows.map(user => ({ ...user, generator_ids: assignments.filter(a => a.user_id === user.user_id).map(a => a.generator_id) })) });
  } catch { res.status(503).json({ error: "Users unavailable." }); }
});
async function saveUser(req, res) {
  const creating = req.method === "POST";
  const body = req.body || {};
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const role = body.role || "viewer";
  const password = String(body.password || "");
  const ids = body.generator_ids;
  if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
      !["admin","operator","viewer"].includes(role) || (creating && (password.length < 8 || Buffer.byteLength(password) > 72)) ||
      (ids !== undefined && (!Array.isArray(ids) || ids.length > 1000 || !ids.every(id => Number.isSafeInteger(id) && id > 0))))
    return res.status(400).json({ error: "Enter a name, valid email and role. Passwords must be at least 8 characters and at most 72 bytes." });
  if (!creating && String(req.params.id) === String(req.session.user.id) && role !== "admin")
    return res.status(400).json({ error: "Ask another administrator to change your role." });
  let connection;
  try {
    const hash = creating ? await bcrypt.hash(password, 12) : null;
    connection = await pool.getConnection();
    await connection.beginTransaction();
    let userId = req.params.id;
    if (creating) {
      const [result] = await connection.query("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)", [name,email,hash,role]);
      userId = result.insertId;
    } else {
      const [users] = await connection.query("SELECT user_id FROM users WHERE user_id=? FOR UPDATE", [userId]);
      if (!users.length) { await connection.rollback(); return res.status(404).json({ error: "User not found." }); }
      await connection.query("UPDATE users SET name=?,email=?,role=? WHERE user_id=?", [name,email,role,userId]);
    }
    if (ids !== undefined) {
      const uniqueIds = [...new Set(ids)];
      if (uniqueIds.length) {
        const [generators] = await connection.query("SELECT generator_id FROM generators WHERE generator_id IN (?)", [uniqueIds]);
        if (generators.length !== uniqueIds.length) { await connection.rollback(); return res.status(400).json({ error: "A selected generator no longer exists." }); }
      }
      await connection.query("DELETE FROM generator_users WHERE user_id=?", [userId]);
      for (const id of uniqueIds) await connection.query("INSERT INTO generator_users (generator_id,user_id) VALUES (?,?)", [id,userId]);
    }
    await connection.commit();
    res.status(creating ? 201 : 200).json({ ok: true, user_id: userId });
  } catch (error) {
    if (connection) await connection.rollback();
    res.status(error.code === "ER_DUP_ENTRY" ? 409 : 503).json({ error: error.code === "ER_DUP_ENTRY" ? "That email is already in use." : "Unable to save user." });
  } finally { connection?.release(); }
}
router.post("/api/users", saveUser);
router.put("/api/users/:id", saveUser);
router.delete("/api/users/:id", async (req, res) => {
  if (String(req.params.id) === String(req.session.user.id)) return res.status(400).json({ error: "You cannot delete your own account." });
  try { await pool.query("DELETE FROM users WHERE user_id=?", [req.params.id]); res.json({ ok: true }); }
  catch { res.status(503).json({ error: "Unable to delete user." }); }
});
export default router;

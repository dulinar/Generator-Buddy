import crypto from "node:crypto";
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(48).toString("hex");
export const signSession = value => crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
export function secureEqual(value, expected) {
  if (typeof value !== "string" || typeof expected !== "string" || !expected) return false;
  const a = Buffer.from(value), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function readSession(req) {
  try {
    const raw = req.headers.cookie?.match(/(?:^|;\s*)navodya_session=([^;]+)/)?.[1];
    if (!raw) return null;
    const [payload, signature, extra] = decodeURIComponent(raw).split(".");
    if (!payload || extra || !secureEqual(signature, signSession(payload))) return null;
    const user = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!user || !Number.isFinite(user.expiresAt) || user.expiresAt <= Date.now() ||
        !user.id || !["admin", "operator", "viewer"].includes(user.role)) return null;
    return user;
  } catch { return null; }
}
export const auth = (req, res, next) => req.session.user
  ? next() : res.status(401).json({ error: "Authentication required" });

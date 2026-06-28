import { query } from "../db/pool.js";
import { verifyAuthToken } from "../utils/jwt.js";

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Authentication required",
      });
    }

    const token = authHeader.split(" ")[1];
    const payload = verifyAuthToken(token);

    const result = await query(
      `
      SELECT id, name, email, created_at
      FROM users
      WHERE id = $1
      `,
      [payload.sub]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        message: "Invalid authentication token",
      });
    }

    req.user = result.rows[0];

    next();
  } catch (error) {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }
}
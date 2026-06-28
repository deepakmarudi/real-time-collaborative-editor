import { query } from "../db/pool.js";
import { verifyAuthToken } from "../utils/jwt.js";

export async function authenticateSocket(socket, next) {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Authentication required"));
    }

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
      return next(
        new Error("Invalid authentication token")
      );
    }

    const user = result.rows[0];

    socket.user = user;

    socket.data.user = {
      id: user.id,
      name: user.name,
      email: user.email,
    };

    next();
  } catch {
    next(new Error("Invalid or expired token"));
  }
}
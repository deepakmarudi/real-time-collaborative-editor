import express from "express";
import { query } from "../db/pool.js";
import { hashPassword, comparePassword } from "../utils/password.js";
import { signAuthToken } from "../utils/jwt.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const authRouter = express.Router();

authRouter.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Name, email, and password are required",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = await hashPassword(password);

    const result = await query(
      `
      INSERT INTO users (name, email, password_hash)
      VALUES ($1, $2, $3)
      RETURNING id, name, email, created_at
      `,
      [name.trim(), normalizedEmail, passwordHash]
    );

    const user = result.rows[0];
    const token = signAuthToken(user);

    res.status(201).json({
      user,
      token,
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        message: "Email is already registered",
      });
    }

    console.error("Register failed:", error);

    res.status(500).json({
      message: "Registration failed",
    });
  }
});

authRouter.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const result = await query(
      `
      SELECT id, name, email, password_hash, created_at
      FROM users
      WHERE email = $1
      `,
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const user = result.rows[0];
    const passwordMatches = await comparePassword(password, user.password_hash);

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      created_at: user.created_at,
    };

    const token = signAuthToken(safeUser);

    res.json({
      user: safeUser,
      token,
    });
  } catch (error) {
    console.error("Login failed:", error);

    res.status(500).json({
      message: "Login failed",
    });
  }
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({
    user: req.user,
  });
});
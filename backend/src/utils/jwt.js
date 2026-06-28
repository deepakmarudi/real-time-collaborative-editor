import jwt from "jsonwebtoken";
import { config } from "../config.js";

export function signAuthToken(user) {
  if (!config.jwtSecret) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
    },
    config.jwtSecret,
    {
      expiresIn: config.jwtExpiresIn,
    }
  );
}

export function verifyAuthToken(token) {
  if (!config.jwtSecret) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.verify(token, config.jwtSecret);
}
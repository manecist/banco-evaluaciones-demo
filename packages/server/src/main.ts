import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { createPgDb } from "./db.js";

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`Falta la variable de entorno ${k}`);
  return v;
};

const db = createPgDb(env("DATABASE_URL", "postgres://banco:banco@localhost:5432/banco"));
const app = createApp({
  db,
  jwtSecret: env("JWT_SECRET", process.env.NODE_ENV === "production" ? undefined : "solo-para-desarrollo"),
  allowDemoLogin: env("DEMO_LOGIN", "true") === "true",
  staticDir: process.env.STATIC_DIR ?? fileURLToPath(new URL("../../client/dist", import.meta.url)),
});
const port = Number(env("PORT", "3000"));
app.listen(port, () => console.log(`API en http://localhost:${port}/api (OpenAPI: /api/openapi.json)`));

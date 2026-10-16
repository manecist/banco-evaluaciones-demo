import { migrate, seed } from "@banco/core";
import { createPgDb } from "./db.js";

const db = createPgDb(process.env.DATABASE_URL ?? "postgres://banco:banco@localhost:5432/banco");
const exists = await db.query<{ t: string | null }>(`SELECT to_regclass('public.item') AS t`);
if (exists.rows[0]?.t) {
  console.log("La base ya está creada; no se hace nada.");
} else {
  await migrate(db);
  await seed(db);
  console.log("Base creada y cargada con datos de prueba.");
}
await db.end();

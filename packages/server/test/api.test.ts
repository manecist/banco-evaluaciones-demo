import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, seed } from "@banco/core";
import { createPgliteDb } from "@banco/core/pglite";
import { createApp } from "../src/app";

let db: Awaited<ReturnType<typeof createPgliteDb>>;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
  await seed(db);
  app = createApp({ db, jwtSecret: "test", allowDemoLogin: true });
  for (const [k, id] of Object.entries({ paula: 1, camila: 3, jefe: 5 })) {
    const r = await request(app).post("/api/auth/demo-login").send({ userId: id });
    tokens[k] = r.body.token;
  }
});
afterAll(async () => db.close());

const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

describe("API REST", () => {
  it("exige sesión", async () => {
    expect((await request(app).get("/api/items")).status).toBe(401);
  });
  it("publica la especificación OpenAPI", async () => {
    const r = await request(app).get("/api/openapi.json");
    expect(r.body.openapi).toBe("3.1.0");
    expect(r.body.components.schemas.ItemInput.type).toBe("object");
  });
  it("valida el esquema de entrada con errores legibles", async () => {
    const r = await request(app).post("/api/items").set(as("paula")).send({ stem: "", payload: { type: "seleccion_multiple", alternatives: [] } });
    expect(r.status).toBe(422);
    expect(r.body.issues.length).toBeGreaterThan(0);
  });
  it("verifica permisos en el servidor (no solo en la interfaz)", async () => {
    const r = await request(app).post("/api/items").set(as("jefe")).send({});
    expect(r.status).toBe(403);
  });
  it("busca, exporta a Moodle y analiza", async () => {
    const s = await request(app).get("/api/items").query({ q: "presion" }).set(as("paula"));
    expect(s.status).toBe(200);
    expect(s.body.length).toBeGreaterThan(0);
    const x = await request(app).get("/api/export/moodle").query({ instrumentId: 1 }).set(as("paula"));
    expect(x.headers["content-type"]).toMatch(/xml/);
    expect(x.text).toContain("<quiz>");
    const a = await request(app).get("/api/instruments/1/analysis").set(as("camila"));
    expect(a.body.students).toBe(64);
  });
});

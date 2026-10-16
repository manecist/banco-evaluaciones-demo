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
  it("segunda opinión de IA: comenta la clave sin cambiarla y respeta permisos", async () => {
    const item = {
      stem: "¿Cuál es la temperatura normal del cuerpo?",
      alternatives: [
        { text: "36,5 °C", correct: true },
        { text: "40 °C", correct: false },
        { text: "30 °C", correct: false },
        { text: "42 °C", correct: false },
      ],
    };
    const r = await request(app).post("/api/ai/review").set(as("paula")).send(item);
    expect(r.status).toBe(200);
    expect(r.body.keyAssessment).toBe("coherente");
    expect(r.body.suggestedStem).toBe("Identifique la temperatura normal del cuerpo.");
    const lejos = await request(app).post("/api/ai/review").set(as("paula")).send({
      ...item, alternatives: [{ text: "36,5 °C", correct: true }, { text: "10 °C", correct: false }, { text: "80 °C", correct: false }],
    });
    expect(lejos.body.keyAssessment).toBe("dudosa");
    expect(lejos.body.observations.join(" ")).toMatch(/lejos de la correcta/);
    const sinClave = await request(app).post("/api/ai/review").set(as("paula")).send({ ...item, alternatives: item.alternatives.map((a) => ({ ...a, correct: false })) });
    expect(sinClave.body.keyAssessment).toBe("sin_clave");
    expect((await request(app).post("/api/ai/review").set(as("camila")).send(item)).status).toBe(200); // la revisora también la usa
    expect((await request(app).post("/api/ai/review").set(as("jefe")).send(item)).status).toBe(403);
  });
  it("cada rol cambia solo su parte de la configuración", async () => {
    const marcela = (await request(app).post("/api/auth/demo-login").send({ userId: 6 })).body.token;
    const admin = (await request(app).post("/api/auth/demo-login").send({ userId: 7 })).body.token;
    const uta = { Authorization: `Bearer ${marcela}` };
    const adm = { Authorization: `Bearer ${admin}` };
    expect((await request(app).put("/api/settings").set(uta).send({ default_exigency: 0.7 })).body.default_exigency).toBe(0.7);
    expect((await request(app).put("/api/settings").set(uta).send({ ai_enabled: false })).status).toBe(403);
    expect((await request(app).put("/api/settings").set(adm).send({ ai_daily_limit: 10 })).body.ai_daily_limit).toBe(10);
    expect((await request(app).put("/api/settings").set(adm).send({ min_responses: 10 })).status).toBe(403);
    expect((await request(app).put("/api/settings").set(uta).send({ default_exigency: 2 })).status).toBe(422);
    expect((await request(app).put("/api/settings").set(as("paula")).send({ default_exigency: 0.5 })).status).toBe(403);
  });
  it("la jefatura ve el panel de su carrera", async () => {
    const r = await request(app).get("/api/career-summary").set(as("jefe"));
    expect(r.status).toBe(200);
    expect(r.body.byStatus.visado).toBeGreaterThan(0);
    expect(r.body.instruments[0].students).toBe(64);
    expect((await request(app).get("/api/career-summary").set(as("paula"))).status).toBe(403);
  });
});

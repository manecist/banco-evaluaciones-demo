import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeInstrument, getInstrument, getUser, migrate, parseMoodleResponses, saveMoodleResults, seed, simulatedMoodleCsv, type User } from "../src";
import { createPgliteDb } from "../src/adapters/pglite";

let db: Awaited<ReturnType<typeof createPgliteDb>>;
let paula: User;
beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
  await seed(db);
  paula = await getUser(db, 1);
});
afterAll(async () => db.close());

describe("simulación del demo (semilla fija)", () => {
  it("muestra 4 ítems sanos, 2 prioritarios de distinto tipo y 3 alertas menores distintas", async () => {
    const a = await analyzeInstrument(db, paula, 1);
    expect(a.sources).toEqual({ simulado: 64 });
    const byPos = a.instrument.items.map((v) => a.stats.find((s) => s.itemId === v.id)!);
    const text = (i: number) => byPos[i]!.alerts.join(" ");
    expect([0, 1, 2, 3].every((i) => byPos[i]!.alerts.length === 0 && byPos[i]!.D >= 0.3)).toBe(true);
    expect(text(4)).toMatch(/PRIORITARIO · Discriminación negativa/);
    expect(text(7)).toMatch(/PRIORITARIO · Clave probablemente errónea/);
    expect(text(5)).toMatch(/Distractor no funcional/);
    expect(text(6)).toMatch(/Muy fácil/);
    expect(text(8)).toMatch(/Muy difícil/);
    expect(a.gradeDistribution.below4).toBeGreaterThan(10);
    expect(a.gradeDistribution.from6).toBeGreaterThan(3);
  });
});

describe("resultados de Moodle", () => {
  it("lee el informe en español, calza las preguntas y elimina datos personales", async () => {
    const ins = await getInstrument(db, paula, 1);
    const csv = simulatedMoodleCsv(ins.items, 12);
    const r = parseMoodleResponses(csv, ins.items, ins.exigency);
    expect(r.students).toHaveLength(12);
    expect(r.mapped.length).toBe(ins.items.filter((v) => ["seleccion_multiple", "verdadero_falso"].includes(v.payload.type)).length);
    expect(r.personalColumnsRemoved).toEqual(["Apellido(s)", "Nombre", "Dirección de correo"]);
    expect(JSON.stringify(r.students)).not.toMatch(/@|Ficticio/);
    // La nota de Moodle y el puntaje recalculado con la clave del banco coinciden.
    for (const s of r.students) expect(Number(s.moodleGrade!.replace(",", "."))).toBeCloseTo(s.score);
  });

  it("acepta el formato en inglés sin texto de la pregunta y con columnas en otro orden", async () => {
    const ins = await getInstrument(db, paula, 1);
    const sm = ins.items.filter((v) => v.payload.type === "seleccion_multiple").slice(0, 2);
    const alt = (v: (typeof sm)[number], correct: boolean) => v.payload.type === "seleccion_multiple" ? v.payload.alternatives.find((a) => a.correct === correct)!.text : "";
    const csv = [
      "Surname,First name,Email address,State,Grade/4.00,Response 1,Response 2",
      `Doe,Jane,jane@example.com,Finished,4.00,"${alt(sm[1]!, true)}","${alt(sm[0]!, true)}"`,
      `Roe,Rick,rick@example.com,Finished,0.00,"${alt(sm[1]!, false)}",-`,
      "Overall average,,,,2.00,,",
    ].join("\n");
    const r = parseMoodleResponses(csv, ins.items, 0.6);
    expect(r.students).toHaveLength(2);
    expect(r.mapped.map((m) => m.itemId)).toEqual([sm[1]!.itemId, sm[0]!.itemId]);
    expect(r.students[0]!.grade).toBe(7);
    expect(r.students[1]!.score).toBe(0);
  });

  it("guarda los resultados sin duplicar y alimenta el análisis", async () => {
    const ins = await getInstrument(db, paula, 1);
    const csv = simulatedMoodleCsv(ins.items, 10, 3);
    const before = (await analyzeInstrument(db, paula, 1)).students;
    expect((await saveMoodleResults(db, paula, 1, csv)).saved).toBe(10);
    const all = await analyzeInstrument(db, paula, 1);
    expect(all.students).toBe(before + 10);
    expect(all.sources.moodle).toBe(10);
    expect((await analyzeInstrument(db, paula, 1, "moodle")).students).toBe(10);
    expect((await analyzeInstrument(db, paula, 1, "simulado")).students).toBe(64);
    expect((await saveMoodleResults(db, paula, 1, csv)).skipped).toBe(10);
    await expect(saveMoodleResults(db, paula, 1, "a,b\n1,2")).rejects.toThrow(/ninguna pregunta/);
  });
});

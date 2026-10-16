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
    expect((await analyzeInstrument(db, paula, 1)).students).toBe(before + 10);
    expect((await saveMoodleResults(db, paula, 1, csv)).skipped).toBe(10);
    await expect(saveMoodleResults(db, paula, 1, "a,b\n1,2")).rejects.toThrow(/ninguna pregunta/);
  });
});

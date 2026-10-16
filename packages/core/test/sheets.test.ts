import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  autoKey, buildForms, getInstrument, getUser, gradeSheets, importLegacyItems, analyzeInstrument, LEGACY_EXAMPLE, migrate,
  parseLegacyTest, parseSheetsCsv, saveSheetResults, seed, simulatedSheets, type User,
} from "../src";
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

describe("importar pruebas antiguas", () => {
  it("separa preguntas, alternativas y la respuesta marcada de distintas formas", () => {
    const { questions } = parseLegacyTest(LEGACY_EXAMPLE);
    expect(questions).toHaveLength(5);
    expect(questions[0]!.alternatives.map((a) => a.correct)).toEqual([false, false, true, false]); // con «*»
    expect(questions[1]!.alternatives[1]!.correct).toBe(true); // «Respuesta: b»
    expect(questions[1]!.bloomLevel).toBe(1); // «Identifique»
    expect(questions[2]).toMatchObject({ type: "verdadero_falso", answer: true });
    expect(questions[3]!.alternatives[1]!.correct).toBe(true); // pauta al final
    expect(questions[4]!.type).toBe("no_reconocida");
  });
  it("crea borradores que siguen la visación normal", async () => {
    const created = await importLegacyItems(db, paula, {
      moduleId: 1, outcomeId: 1, source: "prueba 2019",
      questions: [{ stem: "Identifique la vía intramuscular", bloomLevel: 1, payload: { type: "verdadero_falso", answer: true } }],
    });
    expect(created[0]!.status).toBe("borrador");
    expect(created[0]!.current.reason).toMatch(/prueba anterior/);
  });
});

describe("corrección de hojas de respuesta", () => {
  it("corrige por forma, detecta problemas y alimenta el análisis", async () => {
    const ins = await getInstrument(db, paula, 1);
    const forms = buildForms(ins.items, ins.seed);
    const keyA = forms.A.map((f) => autoKey(f) ?? "-").join("");
    const keyB = forms.B.map((f) => autoKey(f) ?? "-").join("");
    const csv = `codigo;forma;respuestas\nX001;A;${keyA}\nX002;B;${keyB}\nX003;A;${"-".repeat(keyA.length)}\nmal formada`;
    const { rows, invalid } = parseSheetsCsv(csv);
    expect(rows).toHaveLength(3);
    expect(invalid).toHaveLength(1);
    const s = gradeSheets(forms, rows, { exigency: ins.exigency });
    expect(s.results[0]!.grade).toBe(7);
    expect(s.results[1]!.grade).toBe(7);
    expect(s.results[2]!.grade).toBe(1);
    expect(s.results[2]!.flags.join(" ")).toMatch(/en blanco/);
    expect(simulatedSheets(forms, 10)).toHaveLength(10);

    const before = (await analyzeInstrument(db, paula, 1)).students;
    const r = await saveSheetResults(db, paula, 1, csv);
    expect(r.saved).toBe(3);
    expect((await analyzeInstrument(db, paula, 1)).students).toBe(before + 3);
    expect((await saveSheetResults(db, paula, 1, csv)).skipped).toBe(3); // no duplica
  });
});

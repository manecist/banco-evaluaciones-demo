import { describe, expect, it } from "vitest";
import { adviseItem, analyzeItems, coverage, detectBloomLevel, redactPII, scoreToGrade, seededShuffle, toMoodleXml, type ItemVersion } from "../src";

describe("conversión a nota (exigencia 60 %)", () => {
  it("respeta los extremos y el umbral de aprobación", () => {
    expect(scoreToGrade(0, 50)).toBe(1.0);
    expect(scoreToGrade(30, 50)).toBe(4.0);
    expect(scoreToGrade(50, 50)).toBe(7.0);
    expect(scoreToGrade(15, 50)).toBe(2.5);
  });
  it("acepta otra exigencia", () => {
    expect(scoreToGrade(25, 50, 0.5)).toBe(4.0);
  });
});

describe("barajado reproducible (formas A y B)", () => {
  it("misma semilla, mismo orden; otra semilla, otro orden", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(seededShuffle(xs, 7)).toEqual(seededShuffle(xs, 7));
    expect(seededShuffle(xs, 7)).not.toEqual(seededShuffle(xs, 8));
    expect([...seededShuffle(xs, 7)].sort((a, b) => a - b)).toEqual(xs);
  });
});

describe("asesor por reglas", () => {
  it("detecta el nivel de Bloom por el verbo, incluso conjugado", () => {
    expect(detectBloomLevel("Calcule la dosis")?.level).toBe(3);
    expect(detectBloomLevel("Identifique el rango")?.level).toBe(1);
    expect(detectBloomLevel("Analice el caso")?.level).toBe(4);
  });
  it("avisa de nivel incoherente, absolutos y clave más larga", () => {
    const s = adviseItem({
      stem: "Identifique siempre la acción correcta ante una caída de presión del paciente",
      bloomLevel: 4,
      difficulty: 3,
      payload: {
        type: "seleccion_multiple",
        alternatives: [
          { text: "Avisar inmediatamente a la enfermera a cargo y registrar el valor en la hoja de enfermería", correct: true, feedback: "" },
          { text: "Nada", correct: false, feedback: "x" },
          { text: "Esperar", correct: false, feedback: "x" },
        ],
      },
    });
    const rules = s.map((x) => x.rule);
    expect(rules).toContain("nivel_por_verbo");
    expect(rules).toContain("absolutos");
    expect(rules).toContain("clave_mas_larga");
  });
});

describe("cobertura de la tabla de especificaciones", () => {
  it("semáforo según tolerancia", () => {
    const rows = coverage(
      [{ outcomeId: 1, weight: 50 }, { outcomeId: 2, weight: 50 }],
      [{ outcomeId: 1, points: 7 }, { outcomeId: 2, points: 3 }],
      5,
    );
    expect(rows[0]).toMatchObject({ actual: 70, light: "rojo" });
  });
});

describe("filtro de datos personales antes de la IA", () => {
  it("elimina RUT, correos y teléfonos", () => {
    const r = redactPII("Paciente 12.345.678-9, correo ana@ejemplo.cl, fono +56 9 1234 5678");
    expect(r.text).not.toMatch(/12\.345|ejemplo|5678/);
    expect(r.removed).toBe(3);
  });
});

describe("análisis de ítems", () => {
  it("calcula p, D y detecta discriminación negativa", () => {
    const rows = [];
    for (let s = 0; s < 40; s++) {
      const good = s < 20;
      rows.push({ student: `s${s}`, itemId: 1, score: good ? 1 : 0, max: 1, choice: good ? "A" : "B" });
      rows.push({ student: `s${s}`, itemId: 2, score: good ? 0 : 1, max: 1, choice: null });
      rows.push({ student: `s${s}`, itemId: 3, score: good ? 1 : s % 2, max: 1, choice: null });
    }
    const st = analyzeItems(rows, { minResponses: 30, correctChoice: { 1: "A" } });
    const i1 = st.find((x) => x.itemId === 1)!;
    const i2 = st.find((x) => x.itemId === 2)!;
    expect(i1.p).toBe(0.5);
    expect(i1.D).toBeGreaterThan(0.9);
    expect(i2.D).toBeLessThan(0);
    expect(i2.alerts.join(" ")).toMatch(/PRIORITARIO/);
  });
});

describe("exportación a Moodle XML", () => {
  it("genera categorías e idnumber estable", () => {
    const v: ItemVersion = {
      id: 1, itemId: 9, versionNo: 2, authorId: 1, authorName: "x", reason: "", createdAt: "", type: "seleccion_multiple",
      stem: "¿2 < 3?", payload: { type: "seleccion_multiple", alternatives: [{ text: "Sí", correct: true, feedback: "" }, { text: "No", correct: false, feedback: "" }, { text: "Tal vez", correct: false, feedback: "" }] },
      points: 2, moduleId: 1, outcomeId: 1, criterionId: null, bloomLevel: 1, difficulty: 1, programVersion: "1", aiGenerated: false,
    };
    const xml = toMoodleXml([v], { careerName: () => "Enfermería", moduleName: () => "ENF-201", outcomeCode: () => "RA1" });
    expect(xml).toContain("$course$/top/Enfermería/ENF-201/RA1");
    expect(xml).toContain("<idnumber>banco-9</idnumber>");
    expect(xml).toContain("&lt;");
    expect(xml).toContain('fraction="100"');
  });
});

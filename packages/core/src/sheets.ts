import { LETTERS, mulberry32, scoreToGrade, seededShuffle } from "./grading";
import type { ItemVersion } from "./types";

/**
 * Formas A y B y corrección de hojas de respuesta (lector óptico o planilla).
 *
 * La forma A usa la semilla del instrumento y la B la semilla + 1. La misma
 * semilla, combinada con el id de la versión, baraja las alternativas de cada
 * pregunta: el resultado es siempre reproducible, así que la pauta y la
 * corrección automática calzan con lo impreso.
 */
export interface FormItem {
  v: ItemVersion;
  /** Orden de las alternativas (índices del original); solo selección múltiple. */
  order?: number[];
}

export type FormName = "A" | "B";

export function buildForm(items: ItemVersion[], formSeed: number): FormItem[] {
  return seededShuffle(items, formSeed).map((v) => ({
    v,
    order: v.payload.type === "seleccion_multiple" ? seededShuffle(v.payload.alternatives.map((_, i) => i), formSeed * 31 + v.id) : undefined,
  }));
}

export function buildForms(items: ItemVersion[], seed: number): Record<FormName, FormItem[]> {
  return { A: buildForm(items, seed), B: buildForm(items, seed + 1) };
}

/** Clave de corrección automática de una pregunta en su forma: letra (A–F), V o F; null si se corrige a mano. */
export function autoKey({ v, order }: FormItem): string | null {
  const p = v.payload;
  if (p.type === "seleccion_multiple") return LETTERS[(order ?? []).findIndex((i) => p.alternatives[i]?.correct)] ?? null;
  if (p.type === "verdadero_falso") return p.answer ? "V" : "F";
  return null;
}

/** Texto de la clave para la pauta impresa (incluye las preguntas de corrección manual). */
export function keyText(fi: FormItem): string {
  const p = fi.v.payload;
  switch (p.type) {
    case "seleccion_multiple":
      return autoKey(fi) ?? "?";
    case "verdadero_falso":
      return (p.answer ? "Verdadero" : "Falso") + (p.requiresJustification ? " (con justificación)" : "");
    case "respuesta_breve":
      return p.accepted.join(" · ");
    case "pareados":
      return p.pairs.map((x) => `${x.left} → ${x.right}`).join("; ");
    case "desarrollo":
      return p.rubric;
  }
}

/** Fila leída de una hoja: código anónimo del estudiante, forma y una marca por pregunta. */
export interface SheetRow {
  code: string;
  form: string;
  /** Una marca por pregunta: A–F, V/F, "-" en blanco, "*" doble marca. */
  answers: string;
}

export interface SheetResult {
  code: string;
  form: string;
  score: number;
  grade: number;
  correct: number;
  /** Marcas por pregunta en el orden de la forma, con el resultado. */
  marks: { mark: string; ok: boolean | null }[];
  flags: string[];
}

export interface SheetSummary {
  results: SheetResult[];
  autoPoints: number;
  manualQuestions: number;
  average: number;
  passRate: number;
  /** % de acierto por pregunta (numeración de la forma A). */
  byQuestion: { n: number; pctCorrect: number; itemId: number }[];
  invalid: string[];
}

/**
 * Lee el archivo del lector óptico o una planilla: una línea por hoja con
 * «código;forma;respuestas». Acepta coma, punto y coma o tabulador, y las
 * respuestas juntas («ABDC») o separadas («A,B,D,C»).
 */
export function parseSheetsCsv(text: string): { rows: SheetRow[]; invalid: string[] } {
  const rows: SheetRow[] = [];
  const invalid: string[] = [];
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/[;\t]/).map((x) => x.trim());
    const cells = parts.length >= 3 ? parts : line.split(",").map((x) => x.trim());
    const [code, form, ...rest] = cells;
    if (i === 0 && /c[oó]digo|code/i.test(code ?? "")) continue; // encabezado
    const answers = rest.join("").replace(/[\s,]/g, "").toUpperCase();
    if (!code || !form || !/^[AB]$/i.test(form) || !answers) {
      invalid.push(`Línea ${i + 1}: «${line}»`);
      continue;
    }
    rows.push({ code, form: form.toUpperCase(), answers });
  }
  return { rows, invalid };
}

export function gradeSheets(
  forms: Record<FormName, FormItem[]>,
  rows: SheetRow[],
  opts: { exigency: number; invalid?: string[] },
): SheetSummary {
  const keys = { A: forms.A.map(autoKey), B: forms.B.map(autoKey) };
  const autoPoints = forms.A.filter((fi) => autoKey(fi) !== null).reduce((a, fi) => a + fi.v.points, 0);
  const manualQuestions = forms.A.filter((fi) => autoKey(fi) === null).length;
  const perItem = new Map<number, { ok: number; n: number }>();
  const seen = new Set<string>();
  const results: SheetResult[] = rows.map((r) => {
    const flags: string[] = [];
    const formKey = keys[r.form as FormName];
    const form = forms[r.form as FormName];
    if (seen.has(r.code)) flags.push("Código repetido");
    seen.add(r.code);
    if (r.answers.length !== form.length) flags.push(`Tiene ${r.answers.length} marcas y la prueba ${form.length} preguntas`);
    let score = 0;
    let correct = 0;
    const marks = form.map((fi, i) => {
      const mark = r.answers[i] ?? "-";
      const key = formKey[i];
      if (key === null) return { mark, ok: null };
      const ok = mark === key;
      if (mark === "*") flags.push(`Pregunta ${i + 1}: doble marca`);
      if (ok) {
        score += fi.v.points;
        correct++;
      }
      const st = perItem.get(fi.v.id) ?? { ok: 0, n: 0 };
      perItem.set(fi.v.id, { ok: st.ok + (ok ? 1 : 0), n: st.n + 1 });
      return { mark, ok };
    });
    const blanks = marks.filter((m, i) => formKey[i] !== null && (m.mark === "-" || m.mark === "")).length;
    if (blanks >= Math.ceil(form.length / 2)) flags.push(`${blanks} preguntas en blanco: revise la hoja`);
    return { code: r.code, form: r.form, score, grade: scoreToGrade(score, autoPoints || 1, opts.exigency), correct, marks, flags };
  });
  const average = results.length ? results.reduce((a, r) => a + r.grade, 0) / results.length : 0;
  const passRate = results.length ? results.filter((r) => r.grade >= 4).length / results.length : 0;
  const byQuestion = forms.A.map((fi, i) => {
    const st = perItem.get(fi.v.id);
    return { n: i + 1, itemId: fi.v.itemId, pctCorrect: st && st.n ? st.ok / st.n : NaN };
  }).filter((q) => !Number.isNaN(q.pctCorrect));
  return { results, autoPoints, manualQuestions, average, passRate, byQuestion, invalid: opts.invalid ?? [] };
}

/** Lote de hojas SIMULADAS para el demo (como si vinieran del lector óptico), reproducible. */
export function simulatedSheets(forms: Record<FormName, FormItem[]>, count = 40, seed = 7): SheetRow[] {
  const rnd = mulberry32(seed);
  const rows: SheetRow[] = [];
  for (let s = 0; s < count; s++) {
    const form: FormName = s % 2 ? "B" : "A";
    const skill = 0.35 + rnd() * 0.6;
    const answers = forms[form].map((fi) => {
      const key = autoKey(fi);
      if (key === null) return "-";
      const r = rnd();
      if (r < 0.03) return "-";
      if (r < 0.05) return "*";
      if (rnd() < skill) return key;
      if (key === "V" || key === "F") return key === "V" ? "F" : "V";
      const n = fi.order?.length ?? 4;
      return LETTERS[Math.floor(rnd() * n)]!;
    }).join("");
    rows.push({ code: `E${String(s + 1).padStart(3, "0")}`, form, answers });
  }
  return rows;
}

/** Convierte una marca de la forma a la letra original del ítem (para guardar y analizar). */
export function originalChoice(fi: FormItem, mark: string): string | null {
  if (fi.v.payload.type !== "seleccion_multiple") return mark === "V" || mark === "F" ? mark : null;
  const k = LETTERS.indexOf(mark as (typeof LETTERS)[number]);
  if (k < 0 || !fi.order) return null;
  const orig = fi.order[k];
  return orig === undefined ? null : LETTERS[orig] ?? null;
}

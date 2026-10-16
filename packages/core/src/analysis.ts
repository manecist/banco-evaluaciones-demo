/**
 * Análisis clásico de ítems (RF-11), sobre el primer intento de cada estudiante.
 *
 * - p: índice de dificultad (proporción de puntaje obtenido).
 * - D: discriminación con grupos alto y bajo del 27 %.
 * - rpbis: correlación punto biserial CORREGIDA (ítem vs. total sin el ítem).
 * - Análisis de alternativas por grupo alto/bajo.
 */
export interface AnswerRow {
  student: string;
  itemId: number; // id de la versión del ítem
  score: number; // puntaje obtenido
  max: number; // puntaje máximo del ítem
  choice: string | null;
}

export interface ItemStats {
  itemId: number;
  n: number;
  p: number;
  D: number;
  rpbis: number | null;
  choices: { choice: string; high: number; low: number; total: number }[];
  alerts: string[];
}

export interface AnalysisOptions {
  minResponses: number;
  correctChoice?: Record<number, string>; // letra correcta por ítem (selección múltiple)
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function pearson(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 3) return null;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

export function analyzeItems(rows: AnswerRow[], opts: AnalysisOptions): ItemStats[] {
  const students = [...new Set(rows.map((r) => r.student))];
  const itemIds = [...new Set(rows.map((r) => r.itemId))];

  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.student, (totals.get(r.student) ?? 0) + r.score);

  // Grupos alto y bajo del 27 % según puntaje total.
  const ranked = [...students].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
  const k = Math.max(1, Math.round(students.length * 0.27));
  const high = new Set(ranked.slice(0, k));
  const low = new Set(ranked.slice(-k));

  return itemIds.map((itemId) => {
    const ir = rows.filter((r) => r.itemId === itemId);
    const n = ir.length;
    const max = ir[0]?.max ?? 1;
    const p = n ? mean(ir.map((r) => r.score / r.max)) : 0;

    const ph = mean(ir.filter((r) => high.has(r.student)).map((r) => r.score / r.max));
    const pl = mean(ir.filter((r) => low.has(r.student)).map((r) => r.score / r.max));
    const D = ph - pl;

    const x = ir.map((r) => r.score / max);
    const y = ir.map((r) => (totals.get(r.student) ?? 0) - r.score); // total corregido
    const rpbis = pearson(x, y);

    const choiceMap = new Map<string, { high: number; low: number; total: number }>();
    for (const r of ir) {
      if (!r.choice) continue;
      const c = choiceMap.get(r.choice) ?? { high: 0, low: 0, total: 0 };
      c.total++;
      if (high.has(r.student)) c.high++;
      if (low.has(r.student)) c.low++;
      choiceMap.set(r.choice, c);
    }
    const choices = [...choiceMap.entries()]
      .map(([choice, c]) => ({ choice, ...c }))
      .sort((a, b) => a.choice.localeCompare(b.choice));

    const alerts: string[] = [];
    if (n < opts.minResponses) {
      alerts.push(`Solo ${n} respuestas (mínimo ${opts.minResponses}): resultados referenciales.`);
    } else {
      if (D < 0) alerts.push("PRIORITARIO: discriminación negativa (lo responden mejor quienes tienen peor resultado total).");
      else if (D < 0.2) alerts.push("Discriminación baja (D < 0,20).");
      if (p < 0.2) alerts.push("Muy difícil (p < 0,20).");
      if (p > 0.9) alerts.push("Muy fácil (p > 0,90).");
      const correct = opts.correctChoice?.[itemId];
      if (correct) {
        for (const c of choices) {
          if (c.choice !== correct && c.high > c.low) alerts.push(`El distractor ${c.choice} lo eligen más en el grupo alto que en el bajo.`);
        }
      }
    }

    return { itemId, n, p: round(p), D: round(D), rpbis: rpbis === null ? null : round(rpbis), choices, alerts };
  });
}

/** Distractores que nadie eligió (necesitan las letras disponibles del ítem). */
export function unusedDistractors(stats: ItemStats, letters: string[], correct: string): string[] {
  const used = new Set(stats.choices.map((c) => c.choice));
  return letters.filter((l) => l !== correct && !used.has(l));
}

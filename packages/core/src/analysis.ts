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
  /** Letras disponibles por ítem (para detectar distractores que nadie elige). */
  letters?: Record<number, string[]>;
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
    const f2 = (x: number) => x.toFixed(2).replace(".", ",");
    if (n < opts.minResponses) {
      alerts.push(`Solo ${n} respuestas (mínimo ${opts.minResponses}): resultados referenciales.`);
    } else {
      const correct = opts.correctChoice?.[itemId];
      const key = choices.find((c) => c.choice === correct);
      const keyHigh = key?.high ?? 0;
      // El distractor que más atrae al grupo alto.
      const rival = correct ? choices.filter((c) => c.choice !== correct).sort((a, b) => b.high - a.high)[0] : undefined;
      let explained = false;

      const highN = high.size;
      const second = correct ? choices.filter((c) => c.choice !== correct && c.choice !== rival?.choice).reduce((m, c) => Math.max(m, c.high), 0) : 0;
      // Clave errónea: UN distractor concentra al grupo alto (no un reparto al azar entre varios).
      if (correct && rival && rival.high > keyHigh && rival.high >= highN * 0.4 && rival.high >= second * 2) {
        alerts.push(
          `PRIORITARIO · Clave probablemente errónea: en el grupo alto, ${rival.high} eligen la ${rival.choice} y solo ${keyHigh} la clave ${correct}. ` +
            "Revise si la respuesta marcada es realmente la correcta antes de calificar.",
        );
        explained = true;
      } else if (correct && rival && D >= 0 && keyHigh > 0 && rival.high >= keyHigh * 0.6 && rival.high > rival.low) {
        alerts.push(
          `PRIORITARIO · Pregunta ambigua: el grupo alto se reparte entre la clave ${correct} (${keyHigh}) y la ${rival.choice} (${rival.high}). ` +
            "Puede haber dos respuestas defendibles: precise el enunciado o la alternativa.",
        );
        explained = true;
      }
      if (D < 0 && !explained) {
        alerts.push(
          `PRIORITARIO · Discriminación negativa (D = ${f2(D)}): la responden mejor quienes tienen peor resultado total. ` +
            "Suele indicar un enunciado confuso o una trampa involuntaria.",
        );
      } else if (D >= 0 && D < 0.2 && !explained && p >= 0.2 && p <= 0.9) {
        // En ítems extremos (muy fáciles o muy difíciles) la D baja es esperable y ya se informa.
        alerts.push(`Discriminación baja (D = ${f2(D)}): distingue poco entre quienes dominan el tema y quienes no.`);
      }
      if (p < 0.2) alerts.push(`Muy difícil (p = ${f2(p)}): menos del 20 % la responde bien. Revise si el contenido se trabajó en clases o si la clave es correcta.`);
      if (p > 0.9) alerts.push(`Muy fácil (p = ${f2(p)}): casi todos la responden bien, así que aporta poca información para distinguir niveles.`);
      if (correct) {
        // En un ítem muy fácil casi nadie se equivoca: que sobren distractores es esperable.
        const unused = p > 0.9 ? [] : (opts.letters?.[itemId] ?? []).filter((l) => l !== correct && !choices.some((c) => c.choice === l && c.total > 0));
        for (const l of unused) alerts.push(`Distractor no funcional: la alternativa ${l} no la eligió nadie. Reemplácela por un error frecuente de los estudiantes.`);
        if (!explained && D >= 0) {
          for (const c of choices) {
            if (c.choice !== correct && c.high >= 3 && c.high - c.low >= 2) alerts.push(`El distractor ${c.choice} lo eligen más en el grupo alto que en el bajo: revise si es parcialmente correcto.`);
          }
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

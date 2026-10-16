/**
 * Conversión de puntaje a nota (escala chilena 1,0 – 7,0, aprobación 4,0),
 * con exigencia configurable (60 % por defecto).
 */
export function scoreToGrade(score: number, max: number, exigency = 0.6): number {
  if (max <= 0) throw new Error("El puntaje máximo debe ser mayor que 0");
  const s = Math.min(Math.max(score, 0), max);
  const cut = max * exigency;
  const grade = s < cut ? 1 + (3 * s) / cut : 4 + (3 * (s - cut)) / (max - cut);
  return Math.round(grade * 10) / 10;
}

/** Tabla de conversión completa, para imprimir junto a la prueba. */
export function gradeTable(max: number, exigency = 0.6, step = 1): { score: number; grade: number }[] {
  const rows: { score: number; grade: number }[] = [];
  for (let s = 0; s <= max + 1e-9; s += step) rows.push({ score: Math.round(s * 100) / 100, grade: scoreToGrade(s, max, exigency) });
  return rows;
}

/**
 * Barajado reproducible para las formas A y B (RF-10): con la misma semilla,
 * siempre sale el mismo orden.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const out = [...arr];
  const rnd = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

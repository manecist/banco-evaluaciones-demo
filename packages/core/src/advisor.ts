import type { ItemPayload } from "./types";

/**
 * Asesor por reglas (RF-04): revisa el ítem mientras se escribe y sugiere
 * mejoras. No usa IA: son reglas explicables que el Área Curricular puede
 * ajustar. Cada sugerencia se acepta, descarta o modifica.
 */
export interface Suggestion {
  rule: string;
  severity: "info" | "aviso" | "importante";
  message: string;
}

/** Verbos frecuentes en programas técnicos, por nivel de la taxonomía de Bloom. */
export const VERB_LEVELS: Record<string, number> = {
  nombrar: 1, identificar: 1, listar: 1, reconocer: 1, definir: 1, enumerar: 1, recordar: 1, señalar: 1,
  explicar: 2, describir: 2, clasificar: 2, resumir: 2, interpretar: 2, comparar: 2, distinguir: 2,
  aplicar: 3, calcular: 3, ejecutar: 3, utilizar: 3, demostrar: 3, resolver: 3, operar: 3, realizar: 3, preparar: 3,
  analizar: 4, diferenciar: 4, organizar: 4, examinar: 4, diagnosticar: 4, inferir: 4,
  evaluar: 5, justificar: 5, juzgar: 5, argumentar: 5, valorar: 5, priorizar: 5, decidir: 5,
  crear: 6, diseñar: 6, planificar: 6, elaborar: 6, proponer: 6, formular: 6, construir: 6,
};

const ABSOLUTES = ["siempre", "nunca", "todas las anteriores", "ninguna de las anteriores", "jamás", "totalmente", "absolutamente"];
const WORK_CONTEXT = ["paciente", "turno", "taller", "faena", "planta", "cliente", "usuario", "equipo", "terreno", "servicio", "caso", "situación", "empresa", "puesto", "obra", "huésped", "ruta"];

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Nivel sugerido según el primer verbo reconocido en el enunciado. */
export function detectBloomLevel(stem: string): { verb: string; level: number } | null {
  const words = normalize(stem).match(/[a-zñ]+/g) ?? [];
  for (const w of words) {
    for (const [verb, level] of Object.entries(VERB_LEVELS)) {
      const v = normalize(verb);
      // Coincide con infinitivo o con formas conjugadas frecuentes (calcule, identifique, analice...).
      const root = v.replace(/(ar|er|ir)$/, "");
      // Cambios ortográficos del subjuntivo: identificar → identifique, organizar → organice, ...
      const roots = [root, root.replace(/c$/, "qu"), root.replace(/z$/, "c"), root.replace(/g$/, "gu")];
      if (w === v || (root.length >= 4 && roots.some((r) => w.startsWith(r)) && w.length <= v.length + 3)) {
        return { verb, level };
      }
    }
  }
  return null;
}

export function adviseItem(input: { stem: string; payload: ItemPayload; bloomLevel: number; difficulty: number }): Suggestion[] {
  const out: Suggestion[] = [];
  const stem = input.stem.trim();
  const n = normalize(stem);

  if (stem.length > 0 && stem.length < 25) {
    out.push({ rule: "enunciado_corto", severity: "aviso", message: "El enunciado es muy breve: agregue contexto para que se entienda sin ayuda." });
  }

  const bloom = detectBloomLevel(stem);
  if (bloom && bloom.level !== input.bloomLevel) {
    out.push({
      rule: "nivel_por_verbo",
      severity: "importante",
      message: `El verbo "${bloom.verb}" corresponde al nivel ${bloom.level} de Bloom, pero el ítem está marcado en el nivel ${input.bloomLevel}.`,
    });
  }
  if (!bloom && stem.length >= 25) {
    out.push({
      rule: "sin_verbo",
      severity: "info",
      message: "Conviene empezar con un verbo que diga qué debe hacer el estudiante (por ejemplo: Identifique, Calcule, Explique). Así se puede comprobar el nivel de Bloom.",
    });
  }

  for (const a of ABSOLUTES) {
    if (n.includes(normalize(a))) {
      out.push({ rule: "absolutos", severity: "aviso", message: `Evite absolutos como "${a}": suelen dar pistas o confundir.` });
      break;
    }
  }

  if (/\bno\b/.test(n) && /\b(no es|no corresponde|no se|excepto)\b/.test(n)) {
    out.push({ rule: "negacion", severity: "aviso", message: "El enunciado está en negativo. Si es necesario, destaque la negación (por ejemplo, en MAYÚSCULAS)." });
  }

  if (input.bloomLevel >= 3 && !WORK_CONTEXT.some((w) => n.includes(w))) {
    out.push({ rule: "contexto_laboral", severity: "info", message: "Para niveles de aplicación o superiores, conviene situar el ítem en un contexto laboral real." });
  }

  const p = input.payload;
  if (p.type === "seleccion_multiple") {
    const lens = p.alternatives.map((a) => a.text.trim().length);
    const correctIdx = p.alternatives.findIndex((a) => a.correct);
    const max = Math.max(...lens);
    const avgOthers = lens.filter((_, i) => i !== correctIdx).reduce((a, b) => a + b, 0) / Math.max(1, lens.length - 1);
    if (correctIdx >= 0 && lens[correctIdx] === max && max > avgOthers * 1.6 && max > 20) {
      out.push({ rule: "clave_mas_larga", severity: "aviso", message: "La alternativa correcta es notoriamente más larga que las demás: puede delatar la respuesta." });
    }
    const texts = p.alternatives.map((a) => normalize(a.text.trim())).filter(Boolean);
    const empty = p.alternatives.length - texts.length;
    if (empty > 0) {
      out.push({ rule: "alternativas_vacias", severity: "aviso", message: `Faltan ${empty === 1 ? "1 alternativa" : `${empty} alternativas`} por escribir.` });
    }
    if (new Set(texts).size !== texts.length) {
      out.push({ rule: "alternativas_repetidas", severity: "importante", message: "Hay alternativas repetidas: cada opción debe ser distinta." });
    }
    if (p.alternatives.some((a) => !a.correct && !a.feedback.trim())) {
      out.push({ rule: "sin_retroalimentacion", severity: "info", message: "Opcional: agregue retroalimentación a las alternativas incorrectas; ayuda al estudiante a entender su error." });
    }
  }
  if (p.type === "pareados" && p.distractors.length === 0) {
    out.push({ rule: "pareados_sin_distractores", severity: "info", message: "Agregue al menos un distractor en la columna derecha para evitar responder por descarte." });
  }

  return out;
}

/** Semáforo de cobertura de la tabla de especificaciones (RF-04). */
export interface CoverageRow {
  outcomeId: number;
  expected: number; // % esperado
  actual: number; // % real según puntajes
  light: "verde" | "amarillo" | "rojo";
}

export function coverage(
  specs: { outcomeId: number; weight: number }[],
  items: { outcomeId: number; points: number }[],
  tolerance = 5,
): CoverageRow[] {
  const total = items.reduce((a, b) => a + b.points, 0);
  return specs.map((s) => {
    const pts = items.filter((i) => i.outcomeId === s.outcomeId).reduce((a, b) => a + b.points, 0);
    const actual = total > 0 ? Math.round((pts / total) * 1000) / 10 : 0;
    const diff = Math.abs(actual - s.weight);
    const light = diff <= tolerance ? "verde" : diff <= tolerance * 2 ? "amarillo" : "rojo";
    return { outcomeId: s.outcomeId, expected: s.weight, actual, light };
  });
}

/** Tiempo estimado de respuesta (minutos) según tipo de ítem. */
export function estimatedMinutes(types: string[]): number {
  const per: Record<string, number> = { seleccion_multiple: 1.5, verdadero_falso: 0.75, respuesta_breve: 2, pareados: 3, desarrollo: 10 };
  return Math.round(types.reduce((a, t) => a + (per[t] ?? 2), 0));
}

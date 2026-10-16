import { z } from "zod";
import { payloadSchema } from "./types";

/**
 * Asistente de IA (RF-08).
 *
 * - Antes de enviar el texto al proveedor se eliminan RUT, correos y teléfonos.
 * - La respuesta del modelo debe cumplir un esquema; lo que no cumple se
 *   descarta sin mostrarse.
 * - Todo lo generado queda en BORRADOR marcado "generado con IA" hasta que una
 *   persona lo edite y confirme.
 * - Se registran modelo, tokens y costo estimado.
 *
 * El proveedor es intercambiable. En este demo se usa un proveedor SIMULADO
 * (sin llamadas externas ni costo); en producción se configura el proveedor y
 * modelo que el CFT defina.
 */

const RUT = /\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE = /(?:\+?56\s?)?(?:9\s?)?\d{4}\s?\d{4}\b/g;

export function redactPII(s: string): { text: string; removed: number } {
  let removed = 0;
  const sub = (label: string) => () => {
    removed++;
    return label;
  };
  const text = s.replace(RUT, sub("[RUT]")).replace(EMAIL, sub("[CORREO]")).replace(PHONE, sub("[TELÉFONO]"));
  return { text, removed };
}

export const aiItemSchema = z.object({
  stem: z.string().min(10),
  bloomLevel: z.number().int().min(1).max(6),
  difficulty: z.number().int().min(1).max(5),
  payload: payloadSchema,
});
export type AiItem = z.infer<typeof aiItemSchema>;

export interface AiRequest {
  outcomeText: string;
  count: number; // 1 a 5
  context: string; // contexto laboral pedido por la docente
}

export interface AiProvider {
  name: string;
  model: string;
  /** Devuelve JSON crudo; la validación se hace fuera del proveedor. */
  generate(prompt: string, count: number): Promise<{ raw: unknown[]; tokensIn: number; tokensOut: number }>;
  costPerKTokensClp: { in: number; out: number };
}

export function buildPrompt(req: AiRequest): string {
  return [
    "Eres un asistente para docentes de educación técnica de nivel superior en Chile.",
    `Redacta ${req.count} ítem(s) de evaluación para este resultado de aprendizaje: "${req.outcomeText}".`,
    `Contexto laboral: ${req.context}.`,
    "Responde SOLO con un arreglo JSON que cumpla el esquema entregado. No incluyas datos personales.",
  ].join("\n");
}

export async function generateItems(provider: AiProvider, req: AiRequest) {
  const count = Math.min(5, Math.max(1, Math.trunc(req.count)));
  const safe = redactPII(buildPrompt({ ...req, count }));
  const { raw, tokensIn, tokensOut } = await provider.generate(safe.text, count);
  const accepted: AiItem[] = [];
  let discarded = 0;
  for (const r of raw) {
    const parsed = aiItemSchema.safeParse(r);
    if (parsed.success) accepted.push(parsed.data);
    else discarded++;
  }
  const cost = (tokensIn / 1000) * provider.costPerKTokensClp.in + (tokensOut / 1000) * provider.costPerKTokensClp.out;
  return { accepted, discarded, piiRemoved: safe.removed, tokensIn, tokensOut, costClp: Math.round(cost * 100) / 100 };
}

/** Proveedor simulado: produce ítems plausibles y, a propósito, uno inválido para mostrar el descarte. */
export const simulatedProvider: AiProvider = {
  name: "simulado",
  model: "demo-sin-costo",
  costPerKTokensClp: { in: 0, out: 0 },
  async generate(prompt, count) {
    const outcome = /resultado de aprendizaje: "([^"]+)"/.exec(prompt)?.[1] ?? "el resultado";
    const ctx = /Contexto laboral: ([^\n]+)\./.exec(prompt)?.[1] ?? "su lugar de trabajo";
    const raw: unknown[] = [];
    for (let i = 0; i < count; i++) {
      raw.push({
        stem: `En ${ctx}, identifique la acción correcta relacionada con: ${outcome.toLowerCase()} (propuesta ${i + 1}).`,
        bloomLevel: 1,
        difficulty: 2 + (i % 3),
        payload: {
          type: "seleccion_multiple",
          alternatives: [
            { text: "Seguir el procedimiento establecido y registrarlo", correct: true, feedback: "" },
            { text: "Omitir el registro si no hay supervisión", correct: false, feedback: "El registro es parte del procedimiento." },
            { text: "Delegar la acción sin informar", correct: false, feedback: "Debe informarse siempre al responsable." },
            { text: "Postergar la acción al siguiente turno", correct: false, feedback: "Puede afectar la continuidad." },
          ],
        },
      });
    }
    raw.push({ stem: "Ítem mal formado", payload: { type: "seleccion_multiple", alternatives: [] } });
    return { raw, tokensIn: Math.round(prompt.length / 4), tokensOut: 180 * count };
  },
};

/* ======================= Segunda opinión sobre un ítem ======================= */

/**
 * La IA revisa un ítem ya redactado y comenta la clave y las alternativas.
 * NUNCA elige ni cambia la respuesta correcta: la decisión es del docente y
 * después la valida el revisor. La respuesta también se valida por esquema.
 */
export const aiReviewSchema = z.object({
  keyAssessment: z.enum(["coherente", "dudosa", "sin_clave"]),
  comment: z.string().min(1),
  observations: z.array(z.string().min(1)).max(8),
  suggestedStem: z.string().min(10).optional(),
});
export type AiReview = z.infer<typeof aiReviewSchema>;

export interface AiReviewRequest {
  stem: string;
  alternatives: { text: string; correct: boolean }[];
}

export interface AiReviewer {
  name: string;
  model: string;
  /** Devuelve JSON crudo; la validación por esquema se hace fuera del proveedor. */
  review(prompt: string, req: AiReviewRequest): Promise<unknown>;
}

export function buildReviewPrompt(req: AiReviewRequest): string {
  const alts = req.alternatives.map((a, i) => `${"ABCDEF"[i]}) ${a.text}${a.correct ? "  [marcada como correcta]" : ""}`).join("\n");
  return [
    "Eres un par revisor de ítems de evaluación para educación técnica de nivel superior en Chile.",
    "Revisa si la alternativa marcada como correcta es coherente con el enunciado y si las demás son plausibles.",
    "No cambies la clave: solo comenta. Responde SOLO con JSON que cumpla el esquema entregado.",
    `Enunciado: ${req.stem}`,
    alts,
  ].join("\n");
}

export async function reviewItem(reviewer: AiReviewer, req: AiReviewRequest) {
  const safeStem = redactPII(req.stem);
  const safeAlts = req.alternatives.map((a) => ({ ...a, text: redactPII(a.text) }));
  const clean: AiReviewRequest = { stem: safeStem.text, alternatives: safeAlts.map((a) => ({ text: a.text.text, correct: a.correct })) };
  const raw = await reviewer.review(buildReviewPrompt(clean), clean);
  const parsed = aiReviewSchema.safeParse(raw);
  if (!parsed.success) throw new Error("La respuesta de la IA no cumplió el esquema y se descartó");
  const piiRemoved = safeStem.removed + safeAlts.reduce((n, a) => n + a.text.removed, 0);
  return { ...parsed.data, piiRemoved, model: reviewer.model, simulated: reviewer.name === "simulado" };
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const words = (s: string) => new Set(norm(s).match(/[a-zñ0-9]{4,}/g) ?? []);

/**
 * Revisor simulado: aplica comprobaciones de forma sobre la clave y los
 * distractores. Un modelo real además opina sobre el contenido técnico.
 */
export const simulatedReviewer: AiReviewer = {
  name: "simulado",
  model: "demo-sin-costo",
  async review(_prompt, req) {
    const alts = req.alternatives.filter((a) => a.text.trim());
    const key = alts.find((a) => a.correct);
    const obs: string[] = [];
    if (!key) {
      return { keyAssessment: "sin_clave", comment: "No hay una alternativa marcada como correcta (o está vacía). Márquela usted con el círculo.", observations: [] };
    }
    const others = alts.filter((a) => a !== key);
    const stemWords = words(req.stem);
    const shared = [...words(key.text)].filter((w) => stemWords.has(w));
    if (shared.length >= 2 && others.every((o) => [...words(o.text)].filter((w) => stemWords.has(w)).length < shared.length)) {
      obs.push(`La alternativa correcta repite palabras del enunciado ("${shared.slice(0, 2).join('", "')}"); un estudiante podría acertar sin saber.`);
    }
    if (others.some((o) => /\b(todas|ninguna) de las anteriores\b/.test(norm(o.text)) || /\b(todas|ninguna) de las anteriores\b/.test(norm(key.text)))) {
      obs.push("Evite «todas las anteriores» o «ninguna de las anteriores»: miden poco y confunden.");
    }
    // Solo alternativas de un único número (no rangos como "60 a 100").
    const single = (t: string) => {
      const m = norm(t).replace(",", ".").match(/-?\d+(\.\d+)?/g);
      return m && m.length === 1 ? Number(m[0]) : NaN;
    };
    const keyNum = single(key.text);
    const nums = others.map((o) => single(o.text));
    if (!Number.isNaN(keyNum) && nums.length > 1 && nums.every((n) => !Number.isNaN(n))) {
      const far = nums.filter((n) => Math.abs(n - keyNum) > Math.max(Math.abs(keyNum) * 0.15, 1));
      if (far.length === nums.length) obs.push("Todas las alternativas numéricas incorrectas están lejos de la correcta: conviene que al menos una sea un error frecuente y cercano.");
    }
    if (others.some((o) => norm(o.text) && (norm(key.text).includes(norm(o.text)) || norm(o.text).includes(norm(key.text))))) {
      obs.push("Una alternativa incorrecta está contenida en la correcta (o al revés): podría haber dos respuestas válidas.");
    }
    const m = /^¿\s*cu[aá]l(?:es)?\s+(?:es|son)\s+(.+?)\?*$/i.exec(req.stem.trim());
    const suggestedStem = m ? `Identifique ${m[1]!.replace(/\?$/, "")}.` : undefined;
    return {
      keyAssessment: obs.length ? "dudosa" : "coherente",
      comment: obs.length
        ? "Revise las observaciones antes de enviar la pregunta. La respuesta correcta la sigue decidiendo usted."
        : "No se detectan problemas de forma en la clave ni en las alternativas.",
      observations: obs,
      ...(suggestedStem ? { suggestedStem } : {}),
    };
  },
};

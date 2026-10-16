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
  /** Respuesta que la IA considera correcta, con su fundamento. Es una opinión: no cambia la clave. */
  aiAnswer: z.object({
    letter: z.string().max(1).nullable(),
    justification: z.string().min(1),
    agreesWithKey: z.boolean().nullable(),
  }).optional(),
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
 * Base de conocimiento de ejemplo del revisor SIMULADO (solo para los temas del
 * demo). Con un proveedor real, el modelo de lenguaje responde cualquier tema.
 */
const DEMO_KNOWLEDGE: { topic: RegExp[]; answer: RegExp; why: string }[] = [
  { topic: [/presion arterial/, /brazo/], answer: /altura del corazon/, why: "El brazo debe quedar apoyado a la altura del corazón: si cuelga, la presión se sobreestima; si se eleva, se subestima." },
  { topic: [/frecuencia respiratoria/, /adulto/], answer: /12 a 20/, why: "En un adulto en reposo, la frecuencia respiratoria normal es de 12 a 20 respiraciones por minuto." },
  { topic: [/frecuencia cardiaca/, /adulto/], answer: /60 a 100/, why: "En un adulto en reposo, la frecuencia cardiaca normal es de 60 a 100 latidos por minuto." },
  { topic: [/temperatura/, /normal/], answer: /36[,.]5/, why: "La temperatura corporal normal de un adulto es cercana a 36,5 °C (axilar entre 36 y 37 °C)." },
  { topic: [/39/, /temperatura|fiebre/], answer: /informar/, why: "Ante fiebre, el técnico registra el valor e informa de inmediato a la enfermera; no administra fármacos sin indicación." },
  { topic: [/higiene de manos/, /\bno\b/, /oms/], answer: /sala de estar/, why: "Los cinco momentos de la OMS ocurren en la atención del paciente; entrar a la sala de estar sin contacto previo no es uno de ellos." },
  { topic: [/gotitas/], answer: /mascarilla quirurgica/, why: "En el aislamiento por gotitas, la mascarilla quirúrgica es imprescindible a menos de un metro del paciente." },
  { topic: [/solucion alcoholica/], answer: /20 a 30/, why: "La higiene de manos con solución alcohólica dura entre 20 y 30 segundos." },
  { topic: [/retiro/, /proteccion personal/], answer: /^guantes, pechera/, why: "Se retira primero lo más contaminado (guantes y pechera) y al final la protección de la cara, con higiene de manos al terminar." },
];

/** Si el enunciado pide convertir latidos contados en 15 segundos a latidos por minuto, lo calcula. */
function pulseCalculation(stem: string): { value: number; why: string } | null {
  const m = /(\d+)\s*latidos/.exec(stem);
  if (!m || !/15 segundos/.test(stem)) return null;
  const v = Number(m[1]) * 4;
  return { value: v, why: `${m[1]} latidos en 15 segundos × 4 = ${v} latidos por minuto.` };
}

/**
 * Revisor simulado: aplica comprobaciones de forma sobre la clave y los
 * distractores y, para los temas del demo, opina qué alternativa es correcta.
 * Un modelo real hace lo mismo para cualquier contenido.
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
    // Opinión sobre el contenido: qué alternativa cree correcta la IA.
    const nStem = norm(req.stem);
    const letterOf = (a: { text: string }) => "ABCDEF"[req.alternatives.indexOf(a as (typeof req.alternatives)[number])] ?? null;
    const keyLetter = letterOf(key);
    let aiAnswer: { letter: string | null; justification: string; agreesWithKey: boolean | null };
    const calc = pulseCalculation(nStem);
    const kb = DEMO_KNOWLEDGE.find((k) => k.topic.every((t) => t.test(nStem)));
    const pick = calc
      ? { alt: alts.find((a) => new RegExp(`\\b${calc.value}\\b`).test(norm(a.text))), why: calc.why }
      : kb ? { alt: alts.find((a) => kb.answer.test(norm(a.text))), why: kb.why } : null;
    if (pick?.alt) {
      const letter = letterOf(pick.alt);
      aiAnswer = { letter, justification: pick.why, agreesWithKey: letter === keyLetter };
      if (letter !== keyLetter) obs.unshift(`La IA cree que la respuesta correcta es la ${letter}, no la ${keyLetter} marcada. ${pick.why} Revise o consulte a un experto.`);
    } else if (pick) {
      aiAnswer = { letter: null, justification: `${pick.why} Ninguna alternativa coincide con eso: revise las opciones.`, agreesWithKey: false };
      obs.unshift("La respuesta que la IA considera correcta no aparece entre las alternativas.");
    } else {
      aiAnswer = { letter: null, justification: "La IA simulada del demo no tiene información sobre este tema. Con un proveedor real, un modelo de lenguaje propone la respuesta y su fundamento.", agreesWithKey: null };
    }

    const m = /^¿\s*cu[aá]l(?:es)?\s+(?:es|son)\s+(.+?)\?*$/i.exec(req.stem.trim());
    const suggestedStem = m ? `Identifique ${m[1]!.replace(/\?$/, "")}.` : undefined;
    return {
      keyAssessment: obs.length ? "dudosa" : "coherente",
      comment: obs.length
        ? "Revise las observaciones antes de enviar la pregunta. La respuesta correcta la sigue decidiendo usted."
        : "No se detectan problemas de forma en la clave ni en las alternativas.",
      observations: obs,
      aiAnswer,
      ...(suggestedStem ? { suggestedStem } : {}),
    };
  },
};

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

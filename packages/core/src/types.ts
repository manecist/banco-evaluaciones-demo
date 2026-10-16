import { z } from "zod";

export const ROLES = ["docente", "jefatura", "revisor", "area_curricular", "uta", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const STATUSES = ["borrador", "recepcionado", "en_revision", "devuelto", "visado"] as const;
export type Status = (typeof STATUSES)[number];

export const ITEM_TYPES = [
  "seleccion_multiple",
  "verdadero_falso",
  "respuesta_breve",
  "pareados",
  "desarrollo",
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  seleccion_multiple: "Selección múltiple",
  verdadero_falso: "Verdadero o falso",
  respuesta_breve: "Respuesta breve",
  pareados: "Términos pareados",
  desarrollo: "Desarrollo / caso",
};

export const BLOOM_LABEL = ["", "Recordar", "Comprender", "Aplicar", "Analizar", "Evaluar", "Crear"] as const;

const nonEmpty = z.string().trim().min(1, "Campo obligatorio");

/** Contenido específico de cada tipo de ítem (RF-01). */
export const payloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("seleccion_multiple"),
    alternatives: z
      .array(z.object({ text: nonEmpty, correct: z.boolean(), feedback: z.string().default("") }))
      .min(3, "Mínimo 3 alternativas")
      .max(6, "Máximo 6 alternativas")
      .refine((a) => a.filter((x) => x.correct).length === 1, "Debe haber exactamente una alternativa correcta"),
  }),
  z.object({
    type: z.literal("verdadero_falso"),
    answer: z.boolean(),
    requiresJustification: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("respuesta_breve"),
    accepted: z.array(nonEmpty).min(1, "Indique al menos una respuesta aceptada"),
  }),
  z.object({
    type: z.literal("pareados"),
    pairs: z.array(z.object({ left: nonEmpty, right: nonEmpty })).min(3).max(10),
    distractors: z.array(nonEmpty).default([]),
  }),
  z.object({
    type: z.literal("desarrollo"),
    rubric: nonEmpty.describe("Pauta de corrección obligatoria"),
  }),
]);
export type ItemPayload = z.infer<typeof payloadSchema>;

/** Entrada para crear o editar un ítem (validada en la API y en la interfaz). */
export const itemInputSchema = z.object({
  stem: nonEmpty.max(4000),
  payload: payloadSchema,
  points: z.number().positive().max(100),
  moduleId: z.number().int().positive(),
  outcomeId: z.number().int().positive(),
  criterionId: z.number().int().positive().nullable().default(null),
  bloomLevel: z.number().int().min(1).max(6),
  difficulty: z.number().int().min(1).max(5),
  reason: nonEmpty.max(300).default("Edición"),
  aiGenerated: z.boolean().default(false),
});
export type ItemInput = z.input<typeof itemInputSchema>;
export type ItemInputParsed = z.output<typeof itemInputSchema>;

export const itemSearchSchema = z.object({
  q: z.string().optional(),
  careerId: z.coerce.number().int().optional(),
  moduleId: z.coerce.number().int().optional(),
  outcomeId: z.coerce.number().int().optional(),
  bloomLevel: z.coerce.number().int().optional(),
  type: z.enum(ITEM_TYPES).optional(),
  status: z.enum(STATUSES).optional(),
  authorId: z.coerce.number().int().optional(),
  includeArchived: z.coerce.boolean().optional(),
});
export type ItemSearch = z.infer<typeof itemSearchSchema>;

export const transitionSchema = z.object({
  to: z.enum(STATUSES),
  comment: z.string().trim().max(2000).optional(),
});

export const instrumentInputSchema = z.object({
  title: nonEmpty.max(200),
  moduleId: z.number().int().positive(),
  seed: z.number().int().default(2026),
  exigency: z.number().gt(0).lt(1).default(0.6),
  minutes: z.number().int().positive().default(60),
  specs: z
    .array(z.object({ outcomeId: z.number().int().positive(), weight: z.number().min(0).max(100) }))
    .min(1)
    .refine((s) => Math.abs(s.reduce((a, b) => a + b.weight, 0) - 100) < 0.01, "Los pesos deben sumar 100"),
  itemIds: z.array(z.number().int().positive()).min(1, "Seleccione al menos un ítem"),
});
export type InstrumentInput = z.input<typeof instrumentInputSchema>;

/* ---------- Tipos de salida (lo que devuelve la API) ---------- */

export interface User {
  id: number;
  name: string;
  role: Role;
  careerId: number | null;
}

export interface Career { id: number; code: string; name: string }
export interface Module { id: number; careerId: number; code: string; name: string; programVersion: string }
export interface Outcome { id: number; moduleId: number; code: string; text: string }
export interface Criterion { id: number; outcomeId: number; code: string; text: string }

export interface Catalog {
  careers: Career[];
  modules: Module[];
  outcomes: Outcome[];
  criteria: Criterion[];
}

export interface ItemVersion {
  id: number;
  itemId: number;
  versionNo: number;
  authorId: number;
  authorName: string;
  reason: string;
  createdAt: string;
  type: ItemType;
  stem: string;
  payload: ItemPayload;
  points: number;
  moduleId: number;
  outcomeId: number;
  criterionId: number | null;
  bloomLevel: number;
  difficulty: number;
  programVersion: string;
  aiGenerated: boolean;
}

export interface ItemSummary {
  id: number;
  status: Status;
  archived: boolean;
  authorId: number;
  authorName: string;
  current: ItemVersion;
  publishedVersionId: number | null;
}

export interface ItemDetail extends ItemSummary {
  versions: ItemVersion[];
  observations: { id: number; authorName: string; text: string; createdAt: string }[];
  audit: AuditEntry[];
}

export interface AuditEntry {
  id: number;
  at: string;
  userName: string | null;
  action: string;
  entity: string;
  entityId: number | null;
  detail: Record<string, unknown>;
}

export interface InstrumentSummary {
  id: number;
  title: string;
  moduleId: number;
  authorName: string;
  seed: number;
  exigency: number;
  minutes: number;
  itemCount: number;
  totalPoints: number;
}

export interface InstrumentDetail extends InstrumentSummary {
  specs: { outcomeId: number; weight: number }[];
  items: ItemVersion[];
}

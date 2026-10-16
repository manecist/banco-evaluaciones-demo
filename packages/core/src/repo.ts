import { z } from "zod";
import { generateItems, reviewItem, simulatedProvider, simulatedReviewer, type AiRequest, type AiReviewRequest } from "./ai";
import { analyzeItems, type AnswerRow } from "./analysis";
import { LETTERS } from "./grading";
import { toMoodleXml } from "./moodle";
import {
  assertCan,
  can,
  checkTransition,
  ConflictError,
  ForbiddenError,
  isEditable,
  NotFoundError,
  ValidationError,
} from "./permissions";
import {
  instrumentInputSchema,
  itemInputSchema,
  itemSearchSchema,
  transitionSchema,
  type AuditEntry,
  type Catalog,
  type InstrumentDetail,
  type InstrumentSummary,
  type ItemDetail,
  type ItemSummary,
  type ItemVersion,
  type User,
} from "./types";

/**
 * Capa de datos. Recibe cualquier cliente con `query(sql, params)`, así que
 * funciona igual con `pg` (servidor) y con PGlite (demo en el navegador).
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Ejecuta varias sentencias SQL sin parámetros (migraciones y datos iniciales). */
  exec(sql: string): Promise<void>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

type Row = Record<string, any>;

function parseOrThrow<T>(schema: { safeParse(x: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) {
    const issues = r.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
    throw new ValidationError("Datos inválidos", issues);
  }
  return r.data;
}

const VERSION_COLS = `
  v.id, v.item_id, v.version_no, v.author_id, ua.name AS author_name, v.reason, v.created_at,
  v.type, v.stem, v.payload, v.points, v.module_id, v.outcome_id, v.criterion_id,
  v.bloom_level, v.difficulty, v.program_version, v.ai_generated`;

function toVersion(r: Row): ItemVersion {
  return {
    id: r.id,
    itemId: r.item_id,
    versionNo: r.version_no,
    authorId: r.author_id,
    authorName: r.author_name,
    reason: r.reason,
    createdAt: new Date(r.created_at).toISOString(),
    type: r.type,
    stem: r.stem,
    payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
    points: Number(r.points),
    moduleId: r.module_id,
    outcomeId: r.outcome_id,
    criterionId: r.criterion_id,
    bloomLevel: r.bloom_level,
    difficulty: r.difficulty,
    programVersion: r.program_version,
    aiGenerated: r.ai_generated,
  };
}

async function audit(db: Db, userId: number | null, action: string, entity: string, entityId: number | null, detail: object = {}) {
  await db.query(`INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES ($1,$2,$3,$4,$5)`, [
    userId,
    action,
    entity,
    entityId,
    JSON.stringify(detail),
  ]);
}

/* ===================== Catálogo y usuarios ===================== */

export async function getCatalog(db: Db): Promise<Catalog> {
  const [c, m, o, k] = await Promise.all([
    db.query<Row>(`SELECT id, code, name FROM career ORDER BY name`),
    db.query<Row>(`SELECT id, career_id, code, name, program_version FROM module ORDER BY code`),
    db.query<Row>(`SELECT id, module_id, code, text FROM outcome ORDER BY module_id, code`),
    db.query<Row>(`SELECT id, outcome_id, code, text FROM criterion ORDER BY outcome_id, code`),
  ]);
  return {
    careers: c.rows.map((r) => ({ id: r.id, code: r.code, name: r.name })),
    modules: m.rows.map((r) => ({ id: r.id, careerId: r.career_id, code: r.code, name: r.name, programVersion: r.program_version })),
    outcomes: o.rows.map((r) => ({ id: r.id, moduleId: r.module_id, code: r.code, text: r.text })),
    criteria: k.rows.map((r) => ({ id: r.id, outcomeId: r.outcome_id, code: r.code, text: r.text })),
  };
}

export async function listUsers(db: Db): Promise<User[]> {
  const r = await db.query<Row>(`SELECT id, name, role, career_id FROM app_user ORDER BY id`);
  return r.rows.map((x) => ({ id: x.id, name: x.name, role: x.role, careerId: x.career_id }));
}

export async function getUser(db: Db, id: number): Promise<User> {
  const r = await db.query<Row>(`SELECT id, name, role, career_id FROM app_user WHERE id = $1`, [id]);
  const x = r.rows[0];
  if (!x) throw new NotFoundError("Usuario no encontrado");
  return { id: x.id, name: x.name, role: x.role, careerId: x.career_id };
}

export async function getSettings(db: Db): Promise<Record<string, unknown>> {
  const r = await db.query<Row>(`SELECT key, value FROM setting`);
  return Object.fromEntries(r.rows.map((x) => [x.key, typeof x.value === "string" ? JSON.parse(x.value) : x.value]));
}

/** Ajustes que define la UTA (pedagógicos) y los que define Administración (técnicos). */
export const PEDAGOGIC_SETTINGS = ["default_exigency", "coverage_tolerance", "min_responses"] as const;
export const TECHNICAL_SETTINGS = ["ai_enabled", "ai_daily_limit"] as const;

export const settingsPatchSchema = z
  .object({
    default_exigency: z.number().min(0.4).max(0.8),
    coverage_tolerance: z.number().int().min(1).max(20),
    min_responses: z.number().int().min(5).max(500),
    ai_enabled: z.boolean(),
    ai_daily_limit: z.number().int().min(0).max(200),
  })
  .partial()
  .strict();

export async function updateSettings(db: Db, user: User, raw: unknown): Promise<Record<string, unknown>> {
  const patch = parseOrThrow(settingsPatchSchema, raw);
  for (const key of Object.keys(patch)) {
    const technical = (TECHNICAL_SETTINGS as readonly string[]).includes(key);
    assertCan(user, technical ? "settings:technical" : "settings:pedagogic");
  }
  await db.tx(async (tx) => {
    for (const [key, value] of Object.entries(patch)) {
      await tx.query(`UPDATE setting SET value = $2::jsonb WHERE key = $1`, [key, JSON.stringify(value)]);
    }
    await audit(tx, user.id, "configuracion", "setting", null, patch);
  });
  return getSettings(db);
}

/** Resumen de una carrera para la jefatura: estado del banco, pendientes y alertas. */
export async function careerSummary(db: Db, user: User) {
  assertCan(user, "career:dashboard");
  if (!user.careerId) throw new ValidationError("La jefatura no tiene una carrera asignada");
  const byStatus = await db.query<Row>(
    `SELECT i.status, count(*)::int AS n FROM item i
       JOIN item_version v ON v.id = i.current_version JOIN module m ON m.id = v.module_id
      WHERE m.career_id = $1 AND NOT i.archived GROUP BY i.status`,
    [user.careerId],
  );
  const byModule = await db.query<Row>(
    `SELECT m.id, m.code, m.name,
            count(*) FILTER (WHERE i.status = 'visado')::int AS visados,
            count(*) FILTER (WHERE i.status IN ('recepcionado','en_revision'))::int AS en_revision,
            count(*) FILTER (WHERE i.status IN ('borrador','devuelto'))::int AS en_redaccion
       FROM module m
       LEFT JOIN item_version v ON v.module_id = m.id
       LEFT JOIN item i ON i.current_version = v.id AND NOT i.archived
      WHERE m.career_id = $1 GROUP BY m.id ORDER BY m.code`,
    [user.careerId],
  );
  const instruments = (await listInstruments(db, user)).filter((x) => byModule.rows.some((m) => m.id === x.moduleId));
  const withAnalysis = [];
  for (const ins of instruments) {
    const a = await analyzeInstrument(db, user, ins.id);
    withAnalysis.push({
      id: ins.id,
      title: ins.title,
      students: a.students,
      priority: a.stats.filter((s) => s.alerts.some((x) => x.startsWith("PRIORITARIO"))).length,
      alerts: a.stats.filter((s) => s.alerts.length > 0).length,
    });
  }
  return {
    careerId: user.careerId,
    byStatus: Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n])) as Record<string, number>,
    modules: byModule.rows.map((r) => ({ id: r.id, code: r.code, name: r.name, visados: r.visados, enRevision: r.en_revision, enRedaccion: r.en_redaccion })),
    instruments: withAnalysis,
  };
}

/* ===================== Ítems ===================== */

export async function searchItems(db: Db, user: User, rawFilters: unknown): Promise<ItemSummary[]> {
  assertCan(user, "item:read");
  const f = parseOrThrow(itemSearchSchema, rawFilters ?? {});
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };

  if (!f.includeArchived) where.push("NOT i.archived");
  // RF-07: un docente ve lo propio y el banco institucional (visados).
  if (user.role === "docente") where.push(`(i.author_id = ${p(user.id)} OR i.status = 'visado')`);
  if (f.moduleId) where.push(`v.module_id = ${p(f.moduleId)}`);
  if (f.careerId) where.push(`m.career_id = ${p(f.careerId)}`);
  if (f.outcomeId) where.push(`v.outcome_id = ${p(f.outcomeId)}`);
  if (f.bloomLevel) where.push(`v.bloom_level = ${p(f.bloomLevel)}`);
  if (f.type) where.push(`v.type = ${p(f.type)}`);
  if (f.status) where.push(`i.status = ${p(f.status)}`);
  if (f.authorId) where.push(`i.author_id = ${p(f.authorId)}`);

  let order = "i.id DESC";
  const q = f.q?.trim();
  if (q) {
    // Búsqueda en español tolerante a tildes y errores de tipeo (unaccent + trigramas).
    const ph = p(q);
    where.push(`(v.search_text ILIKE '%' || lower(f_unaccent(${ph})) || '%' OR word_similarity(lower(f_unaccent(${ph})), v.search_text) > 0.45)`);
    order = `word_similarity(lower(f_unaccent(${ph})), v.search_text) DESC, i.id DESC`;
  }

  const sql = `
    SELECT i.id AS i_id, i.status, i.archived, i.author_id AS i_author, ui.name AS i_author_name, i.published_version,
           ${VERSION_COLS}
    FROM item i
    JOIN item_version v ON v.id = i.current_version
    JOIN module m ON m.id = v.module_id
    JOIN app_user ua ON ua.id = v.author_id
    JOIN app_user ui ON ui.id = i.author_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY ${order}
    LIMIT 200`;
  const r = await db.query<Row>(sql, params);
  return r.rows.map((x) => ({
    id: x.i_id,
    status: x.status,
    archived: x.archived,
    authorId: x.i_author,
    authorName: x.i_author_name,
    publishedVersionId: x.published_version,
    current: toVersion(x),
  }));
}

async function loadItem(db: Db, id: number): Promise<Row> {
  const r = await db.query<Row>(`SELECT * FROM item WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new NotFoundError(`Ítem ${id} no encontrado`);
  return r.rows[0];
}

export async function getItem(db: Db, user: User, id: number): Promise<ItemDetail> {
  assertCan(user, "item:read");
  const item = await loadItem(db, id);
  if (user.role === "docente" && item.author_id !== user.id && item.status !== "visado") {
    throw new ForbiddenError("No tiene acceso a este ítem");
  }
  const [versions, obs, aud, author] = await Promise.all([
    db.query<Row>(`SELECT ${VERSION_COLS} FROM item_version v JOIN app_user ua ON ua.id = v.author_id WHERE v.item_id = $1 ORDER BY v.version_no DESC`, [id]),
    db.query<Row>(`SELECT o.id, u.name, o.text, o.created_at FROM observation o JOIN app_user u ON u.id = o.author_id WHERE o.item_id = $1 ORDER BY o.id DESC`, [id]),
    db.query<Row>(`SELECT a.id, a.at, u.name, a.action, a.entity, a.entity_id, a.detail FROM audit_log a LEFT JOIN app_user u ON u.id = a.user_id WHERE a.entity = 'item' AND a.entity_id = $1 ORDER BY a.id DESC`, [id]),
    db.query<Row>(`SELECT name FROM app_user WHERE id = $1`, [item.author_id]),
  ]);
  const vs = versions.rows.map(toVersion);
  const current = vs.find((v) => v.id === item.current_version)!;
  return {
    id,
    status: item.status,
    archived: item.archived,
    authorId: item.author_id,
    authorName: author.rows[0]?.name ?? "",
    publishedVersionId: item.published_version,
    current,
    versions: vs,
    observations: obs.rows.map((o) => ({ id: o.id, authorName: o.name, text: o.text, createdAt: new Date(o.created_at).toISOString() })),
    audit: aud.rows.map(toAudit),
  };
}

function toAudit(a: Row): AuditEntry {
  return {
    id: Number(a.id),
    at: new Date(a.at).toISOString(),
    userName: a.name ?? null,
    action: a.action,
    entity: a.entity,
    entityId: a.entity_id,
    detail: typeof a.detail === "string" ? JSON.parse(a.detail) : a.detail,
  };
}

async function insertVersion(db: Db, itemId: number, userId: number, input: ReturnType<typeof itemInputSchema.parse>) {
  // Los metadatos curriculares vienen del catálogo, no se escriben a mano (RF-03).
  const chk = await db.query<Row>(
    `SELECT m.program_version FROM outcome o JOIN module m ON m.id = o.module_id WHERE o.id = $1 AND m.id = $2`,
    [input.outcomeId, input.moduleId],
  );
  if (!chk.rows[0]) throw new ValidationError("El resultado de aprendizaje no pertenece al módulo seleccionado");
  if (input.criterionId) {
    const c = await db.query(`SELECT 1 FROM criterion WHERE id = $1 AND outcome_id = $2`, [input.criterionId, input.outcomeId]);
    if (!c.rows[0]) throw new ValidationError("El criterio no pertenece al resultado de aprendizaje");
  }
  const next = await db.query<Row>(`SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM item_version WHERE item_id = $1`, [itemId]);
  const r = await db.query<Row>(
    `INSERT INTO item_version (item_id, version_no, author_id, reason, type, stem, payload, points, module_id, outcome_id,
                               criterion_id, bloom_level, difficulty, program_version, ai_generated)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, version_no`,
    [
      itemId,
      next.rows[0]!.n,
      userId,
      input.reason,
      input.payload.type,
      input.stem,
      JSON.stringify(input.payload),
      input.points,
      input.moduleId,
      input.outcomeId,
      input.criterionId,
      input.bloomLevel,
      input.difficulty,
      chk.rows[0].program_version,
      input.aiGenerated,
    ],
  );
  return r.rows[0]!;
}

export async function createItem(db: Db, user: User, raw: unknown): Promise<ItemDetail> {
  assertCan(user, "item:create");
  const input = parseOrThrow(itemInputSchema, raw);
  const id = await db.tx(async (tx) => {
    const it = await tx.query<Row>(`INSERT INTO item (author_id) VALUES ($1) RETURNING id`, [user.id]);
    const itemId = it.rows[0]!.id as number;
    const v = await insertVersion(tx, itemId, user.id, { ...input, reason: input.reason || "Creación" });
    await tx.query(`UPDATE item SET current_version = $1 WHERE id = $2`, [v.id, itemId]);
    await audit(tx, user.id, "crear", "item", itemId, { version: 1, ia: input.aiGenerated });
    return itemId;
  });
  return getItem(db, user, id);
}

export async function updateItem(db: Db, user: User, id: number, raw: unknown): Promise<ItemDetail> {
  assertCan(user, "item:edit_own");
  const input = parseOrThrow(itemInputSchema, raw);
  await db.tx(async (tx) => {
    const item = await loadItem(tx, id);
    if (item.author_id !== user.id && user.role !== "area_curricular") throw new ForbiddenError("Solo puede editar sus propios ítems");
    if (!isEditable(item.status)) throw new ConflictError(`El ítem está "${item.status}": no se puede editar mientras se revisa`);
    if (item.archived) throw new ConflictError("El ítem está archivado");
    const v = await insertVersion(tx, id, user.id, input);
    // Editar un ítem visado crea un borrador; la versión publicada sigue vigente (RF-06).
    const newStatus = item.status === "visado" ? "borrador" : item.status;
    await tx.query(`UPDATE item SET current_version = $1, status = $2 WHERE id = $3`, [v.id, newStatus, id]);
    await audit(tx, user.id, "nueva_version", "item", id, { version: v.version_no, motivo: input.reason });
  });
  return getItem(db, user, id);
}

export async function restoreVersion(db: Db, user: User, id: number, versionId: number): Promise<ItemDetail> {
  const detail = await getItem(db, user, id);
  const v = detail.versions.find((x) => x.id === versionId);
  if (!v) throw new NotFoundError("Versión no encontrada");
  // Restaurar NO reescribe la historia: crea una versión nueva con ese contenido.
  return updateItem(db, user, id, {
    stem: v.stem,
    payload: v.payload,
    points: v.points,
    moduleId: v.moduleId,
    outcomeId: v.outcomeId,
    criterionId: v.criterionId,
    bloomLevel: v.bloomLevel,
    difficulty: v.difficulty,
    aiGenerated: v.aiGenerated,
    reason: `Restaurada desde la versión ${v.versionNo}`,
  });
}

export async function transitionItem(db: Db, user: User, id: number, raw: unknown): Promise<ItemDetail> {
  const { to, comment } = parseOrThrow(transitionSchema, raw);
  await db.tx(async (tx) => {
    const item = await loadItem(tx, id);
    checkTransition({ user, authorId: item.author_id, from: item.status, to, comment });
    if (to === "recepcionado") {
      // Validación de obligatorios antes de enviar (RF-05).
      const v = await tx.query<Row>(`SELECT stem, payload, ai_generated FROM item_version WHERE id = $1`, [item.current_version]);
      const row = v.rows[0]!;
      const missing: string[] = [];
      if (!String(row.stem).trim()) missing.push("enunciado");
      if (missing.length) throw new ValidationError("Faltan campos obligatorios", missing);
    }
    if (to === "visado") {
      await tx.query(`UPDATE item SET status = 'visado', published_version = current_version WHERE id = $1`, [id]);
    } else {
      await tx.query(`UPDATE item SET status = $1 WHERE id = $2`, [to, id]);
    }
    if (comment?.trim()) {
      await tx.query(`INSERT INTO observation (item_id, author_id, text) VALUES ($1,$2,$3)`, [id, user.id, comment.trim()]);
    }
    await audit(tx, user.id, `estado:${to}`, "item", id, { desde: item.status, comentario: comment ?? null });
  });
  return getItem(db, user, id);
}

export async function archiveItem(db: Db, user: User, id: number): Promise<ItemDetail> {
  assertCan(user, "item:archive");
  await loadItem(db, id);
  // Archivar no borra (RF-01): el ítem sale de las búsquedas pero conserva su historia.
  await db.query(`UPDATE item SET archived = true WHERE id = $1`, [id]);
  await audit(db, user.id, "archivar", "item", id);
  return getItem(db, user, id);
}

export async function recordAdvisorDecision(
  db: Db,
  user: User,
  versionId: number,
  d: { rule: string; message: string; decision: "aceptada" | "descartada" | "modificada" },
): Promise<void> {
  await db.query(`INSERT INTO advisor_decision (item_version_id, rule, message, decision, user_id) VALUES ($1,$2,$3,$4,$5)`, [
    versionId,
    d.rule,
    d.message,
    d.decision,
    user.id,
  ]);
}

/* ===================== Instrumentos ===================== */

export async function listInstruments(db: Db, user: User): Promise<InstrumentSummary[]> {
  assertCan(user, "item:read");
  const r = await db.query<Row>(`
    SELECT ins.*, u.name AS author_name,
           COUNT(ii.item_version_id)::int AS item_count, COALESCE(SUM(v.points), 0) AS total_points
    FROM instrument ins
    JOIN app_user u ON u.id = ins.author_id
    LEFT JOIN instrument_item ii ON ii.instrument_id = ins.id
    LEFT JOIN item_version v ON v.id = ii.item_version_id
    GROUP BY ins.id, u.name
    ORDER BY ins.id DESC`);
  return r.rows.map(toInstrumentSummary);
}

function toInstrumentSummary(r: Row): InstrumentSummary {
  return {
    id: r.id,
    title: r.title,
    moduleId: r.module_id,
    authorName: r.author_name,
    seed: r.seed,
    exigency: Number(r.exigency),
    minutes: r.minutes,
    itemCount: Number(r.item_count),
    totalPoints: Number(r.total_points),
  };
}

export async function getInstrument(db: Db, user: User, id: number): Promise<InstrumentDetail> {
  const all = await listInstruments(db, user);
  const s = all.find((x) => x.id === id);
  if (!s) throw new NotFoundError("Instrumento no encontrado");
  const [specs, items] = await Promise.all([
    db.query<Row>(`SELECT outcome_id, weight FROM instrument_spec WHERE instrument_id = $1 ORDER BY outcome_id`, [id]),
    db.query<Row>(
      `SELECT ${VERSION_COLS} FROM instrument_item ii JOIN item_version v ON v.id = ii.item_version_id
       JOIN app_user ua ON ua.id = v.author_id WHERE ii.instrument_id = $1 ORDER BY ii.position`,
      [id],
    ),
  ]);
  return {
    ...s,
    specs: specs.rows.map((r) => ({ outcomeId: r.outcome_id, weight: Number(r.weight) })),
    items: items.rows.map(toVersion),
  };
}

export async function createInstrument(db: Db, user: User, raw: unknown): Promise<InstrumentDetail> {
  assertCan(user, "instrument:create");
  const input = parseOrThrow(instrumentInputSchema, raw);
  const id = await db.tx(async (tx) => {
    // Solo ítems visados; se fija la versión publicada de cada uno.
    const r = await tx.query<Row>(`SELECT id, status, published_version FROM item WHERE id = ANY($1::int[])`, [input.itemIds]);
    const notReady = input.itemIds.filter((iid) => !r.rows.find((x) => x.id === iid && x.published_version));
    if (notReady.length) throw new ValidationError("Solo se pueden usar ítems visados", notReady.map((x) => `Ítem ${x} sin versión visada`));
    const ins = await tx.query<Row>(
      `INSERT INTO instrument (title, module_id, author_id, seed, exigency, minutes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [input.title, input.moduleId, user.id, input.seed, input.exigency, input.minutes],
    );
    const insId = ins.rows[0]!.id as number;
    for (const s of input.specs) {
      await tx.query(`INSERT INTO instrument_spec (instrument_id, outcome_id, weight) VALUES ($1,$2,$3)`, [insId, s.outcomeId, s.weight]);
    }
    let pos = 1;
    for (const iid of input.itemIds) {
      const pv = r.rows.find((x) => x.id === iid)!.published_version;
      await tx.query(`INSERT INTO instrument_item (instrument_id, item_version_id, position) VALUES ($1,$2,$3)`, [insId, pv, pos++]);
    }
    await audit(tx, user.id, "crear", "instrument", insId, { items: input.itemIds.length });
    return insId;
  });
  return getInstrument(db, user, id);
}

/* ===================== Exportación y análisis ===================== */

export async function exportMoodle(db: Db, user: User, opts: { instrumentId?: number; itemIds?: number[] }): Promise<{ xml: string; count: number; skipped: number[] }> {
  assertCan(user, "export:moodle");
  let versions: ItemVersion[];
  const skipped: number[] = [];
  if (opts.instrumentId) {
    versions = (await getInstrument(db, user, opts.instrumentId)).items;
  } else {
    // Por defecto se exporta solo lo visado, en su versión publicada.
    const ids = opts.itemIds ?? [];
    const r = await db.query<Row>(
      `SELECT ${VERSION_COLS}, i.id AS iid FROM item i JOIN item_version v ON v.id = i.published_version
       JOIN app_user ua ON ua.id = v.author_id WHERE NOT i.archived ORDER BY i.id`,
    );
    const rows = ids.length ? r.rows.filter((x) => ids.includes(x.iid)) : r.rows;
    for (const id of ids) if (!rows.find((x) => x.iid === id)) skipped.push(id);
    versions = rows.map(toVersion);
  }
  const cat = await getCatalog(db);
  const xml = toMoodleXml(versions, {
    careerName: (mid) => cat.careers.find((c) => c.id === cat.modules.find((m) => m.id === mid)?.careerId)?.name ?? "Carrera",
    moduleName: (mid) => {
      const m = cat.modules.find((x) => x.id === mid);
      return m ? `${m.code} ${m.name}` : "Módulo";
    },
    outcomeCode: (oid) => cat.outcomes.find((o) => o.id === oid)?.code ?? "RA",
  });
  await audit(db, user.id, "exportar_moodle", opts.instrumentId ? "instrument" : "item", opts.instrumentId ?? null, { preguntas: versions.length });
  return { xml, count: versions.length, skipped };
}

export async function analyzeInstrument(db: Db, user: User, instrumentId: number) {
  assertCan(user, "analysis:read");
  const ins = await getInstrument(db, user, instrumentId);
  const settings = await getSettings(db);
  const r = await db.query<Row>(
    `SELECT a.student_code, an.item_version_id, an.score, an.choice, v.points
     FROM answer an JOIN attempt a ON a.id = an.attempt_id JOIN item_version v ON v.id = an.item_version_id
     WHERE a.instrument_id = $1`,
    [instrumentId],
  );
  const rows: AnswerRow[] = r.rows.map((x) => ({
    student: x.student_code,
    itemId: x.item_version_id,
    score: Number(x.score),
    max: Number(x.points),
    choice: x.choice,
  }));
  const correctChoice: Record<number, string> = {};
  for (const v of ins.items) {
    if (v.payload.type === "seleccion_multiple") {
      const idx = v.payload.alternatives.findIndex((a) => a.correct);
      correctChoice[v.id] = LETTERS[idx] ?? "A";
    }
  }
  const stats = analyzeItems(rows, { minResponses: Number(settings.min_responses ?? 30), correctChoice });
  const students = new Set(rows.map((x) => x.student)).size;
  return { instrument: ins, students, stats, correctChoice };
}

export async function listAudit(db: Db, user: User, limit = 100): Promise<AuditEntry[]> {
  assertCan(user, "audit:read");
  const r = await db.query<Row>(
    `SELECT a.id, a.at, u.name, a.action, a.entity, a.entity_id, a.detail FROM audit_log a
     LEFT JOIN app_user u ON u.id = a.user_id ORDER BY a.id DESC LIMIT $1`,
    [limit],
  );
  return r.rows.map(toAudit);
}

/* ===================== Asistente de IA ===================== */

export async function aiDraftItems(db: Db, user: User, req: AiRequest & { moduleId: number; outcomeId: number }) {
  assertCan(user, "ai:use");
  const settings = await getSettings(db);
  if (settings.ai_enabled === false) throw new ConflictError("El asistente de IA está desactivado por la institución");
  const today = await db.query<Row>(
    `SELECT COALESCE(SUM(accepted), 0)::int AS n FROM ai_usage WHERE user_id = $1 AND at::date = now()::date`,
    [user.id],
  );
  const dailyLimit = Number(settings.ai_daily_limit ?? 20);
  if (Number(today.rows[0]!.n) + req.count > dailyLimit) throw new ConflictError(`Límite diario del asistente alcanzado (${dailyLimit} ítems)`);

  const result = await generateItems(simulatedProvider, req);
  const created: ItemDetail[] = [];
  for (const it of result.accepted) {
    created.push(
      await createItem(db, user, {
        stem: it.stem,
        payload: it.payload,
        points: 1,
        moduleId: req.moduleId,
        outcomeId: req.outcomeId,
        bloomLevel: it.bloomLevel,
        difficulty: it.difficulty,
        reason: "Propuesta del asistente de IA (pendiente de revisión humana)",
        aiGenerated: true,
      }),
    );
  }
  await db.query(
    `INSERT INTO ai_usage (user_id, provider, model, tokens_in, tokens_out, cost_clp, accepted, discarded) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [user.id, simulatedProvider.name, simulatedProvider.model, result.tokensIn, result.tokensOut, result.costClp, result.accepted.length, result.discarded],
  );
  return { created, discarded: result.discarded, piiRemoved: result.piiRemoved, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costClp: result.costClp, model: simulatedProvider.model };
}

/** Segunda opinión de la IA sobre un ítem en redacción. Solo comenta: no cambia la clave. */
export async function aiReviewItem(db: Db, user: User, req: AiReviewRequest) {
  // La usa quien redacta (docente) y también quien revisa, que puede no ser experto en la materia.
  if (!can(user, "ai:use") && !can(user, "item:review")) assertCan(user, "ai:use");
  const settings = await getSettings(db);
  if (settings.ai_enabled === false) throw new ConflictError("El asistente de IA está desactivado por la institución");
  const r = await reviewItem(simulatedReviewer, req);
  await audit(db, user.id, "ia_segunda_opinion", "item", null, { modelo: r.model, clave: r.keyAssessment, observaciones: r.observations.length });
  return r;
}

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  aiDraftItems, analyzeInstrument, archiveItem, createInstrument, createItem, exportMoodle, getItem, getUser, listAudit,
  migrate, restoreVersion, searchItems, seed, transitionItem, updateItem, type User,
} from "../src";
import { createPgliteDb } from "../src/adapters/pglite";

let db: Awaited<ReturnType<typeof createPgliteDb>>;
let paula: User, jorge: User, camila: User, andrea: User, jefe: User;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
  await seed(db);
  [paula, jorge, camila, andrea, jefe] = await Promise.all([1, 2, 3, 4, 5].map((id) => getUser(db, id)));
});
afterAll(async () => db.close());

const base = { stem: "Identifique el valor normal de saturación de oxígeno en un paciente adulto", points: 2, moduleId: 1, outcomeId: 1, bloomLevel: 1, difficulty: 2,
  payload: { type: "verdadero_falso" as const, answer: true } };

describe("banco de ítems sobre PostgreSQL (PGlite)", () => {
  it("busca sin tildes y con errores de tipeo", async () => {
    const a = await searchItems(db, andrea, { q: "presion arterial" });
    expect(a.length).toBeGreaterThan(0);
    const b = await searchItems(db, andrea, { q: "higene de manos" });
    expect(b.some((x) => /higiene de manos/i.test(x.current.stem))).toBe(true);
  });

  it("un docente ve lo propio y lo visado, no los borradores ajenos", async () => {
    const r = await searchItems(db, paula, {});
    expect(r.every((x) => x.authorId === paula.id || x.status === "visado")).toBe(true);
    const jorgeDraft = (await searchItems(db, andrea, { authorId: jorge.id })).find((x) => x.status === "borrador")!;
    await expect(getItem(db, paula, jorgeDraft.id)).rejects.toThrow(/acceso/);
  });

  it("versiones inmutables, también en la base de datos", async () => {
    const it0 = await createItem(db, paula, base);
    const v1 = it0.current.id;
    await expect(db.query(`UPDATE item_version SET stem = 'x' WHERE id = $1`, [v1])).rejects.toThrow(/inmutables/);
    await expect(db.query(`DELETE FROM item_version WHERE id = $1`, [v1])).rejects.toThrow(/inmutables/);
    const it1 = await updateItem(db, paula, it0.id, { ...base, stem: base.stem + " (corregido)", reason: "Ajuste" });
    expect(it1.versions).toHaveLength(2);
    const it2 = await restoreVersion(db, paula, it0.id, v1);
    expect(it2.versions).toHaveLength(3);
    expect(it2.current.stem).toBe(base.stem);
    expect(it2.current.reason).toMatch(/Restaurada desde la versión 1/);
  });

  it("flujo de visación con reglas: nadie visa lo propio y devolver exige comentario", async () => {
    const it = await createItem(db, andrea, base);
    await transitionItem(db, andrea, it.id, { to: "recepcionado" });
    await expect(transitionItem(db, andrea, it.id, { to: "en_revision" })).rejects.toThrow(/propios/);
    await expect(transitionItem(db, paula, it.id, { to: "en_revision" })).rejects.toThrow(/permiso/);
    await transitionItem(db, camila, it.id, { to: "en_revision" });
    await expect(updateItem(db, andrea, it.id, base)).rejects.toThrow(/revisa/);
    await expect(transitionItem(db, camila, it.id, { to: "devuelto" })).rejects.toThrow(/comentario/);
    const done = await transitionItem(db, camila, it.id, { to: "visado" });
    expect(done.status).toBe("visado");
    expect(done.publishedVersionId).toBe(done.current.id);
  });

  it("editar un visado crea un borrador y deja vigente la versión publicada", async () => {
    const visado = (await searchItems(db, paula, { status: "visado", authorId: paula.id }))[0]!;
    const before = visado.publishedVersionId;
    const v = visado.current;
    const r = await updateItem(db, paula, visado.id, {
      stem: v.stem + " ", payload: v.payload, points: v.points, moduleId: v.moduleId, outcomeId: v.outcomeId,
      criterionId: v.criterionId, bloomLevel: v.bloomLevel, difficulty: v.difficulty, reason: "Mejora de redacción",
    });
    expect(r.status).toBe("borrador");
    expect(r.publishedVersionId).toBe(before);
    expect(r.current.id).not.toBe(before);
  });

  it("valida que el resultado de aprendizaje pertenezca al módulo", async () => {
    await expect(createItem(db, paula, { ...base, outcomeId: 3 })).rejects.toThrow(/no pertenece/);
  });

  it("instrumentos solo con ítems visados", async () => {
    const draft = await createItem(db, paula, base);
    await expect(
      createInstrument(db, paula, { title: "X", moduleId: 1, specs: [{ outcomeId: 1, weight: 100 }], itemIds: [draft.id] }),
    ).rejects.toThrow(/visados/);
    await expect(
      createInstrument(db, paula, { title: "X", moduleId: 1, specs: [{ outcomeId: 1, weight: 90 }], itemIds: [1] }),
    ).rejects.toThrow(/inválidos/);
  });

  it("análisis de ítems sobre respuestas simuladas", async () => {
    const r = await analyzeInstrument(db, paula, 1);
    expect(r.students).toBe(64);
    const negative = r.stats.filter((s) => s.D < 0);
    expect(negative.length).toBeGreaterThanOrEqual(1);
    expect(r.stats.some((s) => s.alerts.some((a) => /grupo alto/.test(a)))).toBe(true);
  });

  it("exporta a Moodle solo lo visado", async () => {
    const r = await exportMoodle(db, jefe, {});
    expect(r.count).toBeGreaterThan(0);
    expect(r.xml).toContain("<quiz>");
  });

  it("asistente de IA: descarta lo inválido y deja borradores marcados", async () => {
    const r = await aiDraftItems(db, paula, { outcomeText: "Controlar signos vitales", count: 2, context: "un servicio de urgencia, paciente 12.345.678-9", moduleId: 1, outcomeId: 1 });
    expect(r.created).toHaveLength(2);
    expect(r.discarded).toBe(1);
    expect(r.piiRemoved).toBe(1);
    expect(r.created.every((c) => c.status === "borrador" && c.current.aiGenerated)).toBe(true);
  });

  it("archivar no borra y todo queda auditado", async () => {
    const r = await archiveItem(db, andrea, 1);
    expect(r.archived).toBe(true);
    expect((await searchItems(db, andrea, {})).some((x) => x.id === 1)).toBe(false);
    const log = await listAudit(db, andrea);
    expect(log.some((a) => a.action === "archivar")).toBe(true);
    await expect(listAudit(db, paula)).rejects.toThrow(/permiso/);
  });
});

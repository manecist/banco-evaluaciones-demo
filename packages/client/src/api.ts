import type {
  AuditEntry,
  Catalog,
  InstrumentDetail,
  InstrumentInput,
  InstrumentSummary,
  ItemDetail,
  ItemInput,
  ItemSearch,
  ItemStats,
  ItemSummary,
  Status,
  User,
} from "@banco/core";

export interface AiResult {
  created: ItemDetail[];
  discarded: number;
  piiRemoved: number;
  tokensIn: number;
  tokensOut: number;
  costClp: number;
  model: string;
}

export interface Analysis {
  instrument: InstrumentDetail;
  students: number;
  stats: ItemStats[];
  correctChoice: Record<number, string>;
}

/** Misma interfaz para el servidor real (HTTP) y para el demo en el navegador (PGlite). */
export interface Api {
  mode: "http" | "local";
  demoUsers(): Promise<User[]>;
  login(userId: number): Promise<User>;
  catalog(): Promise<Catalog>;
  settings(): Promise<Record<string, unknown>>;
  searchItems(f: ItemSearch): Promise<ItemSummary[]>;
  getItem(id: number): Promise<ItemDetail>;
  createItem(input: ItemInput): Promise<ItemDetail>;
  updateItem(id: number, input: ItemInput): Promise<ItemDetail>;
  transition(id: number, to: Status, comment?: string): Promise<ItemDetail>;
  restore(id: number, versionId: number): Promise<ItemDetail>;
  archive(id: number): Promise<ItemDetail>;
  advisorDecision(versionId: number, d: { rule: string; message: string; decision: "aceptada" | "descartada" | "modificada" }): Promise<void>;
  instruments(): Promise<InstrumentSummary[]>;
  instrument(id: number): Promise<InstrumentDetail>;
  createInstrument(input: InstrumentInput): Promise<InstrumentDetail>;
  analysis(id: number): Promise<Analysis>;
  exportMoodle(opts: { instrumentId?: number; itemIds?: number[] }): Promise<string>;
  aiDraft(req: { moduleId: number; outcomeId: number; outcomeText: string; count: number; context: string }): Promise<AiResult>;
  audit(): Promise<AuditEntry[]>;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly issues: string[] = []) {
    super(message);
  }
}

export function createHttpApi(): Api {
  let token = "";
  async function call<T>(method: string, url: string, body?: unknown, raw = false): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(e.error ?? "Error", res.status, e.issues ?? []);
    }
    if (res.status === 204) return undefined as T;
    return (raw ? res.text() : res.json()) as Promise<T>;
  }
  const qs = (o: object) =>
    new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();

  return {
    mode: "http",
    demoUsers: () => call("GET", "/api/auth/demo-users"),
    login: async (userId) => {
      const r = await call<{ token: string; user: User }>("POST", "/api/auth/demo-login", { userId });
      token = r.token;
      return r.user;
    },
    catalog: () => call("GET", "/api/catalog"),
    settings: () => call("GET", "/api/settings"),
    searchItems: (f) => call("GET", `/api/items?${qs(f)}`),
    getItem: (id) => call("GET", `/api/items/${id}`),
    createItem: (i) => call("POST", "/api/items", i),
    updateItem: (id, i) => call("PUT", `/api/items/${id}`, i),
    transition: (id, to, comment) => call("POST", `/api/items/${id}/transition`, { to, comment }),
    restore: (id, v) => call("POST", `/api/items/${id}/restore/${v}`),
    archive: (id) => call("POST", `/api/items/${id}/archive`),
    advisorDecision: (v, d) => call("POST", `/api/item-versions/${v}/advisor-decisions`, d),
    instruments: () => call("GET", "/api/instruments"),
    instrument: (id) => call("GET", `/api/instruments/${id}`),
    createInstrument: (i) => call("POST", "/api/instruments", i),
    analysis: (id) => call("GET", `/api/instruments/${id}/analysis`),
    exportMoodle: (o) => call("GET", `/api/export/moodle?${qs({ instrumentId: o.instrumentId, itemIds: o.itemIds?.join(",") })}`, undefined, true),
    aiDraft: (r) => call("POST", "/api/ai/draft", r),
    audit: () => call("GET", "/api/audit"),
  };
}

/**
 * Demo sin servidor: PostgreSQL (PGlite) corre dentro del navegador y se usa
 * EXACTAMENTE la misma capa de datos, permisos y validaciones que la API.
 */
export async function createLocalApi(onProgress?: (msg: string) => void): Promise<Api> {
  const core = await import("@banco/core");
  const { createPgliteDb } = await import("@banco/core/pglite");
  onProgress?.("Iniciando PostgreSQL en el navegador…");
  const db = await createPgliteDb();
  onProgress?.("Creando tablas…");
  await core.migrate(db);
  onProgress?.("Cargando datos de prueba (ficticios)…");
  await core.seed(db);

  let user: User | null = null;
  const u = () => {
    if (!user) throw new ApiError("Inicie sesión", 401);
    return user;
  };
  const wrap = async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e: any) {
      throw new ApiError(e.message ?? "Error", e.status ?? 500, e.issues ?? []);
    }
  };

  return {
    mode: "local",
    demoUsers: () => core.listUsers(db),
    login: async (id) => (user = await core.getUser(db, id)),
    catalog: () => core.getCatalog(db),
    settings: () => core.getSettings(db),
    searchItems: (f) => wrap(() => core.searchItems(db, u(), f)),
    getItem: (id) => wrap(() => core.getItem(db, u(), id)),
    createItem: (i) => wrap(() => core.createItem(db, u(), i)),
    updateItem: (id, i) => wrap(() => core.updateItem(db, u(), id, i)),
    transition: (id, to, comment) => wrap(() => core.transitionItem(db, u(), id, { to, comment })),
    restore: (id, v) => wrap(() => core.restoreVersion(db, u(), id, v)),
    archive: (id) => wrap(() => core.archiveItem(db, u(), id)),
    advisorDecision: (v, d) => wrap(() => core.recordAdvisorDecision(db, u(), v, d)),
    instruments: () => wrap(() => core.listInstruments(db, u())),
    instrument: (id) => wrap(() => core.getInstrument(db, u(), id)),
    createInstrument: (i) => wrap(() => core.createInstrument(db, u(), i)),
    analysis: (id) => wrap(() => core.analyzeInstrument(db, u(), id)),
    exportMoodle: (o) => wrap(async () => (await core.exportMoodle(db, u(), o)).xml),
    aiDraft: (r) => wrap(() => core.aiDraftItems(db, u(), r)),
    audit: () => wrap(() => core.listAudit(db, u())),
  };
}

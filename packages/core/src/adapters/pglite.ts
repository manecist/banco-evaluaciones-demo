import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import type { Db } from "../repo";

/** PostgreSQL en WebAssembly: se usa en las pruebas y en el demo del navegador. */
export async function createPgliteDb(dataDir?: string): Promise<Db & { close(): Promise<void> }> {
  const pg = await PGlite.create(dataDir, { extensions: { pg_trgm, unaccent } });
  type Q = Pick<PGlite, "query" | "exec">;
  const wrap = (q: Q): Db => ({
    query: async (sql, params) => {
      const r = await q.query(sql, params as any[]);
      return { rows: r.rows as any[] };
    },
    exec: async (sql) => {
      await q.exec(sql);
    },
    tx: (fn) => pg.transaction((t) => fn(wrap(t as unknown as Q))),
  });
  return { ...wrap(pg), close: () => pg.close() };
}

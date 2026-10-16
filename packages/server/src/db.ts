import pg from "pg";
import type { Db } from "@banco/core";

/** Adaptador de `pg` (PostgreSQL 16) a la interfaz Db del núcleo. */
export function createPgDb(connectionString: string): Db & { end(): Promise<void> } {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const wrap = (q: Pick<pg.PoolClient, "query">): Db => ({
    query: async (sql, params) => {
      const r = await q.query(sql, params as unknown[]);
      return { rows: r.rows };
    },
    exec: async (sql) => {
      await q.query(sql);
    },
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn(wrap(client));
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
  });
  return { ...wrap(pool), end: () => pool.end() };
}

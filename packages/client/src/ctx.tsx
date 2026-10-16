import { createContext, useContext, useEffect, useState } from "react";
import { can, type Action, type Catalog, type User } from "@banco/core";
import type { Api } from "./api";

export interface Ctx {
  api: Api;
  user: User;
  catalog: Catalog;
  can(a: Action): boolean;
  go(view: View): void;
  toast(msg: string, kind?: "ok" | "error"): void;
}

export type View =
  | { name: "items" }
  | { name: "item"; id: number }
  | { name: "edit"; id?: number }
  | { name: "instruments" }
  | { name: "instrument"; id: number }
  | { name: "new-instrument" }
  | { name: "analysis"; id: number }
  | { name: "ai" }
  | { name: "audit" }
  | { name: "about" };

export const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;
export const makeCan = (u: User) => (a: Action) => can(u, a);

/** Carga asíncrona simple con estado de error. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; reload(): void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(null);
    fn().then(
      (d) => alive && setData(d),
      (e) => alive && setError(e.message ?? String(e)),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, reload: () => setN((x) => x + 1) };
}

export const STATUS_LABEL: Record<string, string> = {
  borrador: "Borrador",
  recepcionado: "Recepcionado",
  en_revision: "En revisión",
  devuelto: "Devuelto",
  visado: "Visado",
};

export const ROLE_LABEL: Record<string, string> = {
  docente: "Docente",
  jefatura: "Jefatura de carrera",
  revisor: "Revisor/a",
  area_curricular: "Área Curricular",
  uta: "UTA",
  admin: "Administración",
};

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
}

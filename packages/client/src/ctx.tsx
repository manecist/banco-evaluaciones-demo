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
  | { name: "about" }
  | { name: "career" }
  | { name: "settings" }
  | { name: "import" }
  | { name: "sheets"; id: number }
  | { name: "moodle"; id: number };

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

/** Qué hace cada rol, en una línea y en lenguaje simple. */
export const ROLE_DESC: Record<string, string> = {
  docente: "Escribe preguntas y arma pruebas.",
  revisor: "Revisa las preguntas y las aprueba o devuelve.",
  area_curricular: "Cuida la calidad: programas, reglas, revisión y archivo.",
  jefatura: "Supervisa su carrera y atiende consultas a experto cuando se necesitan.",
  uta: "Asesora en evaluación: define la exigencia y las reglas del análisis.",
  admin: "Mantiene el sistema: IA, límites de uso y usuarios.",
};

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
}

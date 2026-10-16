import { useCallback, useEffect, useState } from "react";
import type { Catalog, User } from "@banco/core";
import { createHttpApi, createLocalApi, type Api } from "./api";
import { AppCtx, makeCan, ROLE_DESC, ROLE_LABEL, type Ctx, type View } from "./ctx";
import { ItemsView } from "./views/Items";
import { ItemView } from "./views/Item";
import { EditorView } from "./views/Editor";
import { InstrumentsView, InstrumentView, NewInstrumentView } from "./views/Instruments";
import { AnalysisView } from "./views/Analysis";
import { AboutView, AiView, AuditView } from "./views/Other";
import { CareerView, SettingsView } from "./views/Roles";

const DEMO = import.meta.env.MODE === "demo";
let apiPromise: Promise<Api> | null = null;

export function App() {
  const [api, setApi] = useState<Api | null>(null);
  const [progress, setProgress] = useState("Cargando…");
  const [bootError, setBootError] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [view, setView] = useState<View>({ name: "items" });
  const [toastMsg, setToast] = useState<{ msg: string; kind: "ok" | "error" } | null>(null);

  useEffect(() => {
    apiPromise ??= DEMO ? createLocalApi(setProgress) : Promise.resolve(createHttpApi());
    apiPromise.then(async (a) => {
      setApi(a);
      setUsers(await a.demoUsers());
    }, (e) => setBootError(String(e?.message ?? e)));
  }, []);

  const toast = useCallback((msg: string, kind: "ok" | "error" = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const login = async (id: number) => {
    if (!api) return;
    const u = await api.login(id);
    setCatalog(await api.catalog());
    setUser(u);
    setView(u.role === "jefatura" ? { name: "career" } : u.role === "uta" || u.role === "admin" ? { name: "settings" } : { name: "items" });
  };

  if (bootError) return <div className="boot"><p className="error">No se pudo iniciar: {bootError}</p></div>;
  if (!api) return <div className="boot"><div className="spinner" /><p>{progress}</p></div>;

  if (!user || !catalog) {
    return (
      <div className="login">
        <div className="login-card">
          <div className="brand big"><Logo /> <div><b>Banco de Evaluaciones</b><span>Demo técnico · Studios Conari</span></div></div>
          <p className="muted">
            Inicio de sesión institucional <b>simulado</b>. En un sistema real los roles vienen del proveedor de identidad
            de la institución; aquí puede elegir una persona ficticia para probar cada rol.
          </p>
          <p className="start-tip"><b>¿Por dónde empezar?</b> Entre como <b>Paula Soto (docente)</b> para crear una pregunta. Después, con «Cambiar rol», entre como <b>Camila Ruiz (revisora)</b> para aprobarla.</p>
          <div className="user-grid">
            {users.map((u) => (
              <button key={u.id} className="user-btn" onClick={() => login(u.id)}>
                <span className="avatar">{u.name[0]}</span>
                <span><b>{u.name.replace(/\s*\(.*\)/, "")}</b><small>{ROLE_LABEL[u.role]}</small><small className="role-desc">{ROLE_DESC[u.role]}</small></span>
              </button>
            ))}
          </div>
          {api.mode === "local" && (
            <p className="note">Este demo ejecuta <b>PostgreSQL 18 dentro de su navegador</b> (PGlite 0.5, WebAssembly). Nada se envía a un servidor y los datos se reinician al recargar.</p>
          )}
        </div>
      </div>
    );
  }

  const ctx: Ctx = { api, user, catalog, can: makeCan(user), go: setView, toast };
  const nav: { label: string; v: View; show: boolean; active: boolean }[] = [
    { label: "Panel de carrera", v: { name: "career" }, show: ctx.can("career:dashboard"), active: view.name === "career" },
    { label: "Banco de ítems", v: { name: "items" }, show: true, active: ["items", "item", "edit"].includes(view.name) },
    { label: "Instrumentos", v: { name: "instruments" }, show: true, active: ["instruments", "instrument", "new-instrument", "analysis"].includes(view.name) },
    { label: "Asistente IA", v: { name: "ai" }, show: ctx.can("ai:use"), active: view.name === "ai" },
    { label: "Configuración", v: { name: "settings" }, show: ctx.can("settings:pedagogic") || ctx.can("settings:technical"), active: view.name === "settings" },
    { label: "Auditoría", v: { name: "audit" }, show: ctx.can("audit:read"), active: view.name === "audit" },
    { label: "Acerca del demo", v: { name: "about" }, show: true, active: view.name === "about" },
  ];

  return (
    <AppCtx.Provider value={ctx}>
      <div className="shell">
        <header className="top">
          <div className="brand"><Logo /><div><b>Banco de Evaluaciones</b><span>Demo · datos ficticios</span></div></div>
          <nav>
            {nav.filter((n) => n.show).map((n) => (
              <button key={n.label} className={n.active ? "active" : ""} onClick={() => setView(n.v)}>{n.label}</button>
            ))}
          </nav>
          <div className="who">
            <span><b>{user.name.replace(/\s*\(.*\)/, "")}</b><small>{ROLE_LABEL[user.role]}</small></span>
            <button className="ghost" onClick={() => setUser(null)}>Cambiar rol</button>
          </div>
        </header>
        <main>
          {view.name === "items" && <ItemsView />}
          {view.name === "item" && <ItemView id={view.id} />}
          {view.name === "edit" && <EditorView id={view.id} />}
          {view.name === "instruments" && <InstrumentsView />}
          {view.name === "instrument" && <InstrumentView id={view.id} />}
          {view.name === "new-instrument" && <NewInstrumentView />}
          {view.name === "analysis" && <AnalysisView id={view.id} />}
          {view.name === "ai" && <AiView />}
          {view.name === "audit" && <AuditView />}
          {view.name === "about" && <AboutView />}
          {view.name === "career" && <CareerView />}
          {view.name === "settings" && <SettingsView />}
        </main>
        {toastMsg && <div className={`toast ${toastMsg.kind}`} role="status">{toastMsg.msg}</div>}
      </div>
    </AppCtx.Provider>
  );
}

function Logo() {
  return (
    <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#132B52" />
      <path d="M9 10h14M9 16h14M9 22h9" stroke="#E2B13C" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

import { useEffect, useState } from "react";
import type { User } from "@banco/core";
import { ROLE_DESC, ROLE_LABEL, useApp, useLoad } from "../ctx";
import { ErrorBox, Loading } from "./common";

/* ============================ Panel de la carrera (jefatura) ============================ */

export function CareerView() {
  const { api, catalog, user, go } = useApp();
  const { data, error } = useLoad(() => api.careerSummary(), []);
  const consults = useLoad(() => api.consultations(), []);
  const career = catalog.careers.find((c) => c.id === user.careerId);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const s = data.byStatus;
  const enRevision = (s.recepcionado ?? 0) + (s.en_revision ?? 0);
  const enRedaccion = (s.borrador ?? 0) + (s.devuelto ?? 0);

  return (
    <section>
      <div className="head">
        <div>
          <h1>Panel de la carrera</h1>
          <p className="muted">{career?.name}</p>
        </div>
      </div>
      <p className="note">
        <b>Para qué sirve:</b> la jefatura no redacta ni aprueba preguntas. Supervisa: ve cuántas preguntas aprobadas tiene cada asignatura,
        qué está pendiente y qué pruebas tienen preguntas con problemas, para tomar decisiones (por ejemplo, pedir más preguntas en una asignatura).
      </p>

      <div className="stats-row">
        <div className="stat"><b>{s.visado ?? 0}</b><span>preguntas aprobadas, listas para usar</span></div>
        <div className="stat"><b>{enRevision}</b><span>esperando revisión</span></div>
        <div className={`stat ${data.pendingConsultations ? "stat-alert" : ""}`}><b>{data.pendingConsultations}</b><span>consultas a experto por atender</span></div>
        <div className="stat"><b>{enRedaccion}</b><span>en redacción o devueltas</span></div>
        <div className={`stat ${data.instruments.some((i) => i.priority) ? "stat-alert" : ""}`}>
          <b>{data.instruments.reduce((a, i) => a + i.priority, 0)}</b><span>preguntas con alerta prioritaria</span>
        </div>
      </div>

      <h2>Consultas a expertos {data.pendingConsultations > 0 && <span className="badge cb-pendiente">{data.pendingConsultations} por atender</span>}</h2>
      <p className="hint">Llegan solo cuando un revisor duda del contenido de una pregunta o discrepa con el docente. Puede responderlas usted o asignarlas a alguien de la especialidad.</p>
      {!consults.data ? <Loading /> : consults.data.length === 0 ? <p className="empty">No hay consultas. No necesita intervenir.</p> : (
        <ul className="list compact">
          {consults.data.map((c) => (
            <li key={c.id}>
              <button className="row" onClick={() => go({ name: "item", id: c.itemId })}>
                <div className="row-top">
                  <span className="id">#{c.itemId}</span>
                  <span className={`badge cb-${c.status}`}>{c.status === "pendiente" ? "Por atender" : c.status === "asignada" ? `Asignada a ${c.assignedTo?.replace(/\s*\(.*\)/, "")}` : "Resuelta"}</span>
                  <span className="muted small">Pedida por {c.requestedBy.replace(/\s*\(.*\)/, "")}</span>
                </div>
                <p className="stem-line">{c.stem}</p>
                <p className="small muted">Duda: {c.reason}</p>
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2>Preguntas por asignatura</h2>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Asignatura</th><th className="num">Aprobadas</th><th className="num">En revisión</th><th className="num">En redacción</th></tr></thead>
          <tbody>
            {data.modules.map((m) => (
              <tr key={m.id}>
                <td><b>{m.code}</b> · {m.name}</td>
                <td className="num">{m.visados}</td>
                <td className="num">{m.enRevision}</td>
                <td className="num">{m.enRedaccion}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Una asignatura con pocas preguntas aprobadas tendrá dificultades para armar formas A y B distintas.</p>

      <h2>Pruebas aplicadas</h2>
      {data.instruments.length === 0 ? <p className="empty">Aún no hay pruebas en esta carrera.</p> : (
        <ul className="list">
          {data.instruments.map((ins) => (
            <li key={ins.id} className="card ins-card">
              <div>
                <p className="stem-line"><b>{ins.title}</b></p>
                <div className="meta">
                  <span>{ins.students} estudiantes</span>
                  <span>{ins.alerts} preguntas con alertas</span>
                  {ins.priority > 0 && <span className="alert-chip">{ins.priority} prioritaria(s)</span>}
                </div>
              </div>
              <div className="actions wrap">
                <button onClick={() => go({ name: "analysis", id: ins.id })}>Ver análisis</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ============================ Configuración (UTA y Administración) ============================ */

type Settings = Record<string, unknown>;

export function SettingsView() {
  const { api, can, toast } = useApp();
  const [data, setData] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"pedagogic" | "technical" | null>(null);
  const users = useLoad(() => (can("users:read") ? api.demoUsers() : Promise.resolve([] as User[])), []);
  const canPed = can("settings:pedagogic");
  const canTec = can("settings:technical");

  useEffect(() => {
    api.settings().then((s) => {
      setData(s);
      setDraft(s);
    }, (e) => setError(e.message));
  }, [api]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;

  const num = (k: string) => Number(draft[k] ?? 0);
  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async (part: "pedagogic" | "technical", keys: string[]) => {
    setSaving(part);
    try {
      const s = await api.updateSettings(Object.fromEntries(keys.map((k) => [k, draft[k]])));
      setData(s);
      setDraft(s);
      toast("Configuración guardada (queda registrada en la auditoría)");
    } catch (e: any) {
      toast([e.message, ...(e.issues ?? [])].join(" · "), "error");
    } finally {
      setSaving(null);
    }
  };

  return (
    <section>
      <div className="head">
        <div>
          <h1>Configuración</h1>
          <p className="muted">Reglas generales que usa todo el sistema. Cada cambio queda registrado en la auditoría.</p>
        </div>
      </div>

      <div className="grid2">
        <div className={`card form ${canPed ? "" : "readonly"}`}>
          <h2>Ajustes pedagógicos</h2>
          <p className="hint"><b>Los define la UTA</b> (Unidad Técnico-Pedagógica), que asesora a los docentes en cómo evaluar.{!canPed && " Usted puede verlos, pero no cambiarlos."}</p>
          <label>Exigencia por defecto (%)
            <input type="number" min={40} max={80} step={5} disabled={!canPed} value={Math.round(num("default_exigency") * 100)} onChange={(e) => set("default_exigency", Number(e.target.value) / 100)} />
            <small className="help">Porcentaje del puntaje necesario para la nota 4,0. Se propone al crear cada prueba; el docente puede ajustarlo.</small>
          </label>
          <label>Tolerancia de la tabla de especificaciones (puntos)
            <input type="number" min={1} max={20} disabled={!canPed} value={num("coverage_tolerance")} onChange={(e) => set("coverage_tolerance", Number(e.target.value))} />
            <small className="help">Cuánto puede desviarse una prueba del peso esperado de cada resultado antes de que el semáforo pase a amarillo.</small>
          </label>
          <label>Respuestas mínimas para el análisis
            <input type="number" min={5} max={500} disabled={!canPed} value={num("min_responses")} onChange={(e) => set("min_responses", Number(e.target.value))} />
            <small className="help">Con menos estudiantes, los índices de dificultad y discriminación se muestran solo como referencia.</small>
          </label>
          {canPed && <div className="actions"><button className="primary" disabled={saving !== null} onClick={() => save("pedagogic", ["default_exigency", "coverage_tolerance", "min_responses"])}>{saving === "pedagogic" ? "Guardando…" : "Guardar ajustes pedagógicos"}</button></div>}
        </div>

        <div className={`card form ${canTec ? "" : "readonly"}`}>
          <h2>Ajustes técnicos</h2>
          <p className="hint"><b>Los define Administración</b>, que mantiene el sistema funcionando.{!canTec && " Usted puede verlos, pero no cambiarlos."}</p>
          <label className="check">
            <input type="checkbox" disabled={!canTec} checked={draft.ai_enabled !== false} onChange={(e) => set("ai_enabled", e.target.checked)} />
            Asistente de IA habilitado
          </label>
          <small className="help block">Si se desactiva, nadie puede usar la IA (ni para borradores ni para la segunda opinión).</small>
          <label>Límite diario de borradores con IA por persona
            <input type="number" min={0} max={200} disabled={!canTec} value={num("ai_daily_limit")} onChange={(e) => set("ai_daily_limit", Number(e.target.value))} />
            <small className="help">Controla el uso y el costo del proveedor de IA.</small>
          </label>
          {canTec && <div className="actions"><button className="primary" disabled={saving !== null} onClick={() => save("technical", ["ai_enabled", "ai_daily_limit"])}>{saving === "technical" ? "Guardando…" : "Guardar ajustes técnicos"}</button></div>}
        </div>
      </div>

      {can("users:read") && (
        <div className="card">
          <h2>Usuarios y roles</h2>
          <p className="hint">Quién tiene acceso y con qué rol. En un sistema real, las cuentas y los roles vienen del inicio de sesión institucional; Administración revisa que cada persona tenga solo los permisos que necesita.</p>
          <ErrorBox error={users.error} />
          {!users.data ? <Loading /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Persona</th><th>Rol</th><th>Qué puede hacer</th></tr></thead>
                <tbody>
                  {users.data.map((u) => (
                    <tr key={u.id}><td>{u.name.replace(/\s*\(.*\)/, "")}</td><td className="nowrap">{ROLE_LABEL[u.role]}</td><td className="small">{ROLE_DESC[u.role]}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

import { useState } from "react";
import { adviseItem, allowedTransitions, type ItemVersion, type Status } from "@banco/core";
import type { AiReviewResult } from "../api";
import { fmtDate, STATUS_LABEL, useApp, useLoad } from "../ctx";
import { ErrorBox, ItemPreview, Loading, Meta, StatusBadge } from "./common";

const ACTION_LABEL: Partial<Record<Status, string>> = {
  recepcionado: "Enviar a revisión",
  en_revision: "Tomar para revisión",
  visado: "Visar y publicar",
  devuelto: "Devolver con observaciones",
};

export function ItemView({ id }: { id: number }) {
  const { api, user, can, go, toast } = useApp();
  const { data, error, reload } = useLoad(() => api.getItem(id), [id]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"versiones" | "observaciones" | "bitacora">("versiones");

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;

  const isAuthor = data.authorId === user.id;
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      setComment("");
      reload();
    } catch (e: any) {
      toast([e.message, ...(e.issues ?? [])].join(" · "), "error");
    } finally {
      setBusy(false);
    }
  };

  const canEdit = can("item:edit_own") && (isAuthor || user.role === "area_curricular") && ["borrador", "devuelto", "visado"].includes(data.status) && !data.archived;
  const transitions = allowedTransitions(data.status);

  return (
    <section>
      <button className="back" onClick={() => go({ name: "items" })}>← Volver al banco</button>
      <div className="head">
        <div>
          <h1>Ítem #{data.id} <StatusBadge s={data.status} /> {data.archived && <span className="badge st-archivado">Archivado</span>}</h1>
          <p className="muted">Autor/a: {data.authorName} · versión vigente v{data.current.versionNo}
            {data.publishedVersionId && data.publishedVersionId !== data.current.id && " · la versión publicada sigue siendo la anterior visada"}</p>
        </div>
        <div className="actions">
          {canEdit && <button onClick={() => go({ name: "edit", id })}>{data.status === "visado" ? "Editar (crea borrador)" : "Editar"}</button>}
          {can("item:archive") && !data.archived && <button className="ghost" disabled={busy} onClick={() => run(() => api.archive(id), "Ítem archivado (no se borra)")}>Archivar</button>}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <Meta v={data.current} />
          <ItemPreview v={data.current} />
        </div>

        <div className="card">
          <h2>Visación</h2>
          <ol className="flow">
            {(["borrador", "recepcionado", "en_revision", "visado"] as Status[]).map((s) => (
              <li key={s} className={s === data.status ? "now" : ""}>{STATUS_LABEL[s]}</li>
            ))}
          </ol>
          {data.status === "devuelto" && <p className="warn">Devuelto: revise las observaciones, corrija y vuelva a enviar.</p>}
          {transitions.length === 0 && <p className="muted">Ítem visado y publicado en el banco institucional.</p>}
          {transitions.includes("devuelto") && (
            <textarea placeholder="Comentario (obligatorio para devolver)" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Comentario de revisión" />
          )}
          <div className="actions wrap">
            {transitions.map((to) => (
              <button key={to} className={to === "visado" ? "primary" : ""} disabled={busy} onClick={() => run(() => api.transition(id, to, comment || undefined), `Estado: ${STATUS_LABEL[to]}`)}>
                {ACTION_LABEL[to]}
              </button>
            ))}
          </div>
          <p className="next-step"><b>¿Qué sigue?</b> {nextStep(data.status, isAuthor, can("item:review"), can("item:approve"))}</p>
          <p className="hint">Las reglas se verifican en el servidor: nadie puede visar sus propias preguntas y para devolver hay que escribir un comentario.</p>
        </div>
      </div>

      {can("item:review") && !isAuthor && ["recepcionado", "en_revision"].includes(data.status) && <ReviewHelp v={data.current} />}

      <h2 className="section-title">Historial de esta pregunta</h2>
      <p className="hint">
        <b>Versiones:</b> cada vez que se guarda un cambio queda una copia; ninguna se puede borrar. <b>Observaciones:</b> los comentarios del revisor
        al devolverla. <b>Bitácora:</b> quién hizo qué con esta pregunta y cuándo.
      </p>
      <div className="tabs">
        <button className={tab === "versiones" ? "active" : ""} onClick={() => setTab("versiones")}>Versiones ({data.versions.length})</button>
        <button className={tab === "observaciones" ? "active" : ""} onClick={() => setTab("observaciones")}>Observaciones ({data.observations.length})</button>
        <button className={tab === "bitacora" ? "active" : ""} onClick={() => setTab("bitacora")}>Bitácora ({data.audit.length})</button>
      </div>

      {tab === "versiones" && (
        <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Versión</th><th>Fecha</th><th>Autor/a</th><th>Motivo</th><th></th></tr></thead>
          <tbody>
            {data.versions.map((v) => (
              <tr key={v.id}>
                <td>v{v.versionNo}{v.id === data.current.id && " (vigente)"}{v.id === data.publishedVersionId && " · publicada"}</td>
                <td>{fmtDate(v.createdAt)}</td>
                <td>{v.authorName.replace(/\s*\(.*\)/, "")}</td>
                <td>{v.reason}</td>
                <td>{canEdit && v.id !== data.current.id && <button className="small" disabled={busy} onClick={() => run(() => api.restore(id, v.id), `Restaurada como versión nueva`)}>Restaurar</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {tab === "versiones" && <p className="hint">«Restaurar» no borra nada: copia una versión antigua como versión nueva.</p>}

      {tab === "observaciones" && (data.observations.length === 0 ? <p className="empty">Sin observaciones.</p> : (
        <ul className="obs">{data.observations.map((o) => <li key={o.id}><b>{o.authorName.replace(/\s*\(.*\)/, "")}</b> · {fmtDate(o.createdAt)}<p>{o.text}</p></li>)}</ul>
      ))}

      {tab === "bitacora" && (
        <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Fecha</th><th>Persona</th><th>Acción</th><th>Detalle</th></tr></thead>
          <tbody>{data.audit.map((a) => <tr key={a.id}><td>{fmtDate(a.at)}</td><td>{a.userName?.replace(/\s*\(.*\)/, "")}</td><td>{actionText(a.action)}</td><td className="small">{detailText(a.detail)}</td></tr>)}</tbody>
        </table>
        </div>
      )}
    </section>
  );
}

/** Indicación en lenguaje simple del siguiente paso, según el estado y el rol. */
function nextStep(status: Status, isAuthor: boolean, canReview: boolean, canApprove: boolean): string {
  switch (status) {
    case "borrador":
      return isAuthor
        ? "Cuando la pregunta esté lista, presione «Enviar a revisión». Mientras sea borrador, puede editarla cuantas veces quiera."
        : "La autora todavía la está redactando.";
    case "devuelto":
      return isAuthor
        ? "El revisor la devolvió: lea la pestaña «Observaciones», corríjala con «Editar» y vuelva a enviarla."
        : "Está con la autora para que la corrija.";
    case "recepcionado":
      return canReview && !isAuthor
        ? "Presione «Tomar para revisión» para empezar a revisarla."
        : "Espera que un revisor la tome. Para probarlo, use «Cambiar rol» y entre como Camila Ruiz (revisora).";
    case "en_revision":
      return canApprove && !isAuthor
        ? "Revísela y elija «Visar y publicar» si está bien, o «Devolver con observaciones» escribiendo qué corregir."
        : "Un revisor la está revisando.";
    case "visado":
      return "Está aprobada: ya se puede usar al armar pruebas en «Instrumentos».";
  }
}

function actionText(action: string): string {
  if (action.startsWith("estado:")) return `Cambió el estado a «${STATUS_LABEL[action.slice(7)] ?? action.slice(7)}»`;
  return ({ crear: "Creó la pregunta", nueva_version: "Guardó una nueva versión", archivar: "Archivó la pregunta" } as Record<string, string>)[action] ?? action;
}

function detailText(d: Record<string, unknown> | null | undefined): string {
  const e = Object.entries(d ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== "");
  return e.length ? e.map(([k, v]) => `${k}: ${typeof v === "boolean" ? (v ? "sí" : "no") : String(v)}`).join(" · ") : "—";
}

const KEY_LABEL: Record<AiReviewResult["keyAssessment"], string> = {
  coherente: "Sin observaciones",
  dudosa: "Conviene revisar",
  sin_clave: "Sin respuesta correcta marcada",
};

/** Ayuda para quien revisa: pauta, observaciones automáticas y segunda opinión de IA. */
function ReviewHelp({ v }: { v: ItemVersion }) {
  const { api, toast } = useApp();
  const [review, setReview] = useState<AiReviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const auto = adviseItem(v).filter((s) => s.rule !== "sin_retroalimentacion");
  const ask = async () => {
    if (v.payload.type !== "seleccion_multiple") return;
    setBusy(true);
    try {
      setReview(await api.aiReview({ stem: v.stem, alternatives: v.payload.alternatives.map((a) => ({ text: a.text, correct: a.correct })) }));
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card guide review-help">
      <h2>Ayuda para revisar</h2>
      <div className="grid2">
        <div>
          <h3>Pauta de revisión</h3>
          <ol className="guide-steps">
            <li><b>Contenido:</b> ¿la respuesta marcada es correcta según el programa y los protocolos vigentes?</li>
            <li><b>Una sola correcta:</b> ¿ninguna otra opción podría considerarse válida?</li>
            <li><b>Claridad:</b> ¿se entiende sin explicación del docente?</li>
            <li><b>Calce:</b> ¿evalúa el resultado de aprendizaje y el nivel indicados?</li>
          </ol>
          <p className="note small"><b>¿No es su especialidad?</b> No la vise. Use «Devolver con observaciones» y escriba que requiere revisión de un par experto del área. En un sistema real, cada carrera asigna revisores de su especialidad.</p>
        </div>
        <div>
          <h3>Lo que detectó el asesor automático</h3>
          {auto.length === 0 ? <p className="ok">Sin observaciones de forma.</p> : <ul>{auto.map((s) => <li key={s.rule}>{s.message}</li>)}</ul>}
          {v.payload.type === "seleccion_multiple" && (
            <>
              <h3>Segunda opinión de IA</h3>
              <p className="hint">La IA revisa la pregunta y avisa si la respuesta marcada se ve dudosa. Es una ayuda: la decisión de visar es suya.</p>
              <button disabled={busy} onClick={ask}>{busy ? "Revisando…" : "Pedir segunda opinión"}</button>
              {review && (
                <div className="review-out">
                  <p><span className={`badge rv-${review.keyAssessment}`}>{KEY_LABEL[review.keyAssessment]}</span></p>
                  <p>{review.comment.replace("La respuesta correcta la sigue decidiendo usted.", "")}</p>
                  {review.observations.length > 0 && <ul>{review.observations.map((o, i) => <li key={i}>{o}</li>)}</ul>}
                  {review.simulated && <p className="small muted">Demo: proveedor de IA simulado, que revisa la forma de la pregunta. Con un proveedor real también comenta si el contenido técnico es correcto.</p>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}


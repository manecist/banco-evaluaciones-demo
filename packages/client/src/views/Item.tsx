import { useState } from "react";
import { allowedTransitions, type Status } from "@banco/core";
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
          <p className="hint">Las reglas se verifican en el servidor: un revisor no puede visar sus propios ítems y devolver exige comentario. Pruebe con distintos roles.</p>
        </div>
      </div>

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
      {tab === "versiones" && <p className="hint">Las versiones son inmutables: la base de datos rechaza cualquier modificación o borrado. Restaurar crea una versión nueva.</p>}

      {tab === "observaciones" && (data.observations.length === 0 ? <p className="empty">Sin observaciones.</p> : (
        <ul className="obs">{data.observations.map((o) => <li key={o.id}><b>{o.authorName.replace(/\s*\(.*\)/, "")}</b> · {fmtDate(o.createdAt)}<p>{o.text}</p></li>)}</ul>
      ))}

      {tab === "bitacora" && (
        <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Fecha</th><th>Persona</th><th>Acción</th><th>Detalle</th></tr></thead>
          <tbody>{data.audit.map((a) => <tr key={a.id}><td>{fmtDate(a.at)}</td><td>{a.userName?.replace(/\s*\(.*\)/, "")}</td><td>{a.action}</td><td className="small">{JSON.stringify(a.detail)}</td></tr>)}</tbody>
        </table>
        </div>
      )}
    </section>
  );
}

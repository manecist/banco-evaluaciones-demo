import { useEffect, useState } from "react";
import { BLOOM_LABEL, ITEM_TYPE_LABEL, ITEM_TYPES, STATUSES, type ItemSearch } from "@banco/core";
import { STATUS_LABEL, useApp, useLoad } from "../ctx";
import { ErrorBox, Loading, Meta, StatusBadge } from "./common";

export function ItemsView() {
  const { api, catalog, can, go, user } = useApp();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [f, setF] = useState<ItemSearch>({});

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, error } = useLoad(() => api.searchItems({ ...f, q: debounced || undefined }), [debounced, JSON.stringify(f)]);
  const modules = catalog.modules.filter((m) => !f.careerId || m.careerId === f.careerId);
  const outcomes = catalog.outcomes.filter((o) => !f.moduleId || o.moduleId === f.moduleId);
  const set = (k: keyof ItemSearch, v: string) => setF((x) => ({ ...x, [k]: v === "" ? undefined : isNaN(Number(v)) ? v : Number(v) }));

  return (
    <section>
      <div className="head">
        <div>
          <h1>Banco de ítems</h1>
          <p className="muted">
            {user.role === "docente" ? "Sus ítems y el banco institucional (ítems visados)." : "Todos los ítems de la institución."} Búsqueda en
            español: tolera tildes y errores de tipeo.
          </p>
        </div>
        {can("item:create") && <button className="primary" onClick={() => go({ name: "edit" })}>+ Nuevo ítem</button>}
      </div>

      <div className="filters">
        <input className="search" placeholder="Buscar… (pruebe «presion» o «higene de manos»)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar ítems" />
        <select aria-label="Carrera" value={f.careerId ?? ""} onChange={(e) => setF({ careerId: e.target.value ? Number(e.target.value) : undefined })}>
          <option value="">Todas las carreras</option>
          {catalog.careers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select aria-label="Módulo" value={f.moduleId ?? ""} onChange={(e) => setF((x) => ({ ...x, moduleId: e.target.value ? Number(e.target.value) : undefined, outcomeId: undefined }))}>
          <option value="">Todos los módulos</option>
          {modules.map((m) => <option key={m.id} value={m.id}>{m.code} {m.name}</option>)}
        </select>
        <select aria-label="Resultado" value={f.outcomeId ?? ""} onChange={(e) => set("outcomeId", e.target.value)}>
          <option value="">Todos los resultados</option>
          {outcomes.map((o) => <option key={o.id} value={o.id}>{catalog.modules.find((m) => m.id === o.moduleId)?.code} {o.code}</option>)}
        </select>
        <select aria-label="Nivel" value={f.bloomLevel ?? ""} onChange={(e) => set("bloomLevel", e.target.value)}>
          <option value="">Todo nivel</option>
          {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} · {BLOOM_LABEL[n]}</option>)}
        </select>
        <select aria-label="Tipo" value={f.type ?? ""} onChange={(e) => set("type", e.target.value)}>
          <option value="">Todo tipo</option>
          {ITEM_TYPES.map((t) => <option key={t} value={t}>{ITEM_TYPE_LABEL[t]}</option>)}
        </select>
        <select aria-label="Estado" value={f.status ?? ""} onChange={(e) => set("status", e.target.value)}>
          <option value="">Todo estado</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>

      <ErrorBox error={error} />
      {!data ? <Loading /> : data.length === 0 ? <p className="empty">No hay ítems con esos filtros.</p> : (
        <ul className="list">
          {data.map((it) => (
            <li key={it.id}>
              <button className="row" onClick={() => go({ name: "item", id: it.id })}>
                <div className="row-top"><span className="id">#{it.id}</span><StatusBadge s={it.status} /><span className="muted small">{it.authorName.replace(/\s*\(.*\)/, "")} · v{it.current.versionNo}</span></div>
                <p className="stem-line">{it.current.stem}</p>
                <Meta v={it.current} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

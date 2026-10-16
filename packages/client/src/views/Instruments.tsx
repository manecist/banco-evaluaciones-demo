import { useEffect, useMemo, useState } from "react";
import {
  BLOOM_LABEL,
  coverage,
  estimatedMinutes,
  gradeTable,
  ITEM_TYPE_LABEL,
  LETTERS,
  buildForms,
  keyText,
  type FormItem,
  type InstrumentDetail,
  type ItemSummary,
} from "@banco/core";
import { useApp, useLoad } from "../ctx";
import { ErrorBox, ItemPreview, Loading } from "./common";

const pct = (x: number) => `${Math.round(x * 100)} %`;
const fmt = (x: number, d = 1) => x.toLocaleString("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d });

/* ============================ Lista ============================ */

export function InstrumentsView() {
  const { api, catalog, can, go } = useApp();
  const { data, error } = useLoad(() => api.instruments(), []);

  return (
    <section>
      <div className="head">
        <div>
          <h1>Instrumentos de evaluación</h1>
          <p className="muted">Pruebas armadas desde la tabla de especificaciones, solo con ítems visados.</p>
        </div>
        {can("instrument:create") && <button className="primary" onClick={() => go({ name: "new-instrument" })}>+ Nueva prueba</button>}
      </div>
      <ErrorBox error={error} />
      {!data ? <Loading /> : data.length === 0 ? <p className="empty">Aún no hay instrumentos.</p> : (
        <ul className="list">
          {data.map((ins) => {
            const m = catalog.modules.find((x) => x.id === ins.moduleId);
            return (
              <li key={ins.id} className="card ins-card">
                <div>
                  <div className="row-top"><span className="id">#{ins.id}</span><span className="muted small">{m?.code} {m?.name}</span></div>
                  <p className="stem-line"><b>{ins.title}</b></p>
                  <div className="meta">
                    <span>{ins.itemCount} ítems</span>
                    <span>{fmt(ins.totalPoints, 0)} pts</span>
                    <span>{ins.minutes} min</span>
                    <span>Exigencia {pct(ins.exigency)}</span>
                    <span>{ins.authorName.replace(/\s*\(.*\)/, "")}</span>
                  </div>
                </div>
                <div className="actions wrap">
                  <button onClick={() => go({ name: "instrument", id: ins.id })}>Ver prueba</button>
                  {can("analysis:read") && <button className="ghost" onClick={() => go({ name: "analysis", id: ins.id })}>Análisis de ítems</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ============================ Nueva prueba ============================ */

const LIGHT_LABEL = { verde: "En rango", amarillo: "Desviación moderada", rojo: "Fuera de rango" } as const;

/** Reparte 100 % en partes enteras iguales (el resto va a los primeros). */
function equalWeights(n: number): number[] {
  const base = Math.floor(100 / n);
  return Array.from({ length: n }, (_, i) => base + (i < 100 - base * n ? 1 : 0));
}

export function NewInstrumentView() {
  const { api, catalog, user, go, toast } = useApp();
  const firstModule = catalog.modules.find((m) => m.careerId === user.careerId) ?? catalog.modules[0]!;
  const [title, setTitle] = useState("");
  const [moduleId, setModuleId] = useState(firstModule.id);
  const [exigency, setExigency] = useState(60);
  const [minutes, setMinutes] = useState(45);
  const [seed, setSeed] = useState(2026);
  const [weights, setWeights] = useState<Record<number, number>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [issues, setIssues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const settings = useLoad(() => api.settings(), []);
  const items = useLoad(() => api.searchItems({ moduleId, status: "visado" }), [moduleId]);
  const outcomes = useMemo(() => catalog.outcomes.filter((o) => o.moduleId === moduleId), [catalog, moduleId]);

  // Al cambiar de módulo: pesos iguales por resultado y selección vacía.
  useEffect(() => {
    const w = equalWeights(outcomes.length);
    setWeights(Object.fromEntries(outcomes.map((o, i) => [o.id, w[i]!])));
    setSelected(new Set());
  }, [outcomes]);

  useEffect(() => {
    const d = Number(settings.data?.default_exigency);
    if (d > 0 && d < 1) setExigency(Math.round(d * 100));
  }, [settings.data]);

  const tolerance = Number(settings.data?.coverage_tolerance ?? 5);
  const specs = outcomes.map((o) => ({ outcomeId: o.id, weight: weights[o.id] ?? 0 }));
  const weightSum = specs.reduce((a, b) => a + b.weight, 0);
  const chosen: ItemSummary[] = (items.data ?? []).filter((i) => selected.has(i.id));
  const totalPoints = chosen.reduce((a, b) => a + b.current.points, 0);
  const cov = coverage(specs, chosen.map((i) => ({ outcomeId: i.current.outcomeId, points: i.current.points })), tolerance);
  const estimate = estimatedMinutes(chosen.map((i) => i.current.type));
  const sumOk = Math.abs(weightSum - 100) < 0.01;

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const create = async () => {
    setIssues([]);
    setSaving(true);
    try {
      const ins = await api.createInstrument({
        title,
        moduleId,
        seed,
        exigency: exigency / 100,
        minutes,
        specs,
        itemIds: chosen.map((i) => i.id),
      });
      toast("Prueba creada");
      go({ name: "instrument", id: ins.id });
    } catch (e: any) {
      setIssues([e.message, ...(e.issues ?? [])]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <button className="back" onClick={() => go({ name: "instruments" })}>← Volver a instrumentos</button>
      <h1>Nueva prueba</h1>

      <div className="card form">
        <fieldset>
          <legend>Datos generales</legend>
          <label>Título
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej.: Prueba 2 · Prevención de infecciones" />
          </label>
          <div className="row3">
            <label>Módulo
              <select value={moduleId} onChange={(e) => setModuleId(Number(e.target.value))}>
                {catalog.modules.map((m) => <option key={m.id} value={m.id}>{m.code} {m.name}</option>)}
              </select>
            </label>
            <label>Exigencia (%)
              <input type="number" min={40} max={80} step={5} value={exigency} onChange={(e) => setExigency(Number(e.target.value))} />
            </label>
            <label>Tiempo declarado (min)
              <input type="number" min={5} max={240} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
            </label>
            <label>Semilla de barajado
              <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
            </label>
          </div>
          <p className="hint">La semilla hace reproducibles las formas A y B: con la misma semilla siempre se obtiene el mismo orden de preguntas y alternativas.</p>
        </fieldset>

        <fieldset>
          <legend>Tabla de especificaciones</legend>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Resultado de aprendizaje</th><th className="num">Peso esperado (%)</th><th className="num">Real</th><th>Cobertura</th></tr></thead>
              <tbody>
                {outcomes.map((o) => {
                  const c = cov.find((x) => x.outcomeId === o.id);
                  return (
                    <tr key={o.id}>
                      <td><b>{o.code}</b> · {o.text}</td>
                      <td className="num">
                        <input className="w-num" type="number" min={0} max={100} value={weights[o.id] ?? 0} aria-label={`Peso de ${o.code}`}
                          onChange={(e) => setWeights((w) => ({ ...w, [o.id]: Number(e.target.value) }))} />
                      </td>
                      <td className="num">{chosen.length ? `${fmt(c?.actual ?? 0)} %` : "—"}</td>
                      <td>{chosen.length && c ? <span className={`light light-${c.light}`}>{LIGHT_LABEL[c.light]}</span> : <span className="muted small">Sin ítems</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr><td>Total</td><td className={`num ${sumOk ? "" : "bad"}`}>{fmt(weightSum, 0)} %</td><td className="num">{chosen.length ? "100 %" : ""}</td><td /></tr>
              </tfoot>
            </table>
          </div>
          {!sumOk && <p className="warn">Los pesos deben sumar 100 % (ahora suman {fmt(weightSum, 0)} %).</p>}
          <p className="hint">El porcentaje real se calcula con los puntajes de los ítems seleccionados. Verde: diferencia de hasta {tolerance} puntos; amarillo: hasta {tolerance * 2}; rojo: más.</p>
        </fieldset>

        <fieldset>
          <legend>Ítems visados del módulo</legend>
          <ErrorBox error={items.error} />
          {!items.data ? <Loading /> : items.data.length === 0 ? <p className="empty">Este módulo aún no tiene ítems visados.</p> : (
            <>
              <div className="actions wrap">
                <button className="small" onClick={() => setSelected(new Set(items.data!.map((i) => i.id)))}>Seleccionar todos</button>
                <button className="small ghost" disabled={selected.size === 0} onClick={() => setSelected(new Set())}>Quitar selección</button>
                <span className="muted small">{chosen.length} de {items.data.length} seleccionados · {fmt(totalPoints, 1)} pts</span>
              </div>
              <ul className="pick">
                {items.data.map((it) => {
                  const o = outcomes.find((x) => x.id === it.current.outcomeId);
                  return (
                    <li key={it.id}>
                      <label className={selected.has(it.id) ? "on" : ""}>
                        <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggle(it.id)} />
                        <span>
                          <span className="stem-line">{it.current.stem}</span>
                          <span className="meta">
                            <span>#{it.id}</span><span>{o?.code}</span><span>{ITEM_TYPE_LABEL[it.current.type]}</span>
                            <span>Bloom {it.current.bloomLevel} · {BLOOM_LABEL[it.current.bloomLevel]}</span><span>{it.current.points} pts</span>
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </fieldset>

        <div className={`time-check ${estimate > minutes ? "warn" : "ok"}`}>
          Tiempo estimado de respuesta: <b>{estimate} min</b> · declarado: <b>{minutes} min</b>.
          {estimate > minutes ? " El tiempo declarado parece insuficiente." : " El tiempo declarado es suficiente."}
        </div>

        {issues.length > 0 && (
          <div className="error" role="alert"><b>No se pudo crear la prueba:</b><ul>{issues.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        )}
        <div className="actions">
          <button className="primary" disabled={saving || !sumOk || chosen.length === 0 || !title.trim()} onClick={create}>
            {saving ? "Creando…" : "Crear prueba"}
          </button>
          {(!title.trim() || chosen.length === 0) && <span className="muted small">Indique un título y seleccione al menos un ítem.</span>}
        </div>
      </div>
    </section>
  );
}

/* ============================ Detalle e impresión ============================ */

type Doc = "A" | "B" | "pauta" | "hoja";

export function InstrumentView({ id }: { id: number }) {
  const { api, can, go, toast } = useApp();
  const { data, error } = useLoad(() => api.instrument(id), [id]);
  const [doc, setDoc] = useState<Doc>("A");
  const [exporting, setExporting] = useState(false);

  const forms = useMemo(() => (data ? buildForms(data.items, data.seed) : null), [data]);

  if (error) return <ErrorBox error={error} />;
  if (!data || !forms) return <Loading />;

  const exportXml = async () => {
    setExporting(true);
    try {
      const xml = await api.exportMoodle({ instrumentId: id });
      const url = URL.createObjectURL(new Blob([xml], { type: "application/xml" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "banco-moodle.xml";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Archivo banco-moodle.xml descargado");
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <section>
      <div className="no-print">
        <button className="back" onClick={() => go({ name: "instruments" })}>← Volver a instrumentos</button>
        <div className="head">
          <div>
            <h1>{data.title}</h1>
            <p className="muted">{data.itemCount} ítems · {fmt(data.totalPoints, 0)} pts · {data.minutes} min · exigencia {pct(data.exigency)} · semilla {data.seed}</p>
          </div>
          <div className="actions wrap">
            <button className="primary" onClick={() => window.print()}>Imprimir / guardar PDF</button>
            {can("export:moodle") && <button disabled={exporting} onClick={exportXml}>{exporting ? "Exportando…" : "Exportar a Moodle (XML)"}</button>}
            {can("instrument:create") && <button onClick={() => go({ name: "sheets", id })}>Corregir hojas de respuesta</button>}
            {can("analysis:read") && <button className="ghost" onClick={() => go({ name: "analysis", id })}>Análisis de ítems</button>}
          </div>
        </div>
        <div className="tabs" role="tablist">
          {(["A", "B", "pauta", "hoja"] as Doc[]).map((d) => (
            <button key={d} role="tab" aria-selected={doc === d} className={doc === d ? "active" : ""} onClick={() => setDoc(d)}>
              {d === "pauta" ? "Pauta de corrección" : d === "hoja" ? "Hoja de respuestas" : `Forma ${d}`}
            </button>
          ))}
        </div>
        <p className="hint">Se imprime el documento seleccionado. La vista imprimible es una aproximación; en producción el PDF lo genera el motor de documentos de la institución.</p>
      </div>

      {doc === "pauta" ? <AnswerKey data={data} forms={forms} /> : doc === "hoja" ? <AnswerSheet data={data} forms={forms} /> : <Paper data={data} form={doc} items={forms[doc]} />}
    </section>
  );
}

function PaperHeader({ data, subtitle }: { data: InstrumentDetail; subtitle: string }) {
  const { catalog } = useApp();
  const m = catalog.modules.find((x) => x.id === data.moduleId);
  const career = catalog.careers.find((c) => c.id === m?.careerId);
  return (
    <header className="paper-head">
      <div className="paper-brand">
        <svg width="40" height="40" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="#132B52" />
          <path d="M9 10h14M9 16h14M9 22h9" stroke="#E2B13C" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <div>
          <b>Banco de Evaluaciones</b>
          <span>Demo Studios Conari · datos ficticios</span>
        </div>
        <span className="paper-form">{subtitle}</span>
      </div>
      <h2>{data.title}</h2>
      <dl className="paper-meta">
        <div><dt>Carrera</dt><dd>{career?.name}</dd></div>
        <div><dt>Módulo</dt><dd>{m?.code} {m?.name}</dd></div>
        <div><dt>Docente</dt><dd>{data.authorName.replace(/\s*\(.*\)/, "")}</dd></div>
        <div><dt>Fecha</dt><dd>{new Date().toLocaleDateString("es-CL")}</dd></div>
        <div><dt>Puntaje total</dt><dd>{fmt(data.totalPoints, 0)} pts · exigencia {pct(data.exigency)}</dd></div>
        <div><dt>Tiempo</dt><dd>{data.minutes} minutos</dd></div>
      </dl>
    </header>
  );
}

function Paper({ data, form, items }: { data: InstrumentDetail; form: "A" | "B"; items: FormItem[] }) {
  const table = gradeTable(data.totalPoints, data.exigency, 1);
  return (
    <article className="paper">
      <PaperHeader data={data} subtitle={`Forma ${form}`} />
      <div className="paper-student">
        <span>Nombre: ______________________________________</span>
        <span>Sección: ________</span>
        <span>Puntaje: ______ / {fmt(data.totalPoints, 0)}</span>
        <span>Nota: ______</span>
      </div>
      <div className="paper-instr">
        <b>Instrucciones</b>
        <ul>
          <li>Lea cada pregunta con atención antes de responder. Dispone de {data.minutes} minutos.</li>
          <li>En selección múltiple, encierre en un círculo la letra de la única alternativa correcta.</li>
          <li>Responda con lápiz pasta. No se permite el uso de celular ni material de apoyo.</li>
          <li>La nota 4,0 se obtiene con el {pct(data.exigency)} del puntaje total.</li>
        </ul>
      </div>
      <ol className="paper-items">
        {items.map((fi, i) => (
          <li key={fi.v.id}>
            <div className="q-head"><b>{i + 1}.</b><span className="pts">({fmt(fi.v.points, fi.v.points % 1 ? 1 : 0)} {fi.v.points === 1 ? "punto" : "puntos"})</span></div>
            <ItemPreview v={fi.v} showKey={false} order={fi.order} />
          </li>
        ))}
      </ol>
      <section className="grade-table">
        <h3>Tabla de conversión de puntaje a nota</h3>
        <div className="grade-grid">
          {table.map((r) => (
            <span key={r.score} className={r.grade >= 4 ? "pass" : ""}><b>{fmt(r.score, 0)}</b> pts → {fmt(r.grade)}</span>
          ))}
        </div>
      </section>
    </article>
  );
}

function AnswerKey({ data, forms }: { data: InstrumentDetail; forms: Record<"A" | "B", FormItem[]> }) {
  return (
    <article className="paper">
      <PaperHeader data={data} subtitle="Pauta" />
      <p className="paper-instr"><b>Pauta de corrección — uso exclusivo docente.</b> Claves por forma; el número corresponde a la posición de la pregunta en cada forma.</p>
      <div className="keys">
        {(["A", "B"] as const).map((f) => (
          <section key={f}>
            <h3>Forma {f}</h3>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>N.º</th><th>Clave</th><th className="num">Pts</th><th>Ítem</th></tr></thead>
                <tbody>
                  {forms[f].map((fi, i) => (
                    <tr key={fi.v.id}>
                      <td>{i + 1}</td>
                      <td className={fi.v.payload.type === "seleccion_multiple" ? "key-letter" : "small"}>{keyText(fi)}</td>
                      <td className="num">{fmt(fi.v.points, fi.v.points % 1 ? 1 : 0)}</td>
                      <td className="small">#{fi.v.itemId} v{fi.v.versionNo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}

/** Hoja de respuestas para marcar con lápiz y leer con lector óptico o escáner. */
function AnswerSheet({ data, forms }: { data: InstrumentDetail; forms: Record<"A" | "B", FormItem[]> }) {
  const n = forms.A.length;
  const maxAlts = Math.max(2, ...forms.A.map((fi) => (fi.v.payload.type === "seleccion_multiple" ? fi.v.payload.alternatives.length : 2)));
  return (
    <article className="paper sheet">
      <PaperHeader data={data} subtitle="Hoja de respuestas" />
      <div className="sheet-top">
        <div className="sheet-box">
          <b>Forma</b>
          <span className="bubbles">{["A", "B"].map((f) => <span key={f} className="bubble">{f}</span>)}</span>
        </div>
        <div className="sheet-box">
          <b>Código de estudiante</b>
          <span className="code-boxes">{[0, 1, 2, 3].map((i) => <span key={i} className="code-box" />)}</span>
        </div>
      </div>
      <p className="paper-instr">Rellene completamente un círculo por pregunta con lápiz grafito. Para Verdadero o Falso use V o F. Las preguntas de desarrollo se responden en la prueba.</p>
      <ol className="sheet-grid">
        {Array.from({ length: n }, (_, i) => {
          // La posición puede ser de distinto tipo en cada forma: se ofrecen las marcas de ambas.
          const types = [forms.A[i]!.v.payload.type, forms.B[i]!.v.payload.type];
          const opts = [...(types.includes("seleccion_multiple") ? LETTERS.slice(0, maxAlts) : []), ...(types.includes("verdadero_falso") ? ["V", "F"] : [])];
          return (
            <li key={i}>
              <b>{i + 1}</b>
              {opts.length ? <span className="bubbles">{opts.map((o) => <span key={o} className="bubble">{o}</span>)}</span> : <span className="small muted">desarrollo</span>}
            </li>
          );
        })}
      </ol>
      <p className="small muted">El lector óptico o la app de escaneo registra las marcas; el sistema las corrige con la pauta de la forma indicada.</p>
    </article>
  );
}


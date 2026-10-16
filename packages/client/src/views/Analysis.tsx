import { useState } from "react";
import { LETTERS, type ItemStats, type ItemVersion } from "@banco/core";
import type { ResultSource } from "../api";
import { useApp, useLoad } from "../ctx";
import { ErrorBox, Loading } from "./common";

const fmt = (x: number) => x.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Clase de color según rangos habituales de interpretación. */
const pClass = (p: number) => (p < 0.2 || p > 0.9 ? "bad" : p < 0.3 || p > 0.8 ? "mid" : "good");
const dClass = (d: number) => (d < 0.2 ? "bad" : d < 0.3 ? "mid" : "good");

const SOURCE_LABEL: Record<ResultSource, [string, string]> = {
  simulado: ["simulados", "Solo simulados"],
  hojas: ["de hojas escaneadas", "Solo hojas escaneadas"],
  moodle: ["importados de Moodle", "Solo Moodle"],
};
const isPrio = (a: string) => a.startsWith("PRIORITARIO");

export function AnalysisView({ id }: { id: number }) {
  const { api, go } = useApp();
  const [source, setSource] = useState<ResultSource | undefined>(undefined);
  const analysis = useLoad(() => api.analysis(id, source), [id, source]);
  const settings = useLoad(() => api.settings(), []);

  if (analysis.error) return <ErrorBox error={analysis.error} />;
  if (!analysis.data) return <Loading />;

  const { instrument, students, stats, correctChoice, sources, gradeDistribution: gd } = analysis.data;
  const present = (Object.keys(SOURCE_LABEL) as ResultSource[]).filter((k) => (sources[k] ?? 0) > 0);
  const originText = present.map((k) => `${sources[k]} ${SOURCE_LABEL[k][0]}`).join(" + ");
  const minResponses = Number(settings.data?.min_responses ?? 30);
  // Mismo orden que el instrumento original (posición en la prueba).
  const rows = instrument.items
    .map((v, i) => ({ v, n: i + 1, s: stats.find((x) => x.itemId === v.id) }))
    .filter((r): r is { v: ItemVersion; n: number; s: ItemStats } => !!r.s);
  const priority = rows.filter((r) => r.s.alerts.some(isPrio)).length;
  const minor = rows.filter((r) => r.s.alerts.length > 0 && !r.s.alerts.some(isPrio)).length;
  const healthy = rows.filter((r) => r.s.alerts.length === 0).length;
  const maxBucket = Math.max(1, ...gd.buckets.map((b) => b.n));

  return (
    <section>
      <button className="back" onClick={() => go({ name: "instrument", id })}>← Volver a la prueba</button>
      <div className="head">
        <div>
          <h1>Análisis de ítems</h1>
          <p className="muted">{instrument.title}</p>
        </div>
      </div>

      {present.length > 0 && (
        <div className="origin">
          <p><b>Origen de los datos:</b> {originText}{present.length > 1 && ` = ${present.reduce((a, k) => a + (sources[k] ?? 0), 0)} estudiantes`}.</p>
          {present.length > 1 && (
            <div className="seg" role="group" aria-label="Filtrar por origen">
              <button className={!source ? "active" : ""} aria-pressed={!source} onClick={() => setSource(undefined)}>Todos</button>
              {present.map((k) => (
                <button key={k} className={source === k ? "active" : ""} aria-pressed={source === k} onClick={() => setSource(k)}>{SOURCE_LABEL[k][1]} ({sources[k]})</button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="stats-row">
        <div className="stat"><b>{students}</b><span>estudiantes analizados{source ? ` (${SOURCE_LABEL[source][0]})` : ""}</span></div>
        <div className={`stat ${priority ? "stat-alert" : ""}`}><b>{priority}</b><span>con alerta prioritaria</span></div>
        <div className={`stat ${minor ? "stat-warn" : ""}`}><b>{minor}</b><span>con alertas menores</span></div>
        <div className="stat stat-ok"><b>{healthy}</b><span>sanos, sin alertas</span></div>
      </div>
      <p className="hint">
        {sources.simulado ? "Las respuestas simuladas son ficticias, como si vinieran del Aula Virtual. " : ""}
        Grupos alto y bajo: 27 % superior e inferior según puntaje total. Con menos de {minResponses} respuestas los índices son solo referenciales.
      </p>

      {students === 0 ? (
        <p className="empty">Esta prueba aún no tiene respuestas registradas. Cuando se aplique y se importen los resultados del Aula Virtual, aquí aparecerán los índices de cada ítem.</p>
      ) : (<>
        <div className="card grade-dist">
          <h2>Distribución de notas</h2>
          <div className="gd-wrap">
            <div className="gd-bars" role="img" aria-label={`Notas: ${gd.buckets.map((b) => `${b.from},0 a ${b.from === 6 ? "7,0" : `${b.from},9`}: ${b.n}`).join("; ")}`}>
              {gd.buckets.map((b) => (
                <div key={b.from} className={`gd-col ${b.from < 4 ? "fail" : ""}`}>
                  <span className="gd-n">{b.n}</span>
                  <span className="gd-bar" style={{ height: `${(b.n / maxBucket) * 100}%` }} />
                  <span className="gd-label">{b.from},0–{b.from === 6 ? "7,0" : `${b.from},9`}</span>
                </div>
              ))}
            </div>
            <dl className="kv gd-kv">
              <div><dt>Nota promedio</dt><dd>{gd.average.toLocaleString("es-CL", { minimumFractionDigits: 1 })}</dd></div>
              <div><dt>Bajo 4,0</dt><dd>{gd.below4} ({Math.round((gd.below4 / Math.max(1, students)) * 100)} %)</dd></div>
              <div><dt>6,0 o más</dt><dd>{gd.from6}</dd></div>
            </dl>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table analysis">
            <thead>
              <tr><th>N.º</th><th>Enunciado</th><th className="num">n</th><th className="num">p</th><th className="num">D</th><th className="num">r pbis</th><th>Alertas</th></tr>
            </thead>
            <tbody>
              {rows.map(({ v, n, s }) => {
                const prio = s.alerts.some(isPrio);
                return (
                  <tr key={v.id} className={prio ? "prio" : s.alerts.length ? "minor" : ""}>
                    <td>{n}</td>
                    <td title={v.stem}>{short(v.stem)}</td>
                    <td className="num">{s.n}</td>
                    <td className={`num idx-${pClass(s.p)}`}>{fmt(s.p)}</td>
                    <td className={`num idx-${dClass(s.D)}`}>{fmt(s.D)}</td>
                    <td className="num">{s.rpbis === null ? "—" : fmt(s.rpbis)}</td>
                    <td>
                      {s.alerts.length === 0 ? <span className="ok-text">Sin alertas</span> : (
                        <ul className="alerts">{s.alerts.map((a, i) => <li key={i} className={isPrio(a) ? "alert-prio" : "alert-minor"}>{a}</li>)}</ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h2>Distribución de alternativas por grupo</h2>
        <p className="hint">Porcentaje de cada grupo que eligió cada alternativa (orden original del ítem). La clave está marcada. Un buen distractor lo elige más el grupo bajo que el alto.</p>
        <div className="dist-grid">
          {rows.filter((r) => r.v.payload.type === "seleccion_multiple").map(({ v, n, s }) => (
            <Distribution key={v.id} n={n} v={v} s={s} correct={correctChoice[v.id]} />
          ))}
        </div>
      </>)}

      <div className="card explain">
        <h2>¿Cómo leer estos índices?</h2>
        <dl>
          <dt>p · dificultad</dt>
          <dd>Proporción de estudiantes que respondió bien (o del puntaje obtenido). Va de 0 a 1: cerca de 1 es un ítem fácil y cerca de 0, uno difícil. Lo habitual es buscar valores entre 0,30 y 0,80.</dd>
          <dt>D · discriminación</dt>
          <dd>Diferencia de p entre el grupo alto (27 % con mejor resultado total) y el grupo bajo (27 % con peor resultado). Sobre 0,30 discrimina bien; bajo 0,20 conviene revisarlo; si es negativo, el ítem favorece a quienes saben menos y se revisa con prioridad.</dd>
          <dt>r pbis · punto biserial corregida</dt>
          <dd>Correlación entre acertar el ítem y el puntaje en el resto de la prueba (sin contar ese ítem). Valores positivos indican que el ítem mide lo mismo que la prueba en su conjunto.</dd>
          <dt>Alertas prioritarias</dt>
          <dd><b>Clave probablemente errónea</b> (el grupo alto prefiere otra alternativa), <b>pregunta ambigua</b> (el grupo alto se reparte entre dos) o <b>discriminación negativa</b>. Conviene revisarlas antes de calificar.</dd>
          <dt>Alertas menores</dt>
          <dd><b>Muy fácil</b> (p &gt; 0,90), <b>muy difícil</b> (p &lt; 0,20), <b>discriminación baja</b> o <b>distractor no funcional</b> (una alternativa que nadie elige). Sirven para mejorar la pregunta en la próxima versión.</dd>
          <dt>Resultados referenciales</dt>
          <dd>Con menos de {minResponses} respuestas, los índices son inestables y se muestran solo como referencia. El umbral lo configura la institución.</dd>
        </dl>
      </div>
    </section>
  );
}

function Distribution({ n, v, s, correct }: { n: number; v: ItemVersion; s: ItemStats; correct?: string }) {
  const nAlts = v.payload.type === "seleccion_multiple" ? v.payload.alternatives.length : 0;
  const letters = LETTERS.slice(0, nAlts);
  const highTotal = s.choices.reduce((a, c) => a + c.high, 0) || 1;
  const lowTotal = s.choices.reduce((a, c) => a + c.low, 0) || 1;
  return (
    <div className="card dist">
      <h3>Ítem {n}</h3>
      <p className="small muted">{short(v.stem, 120)}</p>
      <div className="dist-legend"><span className="sw sw-high" /> Grupo alto <span className="sw sw-low" /> Grupo bajo</div>
      <ul>
        {letters.map((l) => {
          const c = s.choices.find((x) => x.choice === l) ?? { high: 0, low: 0, total: 0 };
          const hi = Math.round((c.high / highTotal) * 100);
          const lo = Math.round((c.low / lowTotal) * 100);
          const isKey = l === correct;
          return (
            <li key={l} className={isKey ? "is-key" : ""}>
              <span className="dist-letter">{l}{isKey && <small>clave</small>}</span>
              <span className="bars">
                <span className="bar"><span className="track"><span className="fill high" style={{ width: `${hi}%` }} /></span><span className="bar-val">{hi} %</span></span>
                <span className="bar"><span className="track"><span className="fill low" style={{ width: `${lo}%` }} /></span><span className="bar-val">{lo} %</span></span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

import { LETTERS, type ItemStats, type ItemVersion } from "@banco/core";
import { useApp, useLoad } from "../ctx";
import { ErrorBox, Loading } from "./common";

const fmt = (x: number) => x.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Clase de color según rangos habituales de interpretación. */
const pClass = (p: number) => (p < 0.2 || p > 0.9 ? "bad" : p < 0.3 || p > 0.8 ? "mid" : "good");
const dClass = (d: number) => (d < 0.2 ? "bad" : d < 0.3 ? "mid" : "good");

export function AnalysisView({ id }: { id: number }) {
  const { api, go } = useApp();
  const analysis = useLoad(() => api.analysis(id), [id]);
  const settings = useLoad(() => api.settings(), []);

  if (analysis.error) return <ErrorBox error={analysis.error} />;
  if (!analysis.data) return <Loading />;

  const { instrument, students, stats, correctChoice } = analysis.data;
  const minResponses = Number(settings.data?.min_responses ?? 30);
  // Mismo orden que el instrumento original (posición en la prueba).
  const rows = instrument.items
    .map((v, i) => ({ v, n: i + 1, s: stats.find((x) => x.itemId === v.id) }))
    .filter((r): r is { v: ItemVersion; n: number; s: ItemStats } => !!r.s);
  const priority = rows.filter((r) => r.s.alerts.some((a) => a.startsWith("PRIORITARIO"))).length;

  return (
    <section>
      <button className="back" onClick={() => go({ name: "instrument", id })}>← Volver a la prueba</button>
      <div className="head">
        <div>
          <h1>Análisis de ítems</h1>
          <p className="muted">{instrument.title}</p>
        </div>
      </div>

      <div className="stats-row">
        <div className="stat"><b>{students}</b><span>estudiantes (primer intento)</span></div>
        <div className="stat"><b>{minResponses}</b><span>respuestas mínimas para interpretar</span></div>
        <div className="stat"><b>{rows.length}</b><span>ítems analizados</span></div>
        <div className={`stat ${priority ? "stat-alert" : ""}`}><b>{priority}</b><span>con alerta prioritaria</span></div>
      </div>
      <p className="hint">Respuestas simuladas para el demo (ficticias), como si vinieran del Aula Virtual. Grupos alto y bajo: 27 % superior e inferior según puntaje total.</p>

      <div className="table-wrap">
        <table className="table analysis">
          <thead>
            <tr><th>N.º</th><th>Enunciado</th><th className="num">n</th><th className="num">p</th><th className="num">D</th><th className="num">r pbis</th><th>Alertas</th></tr>
          </thead>
          <tbody>
            {rows.map(({ v, n, s }) => {
              const prio = s.alerts.some((a) => a.startsWith("PRIORITARIO"));
              return (
                <tr key={v.id} className={prio ? "prio" : ""}>
                  <td>{n}</td>
                  <td title={v.stem}>{short(v.stem)}</td>
                  <td className="num">{s.n}</td>
                  <td className={`num idx-${pClass(s.p)}`}>{fmt(s.p)}</td>
                  <td className={`num idx-${dClass(s.D)}`}>{fmt(s.D)}</td>
                  <td className="num">{s.rpbis === null ? "—" : fmt(s.rpbis)}</td>
                  <td>
                    {s.alerts.length === 0 ? <span className="ok-text">Sin alertas</span> : (
                      <ul className="alerts">{s.alerts.map((a, i) => <li key={i} className={a.startsWith("PRIORITARIO") ? "alert-prio" : ""}>{a}</li>)}</ul>
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

      <div className="card explain">
        <h2>¿Cómo leer estos índices?</h2>
        <dl>
          <dt>p · dificultad</dt>
          <dd>Proporción de estudiantes que respondió bien (o del puntaje obtenido). Va de 0 a 1: cerca de 1 es un ítem fácil y cerca de 0, uno difícil. Lo habitual es buscar valores entre 0,30 y 0,80.</dd>
          <dt>D · discriminación</dt>
          <dd>Diferencia de p entre el grupo alto (27 % con mejor resultado total) y el grupo bajo (27 % con peor resultado). Sobre 0,30 discrimina bien; bajo 0,20 conviene revisarlo; si es negativo, el ítem favorece a quienes saben menos y se revisa con prioridad.</dd>
          <dt>r pbis · punto biserial corregida</dt>
          <dd>Correlación entre acertar el ítem y el puntaje en el resto de la prueba (sin contar ese ítem). Valores positivos indican que el ítem mide lo mismo que la prueba en su conjunto.</dd>
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
                <span className="bar"><span className="fill high" style={{ width: `${hi}%` }} /><span className="bar-val">{hi} %</span></span>
                <span className="bar"><span className="fill low" style={{ width: `${lo}%` }} /><span className="bar-val">{lo} %</span></span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

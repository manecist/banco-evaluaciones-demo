import { useMemo, useState } from "react";
import { parseMoodleResponses, simulatedMoodleCsv } from "@banco/core";
import { useApp, useLoad } from "../ctx";
import { ErrorBox, Loading } from "./common";

const fmt = (x: number, d = 1) => x.toLocaleString("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Vuelta de Moodle → banco. La prueba se exporta a Moodle (XML), los
 * estudiantes la rinden ahí y reciben su nota al instante; el docente trae el
 * «Informe de respuestas» para guardar resultados y actualizar el análisis.
 */
export function MoodleView({ id }: { id: number }) {
  const { api, go, toast } = useApp();
  const { data, error } = useLoad(() => api.instrument(id), [id]);
  const [csv, setCsv] = useState("");
  const [example, setExample] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const result = useMemo(() => (data && csv.trim() ? parseMoodleResponses(csv, data.items, data.exigency) : null), [csv, data]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;

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
      toast("Archivo banco-moodle.xml descargado: impórtelo en el banco de preguntas de Moodle");
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setExporting(false);
    }
  };

  const loadExample = () => {
    setCsv(simulatedMoodleCsv(data.items, 30));
    setExample(true);
    toast("Se cargó un informe de respuestas de ejemplo (30 estudiantes ficticios)");
  };

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.(csv|txt|tsv)$/i.test(f.name)) {
      toast("Suba el informe de respuestas descargado de Moodle en formato CSV.", "error");
      return;
    }
    setCsv(await f.text());
    setExample(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.saveMoodleResults(id, csv);
      toast(`Resultados guardados: ${r.saved} estudiantes${r.skipped ? ` (${r.skipped} ya estaban)` : ""}. El análisis de ítems ya los incluye.`);
    } catch (e: any) {
      toast([e.message, ...(e.issues ?? [])].join(" · "), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <button className="back" onClick={() => go({ name: "instrument", id })}>← Volver a la prueba</button>
      <h1>Prueba en línea con Moodle</h1>
      <p className="muted">{data.title}</p>

      <div className="card guide">
        <h2>Cómo funciona</h2>
        <ol className="guide-steps">
          <li><b>Envíe la prueba a Moodle:</b> descargue el XML y, en Moodle, impórtelo en el banco de preguntas del curso (formato «Moodle XML»).</li>
          <li>Cree un <b>cuestionario</b> con esas preguntas. Los estudiantes lo rinden en el Aula Virtual y <b>Moodle les da la nota al instante</b>.</li>
          <li>En el cuestionario: <b>Resultados → Respuestas</b>, marque «Texto de la pregunta» y «Respuesta», y descargue el <b>CSV</b>.</li>
          <li>Súbalo aquí: se <b>quitan nombres y correos</b>, se calza cada respuesta con su pregunta y se actualiza el <b>análisis de ítems</b>.</li>
        </ol>
        <div className="actions wrap">
          <button disabled={exporting} onClick={exportXml}>{exporting ? "Exportando…" : "1. Descargar la prueba para Moodle (XML)"}</button>
        </div>
      </div>

      <div className="card form">
        <h2>Cargue el informe de respuestas de Moodle</h2>
        <div className="actions wrap">
          <button className="primary" onClick={loadExample}>Usar un informe de ejemplo</button>
          <label className="file-btn">Subir CSV de Moodle
            <input type="file" accept=".csv,.txt,.tsv" onChange={(e) => readFile(e.target.files?.[0])} />
          </label>
        </div>
        <p className="hint">Funciona con el informe de Moodle 4.x en español o en inglés. {example && "El ejemplo usa el mismo formato que descarga Moodle 4.5, con personas ficticias."}</p>
      </div>

      {result && (
        <>
          {result.personalColumnsRemoved.length > 0 && (
            <p className="note small"><b>Protección de datos:</b> se descartaron las columnas {result.personalColumnsRemoved.map((c) => `«${c}»`).join(", ")}. Cada estudiante queda con un código anónimo.</p>
          )}
          {result.mapped.length === 0 ? (
            <div className="error">No se reconoció ninguna pregunta de esta prueba en el archivo. Verifique que el cuestionario de Moodle use las preguntas exportadas desde aquí.</div>
          ) : (
            <>
              <div className="stats-row">
                <div className="stat"><b>{result.students.length}</b><span>estudiantes</span></div>
                <div className="stat"><b>{fmt(result.average)}</b><span>nota promedio (escala 1,0–7,0)</span></div>
                <div className="stat"><b>{Math.round(result.passRate * 100)} %</b><span>con nota 4,0 o más</span></div>
                <div className="stat"><b>{result.mapped.length}</b><span>preguntas reconocidas{result.unmatched.length ? ` · ${result.unmatched.length} sin reconocer` : ""}</span></div>
              </div>
              <div className="actions wrap">
                <button className="primary" disabled={saving} onClick={save}>{saving ? "Guardando…" : "Guardar resultados y actualizar el análisis"}</button>
                <button className="ghost" onClick={() => go({ name: "analysis", id })}>Ver análisis de ítems</button>
              </div>

              <h2>Acierto por pregunta</h2>
              <ul className="q-bars wide">
                {result.byItem.map((q) => (
                  <li key={q.itemVersionId} className={q.pctCorrect < 0.3 ? "low" : ""} title={q.stem}>
                    <span>#{q.itemId}</span>
                    <span className="track"><span className="fill high" style={{ width: `${Math.round(q.pctCorrect * 100)}%` }} /></span>
                    <span className="bar-val">{Math.round(q.pctCorrect * 100)} %</span>
                  </li>
                ))}
              </ul>

              <h2>Resultados por estudiante</h2>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Código anónimo</th><th className="num">Calificación en Moodle</th><th className="num">Correctas</th><th className="num">Puntaje</th><th className="num">Nota</th></tr></thead>
                  <tbody>
                    {result.students.map((s) => (
                      <tr key={s.code}>
                        <td>{s.code}</td>
                        <td className="num">{s.moodleGrade ?? "—"}</td>
                        <td className="num">{s.answers.filter((a) => a.correct).length} / {s.answers.length}</td>
                        <td className="num">{fmt(s.score)}</td>
                        <td className={`num ${s.grade < 4 ? "low-grade" : ""}`}><b>{fmt(s.grade)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="hint">El puntaje se recalcula con la pauta del banco, así se puede comparar con la calificación de Moodle. La nota usa la exigencia de la prueba ({Math.round(data.exigency * 100)} %).</p>
            </>
          )}
        </>
      )}
    </section>
  );
}

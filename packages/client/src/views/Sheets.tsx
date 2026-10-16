import { useMemo, useState } from "react";
import { buildForms, gradeSheets, parseSheetsCsv, simulatedSheets } from "@banco/core";
import { useApp, useLoad } from "../ctx";
import { ErrorBox, Loading } from "./common";

const fmt = (x: number, d = 1) => x.toLocaleString("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Corrección rápida de hojas de respuesta: el lector óptico (o una app de
 * escaneo) entrega un archivo con las marcas; el sistema corrige con la pauta
 * de cada forma, calcula notas y avisa qué hojas revisar a mano.
 */
export function SheetsView({ id }: { id: number }) {
  const { api, go, toast } = useApp();
  const { data, error } = useLoad(() => api.instrument(id), [id]);
  const [csv, setCsv] = useState("");
  const [saving, setSaving] = useState(false);
  const [onlyFlags, setOnlyFlags] = useState(false);

  const forms = useMemo(() => (data ? buildForms(data.items, data.seed) : null), [data]);
  const summary = useMemo(() => {
    if (!forms || !data || !csv.trim()) return null;
    const { rows, invalid } = parseSheetsCsv(csv);
    return gradeSheets(forms, rows, { exigency: data.exigency, invalid });
  }, [csv, forms, data]);

  if (error) return <ErrorBox error={error} />;
  if (!data || !forms) return <Loading />;

  const loadExample = () => {
    const rows = simulatedSheets(forms, 40);
    setCsv(["codigo;forma;respuestas", ...rows.map((r) => `${r.code};${r.form};${r.answers}`)].join("\n"));
    toast("Se cargaron 40 hojas escaneadas de ejemplo (simuladas)");
  };

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.(csv|txt|tsv)$/i.test(f.name)) {
      toast("Suba el archivo que entrega el lector óptico o la app de escaneo (CSV o TXT).", "error");
      return;
    }
    setCsv(await f.text());
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.saveSheets(id, csv);
      toast(`Notas guardadas: ${r.saved} hojas${r.skipped ? ` (${r.skipped} ya estaban registradas)` : ""}. El análisis de ítems ya incluye estos resultados.`);
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const download = () => {
    if (!summary) return;
    const lines = ["codigo;forma;correctas;puntaje;nota;observaciones", ...summary.results.map((r) => `${r.code};${r.form};${r.correct};${fmt(r.score)};${fmt(r.grade)};${r.flags.join(" | ")}`)];
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "notas.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const toReview = summary?.results.filter((r) => r.flags.length) ?? [];
  const shown = onlyFlags ? toReview : summary?.results ?? [];

  return (
    <section>
      <button className="back" onClick={() => go({ name: "instrument", id })}>← Volver a la prueba</button>
      <h1>Corregir hojas de respuesta</h1>
      <p className="muted">{data.title}</p>

      <div className="card guide">
        <h2>Cómo funciona</h2>
        <ol className="guide-steps">
          <li>Imprima la prueba y la <b>hoja de respuestas</b> (pestaña «Hoja de respuestas» de la prueba).</li>
          <li>Cada estudiante marca su forma (A o B), su código y una alternativa por pregunta.</li>
          <li>Pase las hojas por el <b>lector óptico</b> o fotografíelas con una app de escaneo: se genera un archivo con las marcas.</li>
          <li>Súbalo aquí. El sistema <b>corrige en segundos</b> con la pauta de cada forma, calcula la nota y le avisa qué hojas revisar a mano.</li>
        </ol>
        <p className="hint">¿La prueba se rindió en línea? Use «Importar resultados de Moodle» en la página de la prueba.</p>
      </div>

      <div className="card form">
        <h2>1. Cargue las hojas</h2>
        <div className="actions wrap">
          <button className="primary" onClick={loadExample}>Cargar 40 hojas escaneadas de ejemplo</button>
          <label className="file-btn">Subir archivo del lector (CSV)
            <input type="file" accept=".csv,.txt,.tsv" onChange={(e) => readFile(e.target.files?.[0])} />
          </label>
        </div>
        <label>Marcas leídas (una hoja por línea: código;forma;respuestas)
          <textarea rows={6} className="mono" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"codigo;forma;respuestas\nE001;A;BCADV\nE002;B;ADC-F"} />
          <small className="help">«-» = pregunta en blanco · «*» = doble marca. Los códigos son anónimos: no se cargan nombres ni RUT.</small>
        </label>
      </div>

      {summary && (
        <>
          <h2>2. Resultados</h2>
          <div className="stats-row">
            <div className="stat"><b>{summary.results.length}</b><span>hojas corregidas</span></div>
            <div className="stat"><b>{fmt(summary.average)}</b><span>nota promedio</span></div>
            <div className="stat"><b>{Math.round(summary.passRate * 100)} %</b><span>con nota 4,0 o más</span></div>
            <div className={`stat ${toReview.length ? "stat-alert" : ""}`}><b>{toReview.length}</b><span>hojas para revisar a mano</span></div>
          </div>
          {summary.manualQuestions > 0 && <p className="note small">{summary.manualQuestions} pregunta(s) de desarrollo o respuesta abierta no se corrigen solas: la nota de esta pantalla considera solo las {fmt(summary.autoPoints, 0)} pts de corrección automática.</p>}
          {summary.invalid.length > 0 && <div className="warn small"><b>Líneas que no se pudieron leer:</b> {summary.invalid.join(" · ")}</div>}

          <div className="actions wrap">
            <button className="primary" disabled={saving} onClick={save}>{saving ? "Guardando…" : "Guardar notas y actualizar el análisis"}</button>
            <button onClick={download}>Descargar notas (CSV)</button>
            <label className="check"><input type="checkbox" checked={onlyFlags} onChange={(e) => setOnlyFlags(e.target.checked)} /> Ver solo las hojas para revisar</label>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Código</th><th>Forma</th><th className="num">Correctas</th><th className="num">Puntaje</th><th className="num">Nota</th><th>Observaciones</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.code + r.form} className={r.flags.length ? "flagged" : ""}>
                    <td>{r.code}</td>
                    <td>{r.form}</td>
                    <td className="num">{r.correct}</td>
                    <td className="num">{fmt(r.score)}</td>
                    <td className={`num ${r.grade < 4 ? "low-grade" : ""}`}><b>{fmt(r.grade)}</b></td>
                    <td className="small">{r.flags.join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>Acierto por pregunta</h2>
          <p className="hint">Porcentaje de estudiantes que respondió bien cada pregunta (numeración de la forma A). Una pregunta con muy pocos aciertos puede estar mal redactada o tener la clave equivocada.</p>
          <ul className="q-bars">
            {summary.byQuestion.map((q) => (
              <li key={q.n} className={q.pctCorrect < 0.3 ? "low" : ""}>
                <span>P{q.n}</span>
                <span className="track"><span className="fill high" style={{ width: `${Math.round(q.pctCorrect * 100)}%` }} /></span>
                <span className="bar-val">{Math.round(q.pctCorrect * 100)} %</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

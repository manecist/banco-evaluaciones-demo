import { useMemo, useState } from "react";
import { BLOOM_LABEL, LEGACY_EXAMPLE, parseLegacyTest, type LegacyQuestion } from "@banco/core";
import { useApp } from "../ctx";

/**
 * Importar una prueba antigua: el texto (de Word, PDF o una foto pasada por OCR)
 * se separa en preguntas; el docente confirma la respuesta correcta de cada una
 * y las importa como BORRADORES, que siguen la revisión normal.
 */
export function ImportView() {
  const { api, catalog, user, go, toast } = useApp();
  const firstModule = catalog.modules.find((m) => m.careerId === user.careerId) ?? catalog.modules[0]!;
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [scanned, setScanned] = useState(false);
  const [moduleId, setModuleId] = useState(firstModule.id);
  const outcomes = useMemo(() => catalog.outcomes.filter((o) => o.moduleId === moduleId), [catalog, moduleId]);
  const [outcomeId, setOutcomeId] = useState(outcomes[0]?.id ?? 0);
  const [edits, setEdits] = useState<Record<number, Partial<LegacyQuestion> & { include?: boolean }>>({});
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => (text.trim() ? parseLegacyTest(text) : null), [text]);
  const questions = (parsed?.questions ?? []).map((q) => ({ ...q, ...edits[q.n] }));
  const included = (q: (typeof questions)[number]) => edits[q.n]?.include ?? (q.type !== "no_reconocida" && q.warnings.length === 0);
  const ready = (q: (typeof questions)[number]) =>
    q.type === "verdadero_falso" ? q.answer !== undefined : q.type === "seleccion_multiple" && q.alternatives.filter((a) => a.correct).length === 1 && q.alternatives.length >= 3;
  const toImport = questions.filter((q) => included(q) && ready(q));

  const setCorrect = (n: number, idx: number) => {
    const q = questions.find((x) => x.n === n)!;
    setEdits((e) => ({ ...e, [n]: { ...e[n], alternatives: q.alternatives.map((a, i) => ({ ...a, correct: i === idx })), include: true } }));
  };

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    setSource(f.name);
    setEdits({});
    if (/\.(txt|md|csv)$/i.test(f.name)) {
      setText(await f.text());
      setScanned(false);
    } else {
      toast("En el sistema real, PDF, Word y fotos se convierten a texto con reconocimiento de texto (OCR) e IA. En este demo, use el ejemplo o pegue el texto.", "error");
    }
  };

  const loadExample = () => {
    setText(LEGACY_EXAMPLE);
    setSource("Prueba de Cuidados Básicos 2019 (escaneada)");
    setScanned(true);
    setEdits({});
  };

  const doImport = async () => {
    setBusy(true);
    try {
      const created = await api.importLegacy({
        moduleId,
        outcomeId,
        source: source || "prueba anterior",
        questions: toImport.map((q) => ({
          stem: q.stem,
          bloomLevel: q.bloomLevel,
          payload: q.type === "verdadero_falso"
            ? { type: "verdadero_falso", answer: q.answer, requiresJustification: false }
            : { type: "seleccion_multiple", alternatives: q.alternatives.map((a) => ({ text: a.text, correct: a.correct, feedback: "" })) },
        })),
      });
      toast(`${created.length} preguntas importadas como borradores`);
      go({ name: "items" });
    } catch (e: any) {
      toast([e.message, ...(e.issues ?? [])].join(" · "), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <button className="back" onClick={() => go({ name: "items" })}>← Volver al banco</button>
      <h1>Importar una prueba antigua</h1>
      <p className="muted">Pase al banco las pruebas que ya tiene en papel, Word o PDF, sin volver a escribirlas.</p>

      <div className="card guide">
        <h2>Cómo funciona</h2>
        <ol className="guide-steps">
          <li><b>Suba la prueba:</b> Word, PDF o una foto o escaneo de la prueba en papel.</li>
          <li>El sistema <b>lee el texto</b> (OCR) y la IA lo <b>separa en preguntas y alternativas</b>.</li>
          <li>Usted <b>revisa y confirma la respuesta correcta</b> de cada pregunta.</li>
          <li>Las preguntas entran como <b>borradores</b> y siguen la revisión normal antes de usarse.</li>
        </ol>
      </div>

      <div className="card form">
        <h2>1. Suba la prueba</h2>
        <div className="actions wrap">
          <button className="primary" onClick={loadExample}>Usar una prueba escaneada de ejemplo</button>
          <label className="file-btn">Subir archivo
            <input type="file" accept=".txt,.md,.pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => readFile(e.target.files?.[0])} />
          </label>
        </div>
        <p className="hint">Demo: los archivos de texto se leen directamente. El reconocimiento de texto de PDF, Word y fotos está simulado con el ejemplo.</p>
        <div className={scanned ? "scan-grid" : ""}>
          {scanned && (
            <figure className="scan" aria-label="Vista de la prueba escaneada">
              <pre>{LEGACY_EXAMPLE}</pre>
              <figcaption>Prueba escaneada (ejemplo ficticio)</figcaption>
            </figure>
          )}
          <label>Texto reconocido {scanned && "(puede corregirlo)"}
            <textarea rows={scanned ? 18 : 8} className="mono" value={text} onChange={(e) => { setText(e.target.value); setEdits({}); }}
              placeholder={"1. Enunciado de la pregunta\na) alternativa\nb) alternativa correcta *\nc) alternativa\n\n2. (V/F) Afirmación\nRespuesta: V"} />
          </label>
        </div>
      </div>

      {parsed && (
        <div className="card form">
          <h2>2. Revise lo que se detectó</h2>
          <p className="hint">Se encontraron <b>{questions.length}</b> preguntas. Confirme la respuesta correcta haciendo clic en el círculo. Las que tienen avisos quedan sin marcar hasta que las revise.</p>
          <ol className="import-list">
            {questions.map((q) => (
              <li key={q.n} className={`${included(q) && ready(q) ? "on" : ""} ${q.type === "no_reconocida" ? "off" : ""}`}>
                <div className="imp-head">
                  <label className="check">
                    <input type="checkbox" disabled={!ready(q)} checked={included(q) && ready(q)} onChange={(e) => setEdits((x) => ({ ...x, [q.n]: { ...x[q.n], include: e.target.checked } }))} />
                    <b>Pregunta {q.n}</b>
                  </label>
                  <span className="badge">{q.type === "verdadero_falso" ? "Verdadero o falso" : q.type === "seleccion_multiple" ? "Selección múltiple" : "No reconocida"}</span>
                  {q.type !== "no_reconocida" && <span className="badge">Bloom {q.bloomLevel} · {BLOOM_LABEL[q.bloomLevel]}</span>}
                </div>
                <input value={q.stem} aria-label={`Enunciado de la pregunta ${q.n}`} onChange={(e) => setEdits((x) => ({ ...x, [q.n]: { ...x[q.n], stem: e.target.value } }))} />
                {q.type === "seleccion_multiple" && (
                  <ul className="imp-alts">
                    {q.alternatives.map((a, i) => (
                      <li key={i} className={a.correct ? "is-key" : ""}>
                        <label className="check"><input type="radio" name={`k${q.n}`} checked={a.correct} onChange={() => setCorrect(q.n, i)} /> <b>{"abcdef"[i]})</b> {a.text}</label>
                      </li>
                    ))}
                  </ul>
                )}
                {q.type === "verdadero_falso" && (
                  <div className="imp-alts">
                    {[true, false].map((v) => (
                      <label key={String(v)} className="check"><input type="radio" name={`k${q.n}`} checked={q.answer === v} onChange={() => setEdits((x) => ({ ...x, [q.n]: { ...x[q.n], answer: v, include: true } }))} /> {v ? "Verdadero" : "Falso"}</label>
                    ))}
                  </div>
                )}
                {q.warnings.filter((w) => !(ready(q) && /respuesta correcta|verdadero o falso/.test(w))).map((w, i) => <p key={i} className="warn small">{w}</p>)}
              </li>
            ))}
          </ol>
        </div>
      )}

      {parsed && (
        <div className="card form">
          <h2>3. Ubique las preguntas e impórtelas</h2>
          <div className="row2">
            <label>Asignatura (módulo)
              <select value={moduleId} onChange={(e) => { const m = Number(e.target.value); setModuleId(m); setOutcomeId(catalog.outcomes.find((o) => o.moduleId === m)?.id ?? 0); }}>
                {catalog.modules.map((m) => <option key={m.id} value={m.id}>{m.code} {m.name}</option>)}
              </select>
            </label>
            <label>Resultado de aprendizaje
              <select value={outcomeId} onChange={(e) => setOutcomeId(Number(e.target.value))}>
                {outcomes.map((o) => <option key={o.id} value={o.id}>{o.code} · {o.text}</option>)}
              </select>
            </label>
          </div>
          <p className="hint">Después puede ajustar cada pregunta por separado (resultado, nivel, puntaje) con «Editar».</p>
          <div className="actions">
            <button className="primary" disabled={busy || toImport.length === 0} onClick={doImport}>{busy ? "Importando…" : `Importar ${toImport.length} pregunta(s) como borradores`}</button>
          </div>
        </div>
      )}
    </section>
  );
}

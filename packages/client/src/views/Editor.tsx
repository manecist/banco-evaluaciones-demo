import { useEffect, useMemo, useState } from "react";
import {
  adviseItem,
  BLOOM_LABEL,
  ITEM_TYPE_LABEL,
  ITEM_TYPES,
  itemInputSchema,
  type ItemPayload,
  type ItemType,
  type Suggestion,
  VERB_LEVELS,
} from "@banco/core";
import type { AiReviewResult } from "../api";
import { useApp, useLoad } from "../ctx";
import { AiReviewOut, ErrorBox, ItemPreview, Loading } from "./common";

const EMPTY: Record<ItemType, ItemPayload> = {
  seleccion_multiple: {
    type: "seleccion_multiple",
    alternatives: [
      { text: "", correct: true, feedback: "" },
      { text: "", correct: false, feedback: "" },
      { text: "", correct: false, feedback: "" },
      { text: "", correct: false, feedback: "" },
    ],
  },
  verdadero_falso: { type: "verdadero_falso", answer: true, requiresJustification: false },
  respuesta_breve: { type: "respuesta_breve", accepted: [""] },
  pareados: { type: "pareados", pairs: [{ left: "", right: "" }, { left: "", right: "" }, { left: "", right: "" }], distractors: [] },
  desarrollo: { type: "desarrollo", rubric: "" },
};

/** Pregunta de muestra para ver el editor y el asesor funcionando con un clic. */
const EXAMPLE = {
  stem: "Durante el control de signos vitales de un paciente adulto en reposo, identifique el rango normal de frecuencia cardiaca.",
  payload: {
    type: "seleccion_multiple",
    alternatives: [
      { text: "60 a 100 latidos por minuto", correct: true, feedback: "" },
      { text: "40 a 60 latidos por minuto", correct: false, feedback: "Bajo 60 se considera bradicardia en un adulto." },
      { text: "100 a 140 latidos por minuto", correct: false, feedback: "Sobre 100 se considera taquicardia en un adulto." },
      { text: "12 a 20 latidos por minuto", correct: false, feedback: "Ese es el rango normal de la frecuencia respiratoria." },
    ],
  } as ItemPayload,
  bloomLevel: 1,
  difficulty: 2,
  points: 2,
};

const TYPE_HELP: Record<ItemType, string> = {
  seleccion_multiple: "Una pregunta con varias opciones y una sola correcta.",
  verdadero_falso: "Una afirmación que el estudiante marca como verdadera o falsa.",
  respuesta_breve: "El estudiante escribe una palabra o frase corta.",
  pareados: "El estudiante une cada elemento de la columna A con uno de la columna B.",
  desarrollo: "Respuesta escrita larga, que se corrige con una pauta.",
};


export function EditorView({ id }: { id?: number }) {
  const { api, catalog, can, go, toast } = useApp();
  const existing = useLoad(() => (id ? api.getItem(id) : Promise.resolve(null)), [id]);
  const [form, setForm] = useState<{
    stem: string; payload: ItemPayload; points: number; moduleId: number; outcomeId: number;
    criterionId: number | null; bloomLevel: number; difficulty: number; reason: string; aiGenerated: boolean;
  } | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<Record<string, "aceptada" | "descartada">>({});
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState<AiReviewResult | null>(null);
  const [applied, setApplied] = useState<{ rule: string; message: string }[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [showGuide, setShowGuide] = useState(true);

  useEffect(() => {
    if (id && !existing.data) return;
    if (form) return;
    const v = existing.data?.current;
    const m = catalog.modules[0]!;
    setForm(v
      ? { stem: v.stem, payload: v.payload, points: v.points, moduleId: v.moduleId, outcomeId: v.outcomeId, criterionId: v.criterionId,
          bloomLevel: v.bloomLevel, difficulty: v.difficulty, reason: "", aiGenerated: v.aiGenerated }
      : { stem: "", payload: EMPTY.seleccion_multiple, points: 2, moduleId: m.id, outcomeId: catalog.outcomes.find((o) => o.moduleId === m.id)!.id,
          criterionId: null, bloomLevel: 1, difficulty: 3, reason: "Creación", aiGenerated: false });
  }, [existing.data, id, form, catalog]);

  // Asesor por reglas: espera 500 ms después de dejar de escribir (RF-04).
  useEffect(() => {
    if (!form) return;
    const t = setTimeout(() => setSuggestions(adviseItem(form)), 500);
    return () => clearTimeout(t);
  }, [form]);

  const outcomes = useMemo(() => catalog.outcomes.filter((o) => o.moduleId === form?.moduleId), [catalog, form?.moduleId]);
  const criteria = useMemo(() => catalog.criteria.filter((c) => c.outcomeId === form?.outcomeId), [catalog, form?.outcomeId]);

  if (existing.error) return <ErrorBox error={existing.error} />;
  if (!form) return <Loading />;

  const upd = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const updP = (p: ItemPayload) => setForm({ ...form, payload: p });
  const module = catalog.modules.find((m) => m.id === form.moduleId)!;

  const decide = (s: Suggestion, d: "aceptada" | "descartada") => setDecisions((x) => ({ ...x, [s.rule]: d }));

  /** Aplica la solución propuesta por el asesor; queda registrada como sugerencia aceptada. */
  const applyFix = (s: Suggestion) => {
    if (!s.fix) return;
    setApplied((a) => [...a.filter((x) => x.rule !== s.rule), { rule: s.rule, message: s.message }]);
    upd({ ...(s.fix.stem ? { stem: s.fix.stem } : {}), ...(s.fix.bloomLevel ? { bloomLevel: s.fix.bloomLevel } : {}) });
    toast("Solución aplicada: puede seguir editando el texto");
  };

  const save = async () => {
    const check = itemInputSchema.safeParse({ ...form, reason: form.reason || "Edición" });
    if (!check.success) {
      setIssues(check.error.issues.map((i) => `${i.path.join(".") || "ítem"}: ${i.message}`));
      return;
    }
    setIssues([]);
    setSaving(true);
    try {
      const saved = id ? await api.updateItem(id, check.data) : await api.createItem(check.data);
      // Las decisiones sobre las sugerencias quedan registradas para el revisor.
      for (const s of suggestions) {
        const d = decisions[s.rule];
        if (d && !applied.some((a) => a.rule === s.rule)) await api.advisorDecision(saved.current.id, { rule: s.rule, message: s.message, decision: d });
      }
      for (const a of applied) await api.advisorDecision(saved.current.id, { ...a, decision: "aceptada" });
      toast(id ? `Guardado como versión ${saved.current.versionNo}` : "Ítem creado en borrador");
      go({ name: "item", id: saved.id });
    } catch (e: any) {
      setIssues([e.message, ...(e.issues ?? [])]);
    } finally {
      setSaving(false);
    }
  };

  const loadExample = () => {
    const o = catalog.outcomes.find((x) => x.moduleId === module.id) ?? catalog.outcomes[0]!;
    setForm({ ...form, ...EXAMPLE, moduleId: o.moduleId, outcomeId: o.id, criterionId: null });
    setReview(null);
    toast("Ejemplo cargado: revise los pasos y pruebe cambiar el texto");
  };

  const askReview = async () => {
    if (form.payload.type !== "seleccion_multiple") return;
    setReviewing(true);
    try {
      setReview(await api.aiReview({ stem: form.stem, alternatives: form.payload.alternatives.map((a) => ({ text: a.text, correct: a.correct })) }));
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setReviewing(false);
    }
  };

  const p = form.payload;
  const outcome = catalog.outcomes.find((o) => o.id === form.outcomeId);
  return (
    <section>
      <button className="back" onClick={() => go(id ? { name: "item", id } : { name: "items" })}>← Cancelar</button>
      <h1>{id ? `Editar ítem #${id}` : "Nueva pregunta (ítem)"}</h1>
      {existing.data?.status === "visado" && <p className="warn">Este ítem está visado: al guardar se crea un borrador y la versión publicada sigue vigente hasta una nueva visación.</p>}

      {!id && showGuide && (
        <div className="card guide">
          <div className="guide-head">
            <h2>Cómo crear una pregunta</h2>
            <button className="small ghost" onClick={() => setShowGuide(false)}>Ocultar guía</button>
          </div>
          <ol className="guide-steps">
            <li><b>Ubique la pregunta</b> en el programa: asignatura y resultado de aprendizaje.</li>
            <li><b>Elija el tipo</b> de pregunta y qué tan exigente es.</li>
            <li><b>Escriba la pregunta</b> que leerá el estudiante.</li>
            <li><b>Escriba las respuestas</b> y marque usted la correcta.</li>
            <li><b>Guarde.</b> La pregunta queda en borrador; después la envía a revisión.</li>
          </ol>
          <p className="hint">Mientras escribe, el <b>Asesor</b> de la derecha le da consejos. Si quiere ver un ejemplo completo primero, cárguelo con el botón.</p>
          <div className="actions"><button className="primary" onClick={loadExample}>Cargar un ejemplo</button></div>
        </div>
      )}

      <div className="editor">
        <div className="card form">
          <fieldset>
            <legend><span className="step">1</span> ¿De qué asignatura y tema es la pregunta?</legend>
            <label>Asignatura (módulo)
              <select value={form.moduleId} onChange={(e) => {
                const mid = Number(e.target.value);
                upd({ moduleId: mid, outcomeId: catalog.outcomes.find((o) => o.moduleId === mid)!.id, criterionId: null });
              }}>
                {catalog.modules.map((m) => <option key={m.id} value={m.id}>{m.code} {m.name}</option>)}
              </select>
              <small className="help">La asignatura donde se usará la pregunta. Programa vigente: {module.programVersion}.</small>
            </label>
            <label>Resultado de aprendizaje que evalúa
              <select value={form.outcomeId} onChange={(e) => upd({ outcomeId: Number(e.target.value), criterionId: null })}>
                {outcomes.map((o) => <option key={o.id} value={o.id}>{o.code} · {o.text}</option>)}
              </select>
              <small className="help">Lo que el estudiante debe saber hacer al terminar la unidad. Elija el que esta pregunta comprueba.</small>
            </label>
            <label><span>Criterio de evaluación <span className="opt">(opcional)</span></span>
              <select value={form.criterionId ?? ""} onChange={(e) => upd({ criterionId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">(sin criterio)</option>
                {criteria.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.text}</option>)}
              </select>
              <small className="help">Un detalle más específico dentro del resultado. Si no está seguro, déjelo sin criterio.</small>
            </label>
            <p className="hint">Estas listas no se escriben a mano: vienen del programa oficial de cada asignatura, que carga la institución.</p>
          </fieldset>

          <fieldset>
            <legend><span className="step">2</span> ¿Qué tipo de pregunta es y qué tan exigente?</legend>
            <label>Tipo de pregunta
              <select value={p.type} onChange={(e) => updP(EMPTY[e.target.value as ItemType])}>
                {ITEM_TYPES.map((t) => <option key={t} value={t}>{ITEM_TYPE_LABEL[t]}</option>)}
              </select>
              <small className="help">{TYPE_HELP[p.type]}</small>
            </label>
            <div className="row2">
              <label>Nivel de exigencia (Bloom)
                <select value={form.bloomLevel} onChange={(e) => upd({ bloomLevel: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} · {BLOOM_LABEL[n]}</option>)}
                </select>
                <small className="help">Qué hace el estudiante para responder: desde recordar un dato (1) hasta crear algo nuevo (6). Vea el torpedo a la derecha.</small>
              </label>
              <label>Dificultad estimada
                <select value={form.difficulty} onChange={(e) => upd({ difficulty: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} · {["", "Muy fácil", "Fácil", "Media", "Difícil", "Muy difícil"][n]}</option>)}
                </select>
                <small className="help">Su estimación. Después se compara con los resultados reales.</small>
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend><span className="step">3</span> Escriba la pregunta</legend>
            <label>Enunciado (lo que leerá el estudiante)
              <textarea rows={3} value={form.stem} onChange={(e) => upd({ stem: e.target.value })} placeholder="Ej.: Durante el control de signos vitales, identifique el rango normal de frecuencia cardiaca en un adulto." />
              <small className="help">Consejo: empiece con un verbo que diga qué debe hacer el estudiante (Identifique, Calcule, Explique…).</small>
            </label>
          </fieldset>

          <fieldset>
            <legend><span className="step">4</span> {p.type === "seleccion_multiple" ? "Escriba las respuestas y marque la correcta" : "Indique la respuesta correcta"}</legend>
            {p.type === "seleccion_multiple" && (
              <div className="alts-edit">
                <p className="hint">Escriba una opción en cada cuadro. Haga clic en el círculo de la <b>respuesta correcta</b>: solo una. La retroalimentación es opcional y explica al estudiante por qué esa opción es incorrecta.</p>
                {p.alternatives.map((a, i) => (
                  <div key={i} className={`alt-row ${a.correct ? "is-correct" : ""}`}>
                    <label className="correct-pick" title="Marcar como respuesta correcta">
                      <input type="radio" name="correct" checked={a.correct} aria-label={`Marcar alternativa ${"ABCDEF"[i]} como correcta`}
                        onChange={() => updP({ ...p, alternatives: p.alternatives.map((x, j) => ({ ...x, correct: j === i })) })} />
                      <span>{"ABCDEF"[i]}{a.correct && <small>correcta</small>}</span>
                    </label>
                    <input value={a.text} placeholder={a.correct ? `Respuesta correcta (${"ABCDEF"[i]})` : `Opción incorrecta (${"ABCDEF"[i]})`} aria-label={`Alternativa ${"ABCDEF"[i]}`}
                      onChange={(e) => updP({ ...p, alternatives: p.alternatives.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                    <input value={a.feedback} placeholder="Retroalimentación (opcional)" aria-label={`Retroalimentación ${"ABCDEF"[i]}`}
                      onChange={(e) => updP({ ...p, alternatives: p.alternatives.map((x, j) => (j === i ? { ...x, feedback: e.target.value } : x)) })} />
                    {p.alternatives.length > 3 ? <button className="small ghost" aria-label={`Quitar alternativa ${"ABCDEF"[i]}`} title="Quitar esta alternativa" onClick={() => updP({ ...p, alternatives: p.alternatives.filter((_, j) => j !== i) })}>×</button> : <span />}
                  </div>
                ))}
                {p.alternatives.length < 6 && <button className="small" onClick={() => updP({ ...p, alternatives: [...p.alternatives, { text: "", correct: false, feedback: "" }] })}>+ Agregar otra opción</button>}
                <p className="hint">Entre 3 y 6 opciones.</p>
              </div>
            )}
            {p.type === "verdadero_falso" && (
              <div className="row3">
                <label>Respuesta correcta
                  <select value={String(p.answer)} onChange={(e) => updP({ ...p, answer: e.target.value === "true" })}>
                    <option value="true">Verdadero</option><option value="false">Falso</option>
                  </select>
                </label>
                <label className="check"><input type="checkbox" checked={p.requiresJustification} onChange={(e) => updP({ ...p, requiresJustification: e.target.checked })} /> Exige justificación</label>
              </div>
            )}
            {p.type === "respuesta_breve" && (
              <label>Respuestas aceptadas (una por línea)
                <textarea rows={3} value={p.accepted.join("\n")} onChange={(e) => updP({ ...p, accepted: e.target.value.split("\n") })} />
                <small className="help">Escriba todas las formas válidas de la respuesta. No importan tildes ni mayúsculas.</small>
              </label>
            )}
            {p.type === "pareados" && (
              <div className="alts-edit">
                <p className="hint">Cada fila es un par correcto: lo de la columna A se une con lo de la columna B.</p>
                {p.pairs.map((x, i) => (
                  <div key={i} className="pair-row">
                    <input value={x.left} placeholder={`Columna A ${i + 1}`} aria-label={`Columna A ${i + 1}`} onChange={(e) => updP({ ...p, pairs: p.pairs.map((y, j) => (j === i ? { ...y, left: e.target.value } : y)) })} />
                    <input value={x.right} placeholder={`Columna B ${i + 1}`} aria-label={`Columna B ${i + 1}`} onChange={(e) => updP({ ...p, pairs: p.pairs.map((y, j) => (j === i ? { ...y, right: e.target.value } : y)) })} />
                  </div>
                ))}
                {p.pairs.length < 10 && <button className="small" onClick={() => updP({ ...p, pairs: [...p.pairs, { left: "", right: "" }] })}>+ Agregar par</button>}
                <label>Opciones extra de la columna B, que no calzan con nada (una por línea)
                  <textarea rows={2} value={p.distractors.join("\n")} onChange={(e) => updP({ ...p, distractors: e.target.value.split("\n").filter((s, i, arr) => s || i === arr.length - 1) })} />
                </label>
              </div>
            )}
            {p.type === "desarrollo" && (
              <label>Pauta de corrección (obligatoria)
                <textarea rows={4} value={p.rubric} onChange={(e) => updP({ ...p, rubric: e.target.value })} />
                <small className="help">Qué debe contener una respuesta completa y cómo se reparte el puntaje.</small>
              </label>
            )}
          </fieldset>

          <fieldset>
            <legend><span className="step">5</span> Puntaje y guardar</legend>
            <div className="row2">
              <label>Puntaje<input type="number" min={0.5} step={0.5} value={form.points} onChange={(e) => upd({ points: Number(e.target.value) })} />
                <small className="help">Cuántos puntos vale en la prueba.</small>
              </label>
              {id && <label>Motivo del cambio<input value={form.reason} placeholder="Ej.: mejora de redacción" onChange={(e) => upd({ reason: e.target.value })} /></label>}
            </div>
            {issues.length > 0 && (
              <div className="error" role="alert"><b>Revise antes de guardar:</b><ul>{issues.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            )}
            <div className="actions">
              <button className="primary" disabled={saving} onClick={save}>{saving ? "Guardando…" : id ? "Guardar nueva versión" : "Guardar pregunta"}</button>
            </div>
            <p className="hint">Al guardar, la pregunta queda en <b>borrador</b>. En la pantalla siguiente use <b>«Enviar a revisión»</b> para que un revisor la apruebe.</p>
          </fieldset>
        </div>

        <aside>
          <div className="card">
            <h2>Vista previa</h2>
            <p className="hint">Así la verá el estudiante. La respuesta correcta aparece destacada solo aquí.</p>
            <ItemPreview v={{ id: 0, itemId: 0, versionNo: 0, authorId: 0, authorName: "", reason: "", createdAt: "", type: p.type, stem: form.stem || "(aquí aparecerá su pregunta)",
              payload: p, points: form.points, moduleId: form.moduleId, outcomeId: form.outcomeId, criterionId: form.criterionId,
              bloomLevel: form.bloomLevel, difficulty: form.difficulty, programVersion: "", aiGenerated: form.aiGenerated }} />
            {outcome && <p className="small muted">Evalúa: {outcome.code} · {outcome.text}</p>}
          </div>

          <div className="card advisor">
            <h2>Asesor automático</h2>
            <p className="hint">Revisa la pregunta mientras escribe, con reglas fijas (no es IA). Cada consejo explica cómo corregirlo y, cuando se puede, ofrece la solución con un clic. El revisor verá qué decidió.</p>
            {suggestions.length === 0 ? <p className="ok">Sin observaciones por ahora.</p> : (
              <ul>
                {suggestions.map((s) => (
                  <li key={s.rule} className={`sev-${s.severity} ${decisions[s.rule] ?? ""}`}>
                    <p><b>{s.message}</b></p>
                    {s.howTo && <p className="howto"><span>Cómo corregirlo:</span> {s.howTo}</p>}
                    {s.fix?.stem && <p className="fix-preview">«{s.fix.stem}»</p>}
                    <div className="actions wrap">
                      {s.fix && <button className="small primary" onClick={() => applyFix(s)}>{s.fix.label}</button>}
                      <button className="small" onClick={() => decide(s, "aceptada")} aria-pressed={decisions[s.rule] === "aceptada"}>Lo corrijo yo</button>
                      <button className="small ghost" onClick={() => decide(s, "descartada")} aria-pressed={decisions[s.rule] === "descartada"}>Lo dejo así</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {p.type === "seleccion_multiple" && can("ai:use") && (
            <div className="card ai-review">
              <h2>Segunda opinión de IA</h2>
              <p className="hint"><b>La respuesta correcta la decide usted.</b> La IA solo revisa la pregunta y avisa si algo se ve dudoso; nunca cambia la respuesta marcada. Después, la revisora valida todo.</p>
              <button disabled={reviewing || !form.stem.trim()} onClick={askReview}>{reviewing ? "Revisando…" : "Pedir segunda opinión"}</button>
              {review && <AiReviewOut review={review} onUseStem={(st) => upd({ stem: st })} />}
            </div>
          )}

          <details className="card torpedo">
            <summary>Torpedo del docente</summary>
            <h3>Niveles de Bloom y verbos para empezar la pregunta</h3>
            <table className="table compact">
              <tbody>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <tr key={n}>
                    <th scope="row" className="nowrap">{n} · {BLOOM_LABEL[n]}</th>
                    <td>{Object.entries(VERB_LEVELS).filter(([, l]) => l === n).slice(0, 5).map(([v]) => v).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Buenas alternativas</h3>
            <ul>
              <li>Una sola respuesta correcta, sin discusión.</li>
              <li>Las incorrectas deben ser creíbles: errores frecuentes de los estudiantes.</li>
              <li>Todas de largo parecido; la correcta no debe ser la más larga.</li>
              <li>Evite «siempre», «nunca», «todas/ninguna de las anteriores».</li>
            </ul>
            <h3>¿Qué pasa después de guardar?</h3>
            <ol>
              <li><b>Borrador:</b> solo usted la ve y la puede editar.</li>
              <li><b>Enviar a revisión:</b> queda recepcionada.</li>
              <li><b>Revisor/a:</b> la toma, la revisa y la visa o la devuelve con comentarios.</li>
              <li><b>Visada:</b> queda disponible para armar pruebas.</li>
            </ol>
          </details>
        </aside>
      </div>
    </section>
  );
}

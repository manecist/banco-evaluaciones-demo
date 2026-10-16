import { useEffect, useMemo, useState } from "react";
import {
  adviseItem,
  BLOOM_LABEL,
  detectBloomLevel,
  ITEM_TYPE_LABEL,
  ITEM_TYPES,
  itemInputSchema,
  type ItemPayload,
  type ItemType,
  type Suggestion,
} from "@banco/core";
import { useApp, useLoad } from "../ctx";
import { ErrorBox, ItemPreview, Loading } from "./common";

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

export function EditorView({ id }: { id?: number }) {
  const { api, catalog, go, toast } = useApp();
  const existing = useLoad(() => (id ? api.getItem(id) : Promise.resolve(null)), [id]);
  const [form, setForm] = useState<{
    stem: string; payload: ItemPayload; points: number; moduleId: number; outcomeId: number;
    criterionId: number | null; bloomLevel: number; difficulty: number; reason: string; aiGenerated: boolean;
  } | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<Record<string, "aceptada" | "descartada">>({});
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [saving, setSaving] = useState(false);

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

  const decide = (s: Suggestion, d: "aceptada" | "descartada") => {
    setDecisions((x) => ({ ...x, [s.rule]: d }));
    if (d === "aceptada" && s.rule === "nivel_por_verbo") {
      const b = detectBloomLevel(form.stem);
      if (b) upd({ bloomLevel: b.level });
    }
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
        if (d) await api.advisorDecision(saved.current.id, { rule: s.rule, message: s.message, decision: d });
      }
      toast(id ? `Guardado como versión ${saved.current.versionNo}` : "Ítem creado en borrador");
      go({ name: "item", id: saved.id });
    } catch (e: any) {
      setIssues([e.message, ...(e.issues ?? [])]);
    } finally {
      setSaving(false);
    }
  };

  const p = form.payload;
  return (
    <section>
      <button className="back" onClick={() => go(id ? { name: "item", id } : { name: "items" })}>← Cancelar</button>
      <h1>{id ? `Editar ítem #${id}` : "Nuevo ítem"}</h1>
      {existing.data?.status === "visado" && <p className="warn">Este ítem está visado: al guardar se crea un borrador y la versión publicada sigue vigente hasta una nueva visación.</p>}

      <div className="editor">
        <div className="card form">
          <fieldset>
            <legend>Ubicación curricular</legend>
            <p className="hint">En el sistema real estos datos se cargan desde el programa del módulo (no se escriben a mano). Programa vigente: {module.programVersion}.</p>
            <div className="row3">
              <label>Módulo
                <select value={form.moduleId} onChange={(e) => {
                  const mid = Number(e.target.value);
                  upd({ moduleId: mid, outcomeId: catalog.outcomes.find((o) => o.moduleId === mid)!.id, criterionId: null });
                }}>
                  {catalog.modules.map((m) => <option key={m.id} value={m.id}>{m.code} {m.name}</option>)}
                </select>
              </label>
              <label>Resultado de aprendizaje
                <select value={form.outcomeId} onChange={(e) => upd({ outcomeId: Number(e.target.value), criterionId: null })}>
                  {outcomes.map((o) => <option key={o.id} value={o.id}>{o.code} · {o.text}</option>)}
                </select>
              </label>
              <label>Criterio
                <select value={form.criterionId ?? ""} onChange={(e) => upd({ criterionId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">(sin criterio)</option>
                  {criteria.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.text}</option>)}
                </select>
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Ítem</legend>
            <div className="row3">
              <label>Tipo
                <select value={p.type} onChange={(e) => updP(EMPTY[e.target.value as ItemType])}>
                  {ITEM_TYPES.map((t) => <option key={t} value={t}>{ITEM_TYPE_LABEL[t]}</option>)}
                </select>
              </label>
              <label>Nivel (Bloom)
                <select value={form.bloomLevel} onChange={(e) => upd({ bloomLevel: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} · {BLOOM_LABEL[n]}</option>)}
                </select>
              </label>
              <label>Dificultad
                <select value={form.difficulty} onChange={(e) => upd({ difficulty: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            <label>Enunciado
              <textarea rows={3} value={form.stem} onChange={(e) => upd({ stem: e.target.value })} placeholder="Ej.: En el turno de mañana, un paciente presenta… ¿Qué acción corresponde realizar primero?" />
            </label>

            {p.type === "seleccion_multiple" && (
              <div className="alts-edit">
                {p.alternatives.map((a, i) => (
                  <div key={i} className="alt-row">
                    <input type="radio" name="correct" checked={a.correct} aria-label={`Marcar alternativa ${i + 1} como correcta`}
                      onChange={() => updP({ ...p, alternatives: p.alternatives.map((x, j) => ({ ...x, correct: j === i })) })} />
                    <input value={a.text} placeholder={`Alternativa ${"ABCDEF"[i]}`} aria-label={`Alternativa ${"ABCDEF"[i]}`}
                      onChange={(e) => updP({ ...p, alternatives: p.alternatives.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                    <input value={a.feedback} placeholder="Retroalimentación" aria-label={`Retroalimentación ${"ABCDEF"[i]}`}
                      onChange={(e) => updP({ ...p, alternatives: p.alternatives.map((x, j) => (j === i ? { ...x, feedback: e.target.value } : x)) })} />
                    {p.alternatives.length > 3 && <button className="small ghost" aria-label="Quitar" onClick={() => updP({ ...p, alternatives: p.alternatives.filter((_, j) => j !== i) })}>×</button>}
                  </div>
                ))}
                {p.alternatives.length < 6 && <button className="small" onClick={() => updP({ ...p, alternatives: [...p.alternatives, { text: "", correct: false, feedback: "" }] })}>+ Alternativa</button>}
                <p className="hint">Marque con el círculo la alternativa correcta (3 a 6 alternativas).</p>
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
              </label>
            )}
            {p.type === "pareados" && (
              <div className="alts-edit">
                {p.pairs.map((x, i) => (
                  <div key={i} className="alt-row">
                    <input value={x.left} placeholder={`Columna A ${i + 1}`} aria-label={`Columna A ${i + 1}`} onChange={(e) => updP({ ...p, pairs: p.pairs.map((y, j) => (j === i ? { ...y, left: e.target.value } : y)) })} />
                    <input value={x.right} placeholder={`Columna B ${i + 1}`} aria-label={`Columna B ${i + 1}`} onChange={(e) => updP({ ...p, pairs: p.pairs.map((y, j) => (j === i ? { ...y, right: e.target.value } : y)) })} />
                  </div>
                ))}
                {p.pairs.length < 10 && <button className="small" onClick={() => updP({ ...p, pairs: [...p.pairs, { left: "", right: "" }] })}>+ Par</button>}
                <label>Distractores de la columna B (uno por línea)
                  <textarea rows={2} value={p.distractors.join("\n")} onChange={(e) => updP({ ...p, distractors: e.target.value.split("\n").filter((s, i, arr) => s || i === arr.length - 1) })} />
                </label>
              </div>
            )}
            {p.type === "desarrollo" && (
              <label>Pauta de corrección (obligatoria)
                <textarea rows={4} value={p.rubric} onChange={(e) => updP({ ...p, rubric: e.target.value })} />
              </label>
            )}

            <div className="row3">
              <label>Puntaje<input type="number" min={0.5} step={0.5} value={form.points} onChange={(e) => upd({ points: Number(e.target.value) })} /></label>
              {id && <label>Motivo del cambio<input value={form.reason} placeholder="Ej.: mejora de redacción" onChange={(e) => upd({ reason: e.target.value })} /></label>}
            </div>
          </fieldset>

          {issues.length > 0 && (
            <div className="error" role="alert"><b>Revise antes de guardar:</b><ul>{issues.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          )}
          <div className="actions">
            <button className="primary" disabled={saving} onClick={save}>{saving ? "Guardando…" : id ? "Guardar nueva versión" : "Crear ítem"}</button>
          </div>
        </div>

        <aside>
          <div className="card advisor">
            <h2>Asesor</h2>
            <p className="hint">Revisa mientras escribe, con reglas explicables. Cada sugerencia se acepta o descarta y queda registrada para el revisor.</p>
            {suggestions.length === 0 ? <p className="ok">Sin observaciones por ahora.</p> : (
              <ul>
                {suggestions.map((s) => (
                  <li key={s.rule} className={`sev-${s.severity} ${decisions[s.rule] ?? ""}`}>
                    <p>{s.message}</p>
                    <div className="actions">
                      <button className="small" onClick={() => decide(s, "aceptada")} aria-pressed={decisions[s.rule] === "aceptada"}>Aceptar</button>
                      <button className="small ghost" onClick={() => decide(s, "descartada")} aria-pressed={decisions[s.rule] === "descartada"}>Descartar</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="card">
            <h2>Vista previa</h2>
            <ItemPreview v={{ id: 0, itemId: 0, versionNo: 0, authorId: 0, authorName: "", reason: "", createdAt: "", type: p.type, stem: form.stem || "(enunciado)",
              payload: p, points: form.points, moduleId: form.moduleId, outcomeId: form.outcomeId, criterionId: form.criterionId,
              bloomLevel: form.bloomLevel, difficulty: form.difficulty, programVersion: "", aiGenerated: form.aiGenerated }} />
          </div>
        </aside>
      </div>
    </section>
  );
}

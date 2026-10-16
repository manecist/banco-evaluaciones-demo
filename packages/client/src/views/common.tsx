import type { ItemVersion } from "@banco/core";
import { BLOOM_LABEL, ITEM_TYPE_LABEL, LETTERS } from "@banco/core";
import { STATUS_LABEL, useApp } from "../ctx";

export function StatusBadge({ s }: { s: string }) {
  return <span className={`badge st-${s}`}>{STATUS_LABEL[s] ?? s}</span>;
}

export function ErrorBox({ error }: { error: string | null }) {
  return error ? <div className="error" role="alert">{error}</div> : null;
}

export function Loading() {
  return <div className="loading"><div className="spinner" /></div>;
}

export function Meta({ v }: { v: ItemVersion }) {
  const { catalog } = useApp();
  const m = catalog.modules.find((x) => x.id === v.moduleId);
  const o = catalog.outcomes.find((x) => x.id === v.outcomeId);
  return (
    <div className="meta">
      <span>{ITEM_TYPE_LABEL[v.type]}</span>
      <span>{m?.code}</span>
      <span title={o?.text}>{o?.code}</span>
      <span>Bloom {v.bloomLevel} · {BLOOM_LABEL[v.bloomLevel]}</span>
      <span>Dificultad {v.difficulty}/5</span>
      <span>{v.points} pts</span>
      {v.aiGenerated && <span className="ai">Generado con IA</span>}
    </div>
  );
}

/** Vista previa del ítem tal como lo vería el estudiante (con la clave marcada). */
export function ItemPreview({ v, showKey = true, order }: { v: ItemVersion; showKey?: boolean; order?: number[] }) {
  const p = v.payload;
  return (
    <div className="preview">
      <p className="stem">{v.stem}</p>
      {p.type === "seleccion_multiple" && (
        <ol className="alts">
          {(order ?? p.alternatives.map((_, i) => i)).map((i, k) => {
            const a = p.alternatives[i]!;
            return (
              <li key={i} className={showKey && a.correct ? "key" : ""}>
                <b>{LETTERS[k]})</b> {a.text}
                {showKey && a.feedback && <small className="fb">{a.feedback}</small>}
              </li>
            );
          })}
        </ol>
      )}
      {p.type === "verdadero_falso" && (
        <p>V ___ F ___ {showKey && <span className="keytxt">Clave: {p.answer ? "Verdadero" : "Falso"}</span>}{p.requiresJustification && " (justifique)"}</p>
      )}
      {p.type === "respuesta_breve" && (
        <p>__________________ {showKey && <span className="keytxt">Acepta: {p.accepted.join(" · ")}</span>}</p>
      )}
      {p.type === "pareados" && (
        <div className="pairs">
          <ol>{p.pairs.map((x, i) => <li key={i}>{x.left}</li>)}</ol>
          <ol type="a">{[...p.pairs.map((x) => x.right), ...p.distractors].sort().map((r, i) => <li key={i}>{r}</li>)}</ol>
        </div>
      )}
      {p.type === "desarrollo" && showKey && <p className="keytxt">Pauta: {p.rubric}</p>}
    </div>
  );
}

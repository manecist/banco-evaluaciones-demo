import type { ItemVersion } from "@banco/core";
import { BLOOM_LABEL, ITEM_TYPE_LABEL, LETTERS } from "@banco/core";
import type { AiReviewResult } from "../api";
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

const KEY_LABEL: Record<AiReviewResult["keyAssessment"], string> = {
  coherente: "Sin observaciones",
  dudosa: "Conviene revisar",
  sin_clave: "Falta marcar la respuesta correcta",
};

/** Resultado de la segunda opinión de IA (lo ven docente y revisora). */
export function AiReviewOut({ review, onUseStem }: { review: AiReviewResult; onUseStem?: (s: string) => void }) {
  const a = review.aiAnswer;
  return (
    <div className="review-out">
      <p><span className={`badge rv-${review.keyAssessment}`}>{KEY_LABEL[review.keyAssessment]}</span></p>
      {a && (
        <div className={`ai-answer ${a.agreesWithKey === false ? "disagree" : a.agreesWithKey ? "agree" : ""}`}>
          <p>
            <b>{a.letter ? `La IA cree que la correcta es la ${a.letter}` : "La IA no propone una alternativa"}</b>
            {a.agreesWithKey === true && " · coincide con la marcada ✓"}
            {a.agreesWithKey === false && a.letter && " · NO coincide con la marcada"}
          </p>
          <p className="small">{a.justification}</p>
        </div>
      )}
      {review.observations.length > 0 && <ul>{review.observations.map((o, i) => <li key={i}>{o}</li>)}</ul>}
      {review.observations.length === 0 && <p className="small">{review.comment}</p>}
      {review.suggestedStem && onUseStem && (
        <div className="suggest">
          <p className="small"><b>Redacción sugerida:</b> {review.suggestedStem}</p>
          <button className="small" onClick={() => onUseStem(review.suggestedStem!)}>Usar esta redacción</button>
        </div>
      )}
      {review.piiRemoved > 0 && <p className="small muted">Se quitaron {review.piiRemoved} dato(s) personal(es) antes de enviar el texto.</p>}
      {review.simulated && <p className="small muted">Demo: IA simulada con una base de conocimiento de ejemplo (temas del demo). En producción, un modelo de lenguaje opina sobre cualquier tema. La decisión siempre es de una persona.</p>}
    </div>
  );
}

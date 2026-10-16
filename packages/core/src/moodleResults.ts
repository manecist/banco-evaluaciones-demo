import { LETTERS, mulberry32, scoreToGrade } from "./grading";
import type { ItemVersion } from "./types";

/**
 * Vuelta de Moodle → banco: lee el «Informe de respuestas» de un cuestionario
 * de Moodle 4.x (Resultados → Respuestas → Descargar CSV), en español o inglés.
 *
 * - Elimina nombres, correos y otros datos personales: cada estudiante queda
 *   con un código anónimo estable (el mismo correo siempre da el mismo código).
 * - Calza cada columna con su pregunta por el texto de la pregunta o, si no
 *   viene, por las respuestas; así no importa el orden ni el barajado de Moodle.
 * - Corrige selección múltiple y verdadero o falso con la clave del banco.
 */
export interface MoodleStudent {
  code: string;
  moodleGrade: string | null;
  answers: { itemVersionId: number; response: string; choice: string | null; correct: boolean }[];
  score: number;
  grade: number;
}

export interface MoodleImport {
  students: MoodleStudent[];
  mapped: { column: number; itemId: number; stem: string }[];
  unmatched: number[];
  personalColumnsRemoved: string[];
  autoPoints: number;
  average: number;
  passRate: number;
  byItem: { itemVersionId: number; itemId: number; stem: string; pctCorrect: number }[];
}

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/<[^>]+>/g, " ").replace(/[^a-z0-9ñ%°]+/g, " ").trim();

/** CSV con comillas; detecta coma, punto y coma o tabulador por el encabezado. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** Código anónimo estable (FNV-1a) a partir del correo o el nombre. */
function anonCode(seed: string): string {
  let h = 0x811c9dc5;
  for (const ch of seed.toLowerCase().trim()) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return "M" + h.toString(36).toUpperCase().padStart(7, "0").slice(-7);
}

const PERSONAL = /apellido|nombre|first ?name|last ?name|surname|correo|e-?mail|n[uú]mero de id|id ?number|instituci[oó]n|institution|departamento|department|tel[eé]fono|phone|ciudad|city|rut|run\b/i;
const RESPONSE_COL = /^(?:respuesta|response)\s*(\d+)$/i;
const QUESTION_COL = /^(?:pregunta|question)\s*(\d+)$/i;
const GRADE_COL = /^(?:calificaci[oó]n|grade)\b/i;
const TRUE_WORDS = new Set(["verdadero", "true", "v"]);
const FALSE_WORDS = new Set(["falso", "false", "f"]);

function respondsTo(v: ItemVersion, response: string): boolean {
  const r = norm(response);
  if (!r || r === "-") return false;
  if (v.payload.type === "seleccion_multiple") return v.payload.alternatives.some((a) => norm(a.text) === r);
  if (v.payload.type === "verdadero_falso") return TRUE_WORDS.has(r) || FALSE_WORDS.has(r);
  return false;
}

export function parseMoodleResponses(csv: string, items: ItemVersion[], exigency: number): MoodleImport {
  const rows = parseCsv(csv);
  const header = (rows[0] ?? []).map((h) => h.trim());
  const body = rows.slice(1).filter((r) => !/^(promedio|overall average)/i.test((r.find((c) => c.trim()) ?? "").trim()));
  const personalCols = header.map((h, i) => (PERSONAL.test(h) ? i : -1)).filter((i) => i >= 0);
  const gradeCol = header.findIndex((h) => GRADE_COL.test(h));
  const responseCols = header.map((h, i) => [i, RESPONSE_COL.exec(h)?.[1]] as const).filter(([, n]) => n).map(([i, n]) => ({ col: i, n: Number(n) }));
  const questionCol = new Map(header.map((h, i) => [QUESTION_COL.exec(h)?.[1], i] as const).filter(([n]) => n).map(([n, i]) => [Number(n), i]));
  const real = body.filter((r) => responseCols.some(({ col }) => (r[col] ?? "").trim() && (r[col] ?? "").trim() !== "-"));

  // Calce columna → ítem: por texto de la pregunta si viene; si no, por las respuestas dadas.
  const gradable = items.filter((v) => v.payload.type === "seleccion_multiple" || v.payload.type === "verdadero_falso");
  const used = new Set<number>();
  const mapped: MoodleImport["mapped"] = [];
  const unmatched: number[] = [];
  const colItem = new Map<number, ItemVersion>();
  for (const { col, n } of responseCols) {
    const qc = questionCol.get(n);
    const qText = qc !== undefined ? norm(real.find((r) => (r[qc] ?? "").trim())?.[qc] ?? "") : "";
    let match = qText ? gradable.find((v) => !used.has(v.id) && (norm(v.stem) === qText || qText.includes(norm(v.stem)) || norm(v.stem).includes(qText))) : undefined;
    if (!match) {
      const answers = real.map((r) => r[col] ?? "").filter((x) => x.trim() && x.trim() !== "-");
      let best = 0;
      for (const v of gradable) {
        if (used.has(v.id)) continue;
        const hits = answers.filter((a) => respondsTo(v, a)).length;
        // Sin texto de la pregunta, un V/F calza con cualquier columna V/F: se toma el siguiente en el orden de la prueba.
        if (hits > best) { best = hits; match = v; }
      }
      if (best === 0) match = undefined;
    }
    if (match) {
      used.add(match.id);
      colItem.set(col, match);
      mapped.push({ column: n, itemId: match.itemId, stem: match.stem });
    } else unmatched.push(n);
  }

  const autoPoints = [...colItem.values()].reduce((a, v) => a + v.points, 0);
  const points = new Map(items.map((v) => [v.id, v.points]));
  const perItem = new Map<number, { ok: number; n: number }>();
  const students: MoodleStudent[] = real.map((r, idx) => {
    const id = personalCols.map((i) => r[i] ?? "").join("|") || `fila-${idx}`;
    const answers = [...colItem].map(([col, v]) => {
      const response = (r[col] ?? "").trim();
      const nr = norm(response);
      let choice: string | null = null;
      let correct = false;
      if (v.payload.type === "seleccion_multiple") {
        const k = v.payload.alternatives.findIndex((a) => norm(a.text) === nr);
        choice = k >= 0 ? LETTERS[k] ?? null : null;
        correct = k >= 0 && v.payload.alternatives[k]!.correct;
      } else if (v.payload.type === "verdadero_falso") {
        const ans = TRUE_WORDS.has(nr) ? true : FALSE_WORDS.has(nr) ? false : null;
        choice = ans === null ? null : ans ? "V" : "F";
        correct = ans === v.payload.answer;
      }
      const st = perItem.get(v.id) ?? { ok: 0, n: 0 };
      perItem.set(v.id, { ok: st.ok + (correct ? 1 : 0), n: st.n + 1 });
      return { itemVersionId: v.id, response, choice, correct };
    });
    const score = answers.reduce((a, x) => a + (x.correct ? points.get(x.itemVersionId) ?? 0 : 0), 0);
    return {
      code: anonCode(id),
      moodleGrade: gradeCol >= 0 ? (r[gradeCol] ?? "").trim() || null : null,
      answers,
      score,
      grade: scoreToGrade(score, autoPoints || 1, exigency),
    };
  });

  const average = students.length ? students.reduce((a, s) => a + s.grade, 0) / students.length : 0;
  const passRate = students.length ? students.filter((s) => s.grade >= 4).length / students.length : 0;
  const byItem = [...colItem.values()].map((v) => {
    const st = perItem.get(v.id) ?? { ok: 0, n: 0 };
    return { itemVersionId: v.id, itemId: v.itemId, stem: v.stem, pctCorrect: st.n ? st.ok / st.n : 0 };
  });
  return { students, mapped, unmatched, personalColumnsRemoved: personalCols.map((i) => header[i]!), autoPoints, average, passRate, byItem };
}

/**
 * Informe de respuestas de EJEMPLO con el mismo formato que descarga Moodle 4.5
 * en español (personas ficticias). Moodle baraja las alternativas, pero el
 * informe trae el texto de la respuesta, que es lo que se usa para calzar.
 */
export function simulatedMoodleCsv(items: ItemVersion[], count = 30, seed = 11): string {
  const rnd = mulberry32(seed);
  const qs = items.filter((v) => v.payload.type === "seleccion_multiple" || v.payload.type === "verdadero_falso");
  const total = qs.reduce((a, v) => a + v.points, 0);
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const head = ["Apellido(s)", "Nombre", "Dirección de correo", "Estado", "Comenzado el", "Finalizado", "Tiempo requerido", `Calificación/${total.toFixed(2).replace(".", ",")}`];
  qs.forEach((_, i) => head.push(`Pregunta ${i + 1}`, `Respuesta ${i + 1}`));
  const lines = [head.map(q).join(",")];
  for (let s = 0; s < count; s++) {
    const skill = 0.35 + rnd() * 0.6;
    let score = 0;
    const cells: string[] = [];
    for (const v of qs) {
      let resp = "-";
      if (rnd() > 0.04) {
        const ok = rnd() < skill;
        if (v.payload.type === "seleccion_multiple") {
          const alts = v.payload.alternatives;
          const pick = ok ? alts.find((a) => a.correct)! : alts[Math.floor(rnd() * alts.length)]!;
          resp = pick.text;
          if (pick.correct) score += v.points;
        } else if (v.payload.type === "verdadero_falso") {
          const ans = ok ? v.payload.answer : !v.payload.answer;
          resp = ans ? "Verdadero" : "Falso";
          if (ans === v.payload.answer) score += v.points;
        }
      }
      cells.push(v.stem, resp);
    }
    const n = String(s + 1).padStart(2, "0");
    lines.push([`Ficticio ${n}`, `Estudiante`, `estudiante${n}@ejemplo.cl`, "Finalizado", "16 de octubre de 2026  10:00", "16 de octubre de 2026  10:40", "40 minutos", score.toFixed(2).replace(".", ","), ...cells].map(q).join(","));
  }
  lines.push(['"Promedio general"', ...Array(head.length - 1).fill('""')].join(","));
  return lines.join("\n");
}

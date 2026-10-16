import { detectBloomLevel } from "./advisor";

/**
 * Importación de pruebas antiguas (papel, Word o PDF ya convertidos a texto).
 *
 * En producción el archivo pasa por reconocimiento de texto (OCR) y un modelo
 * de IA ordena el resultado. Este lector por reglas cubre el formato habitual
 * de una prueba escrita y deja todo como BORRADOR para que el docente lo revise:
 *
 *   1. Enunciado…
 *   a) alternativa
 *   b) alternativa *          ← «*», «✓» o «(correcta)» marcan la correcta
 *   Respuesta: b              ← o una línea de respuesta
 *   2. (V/F) Afirmación…      ← verdadero o falso
 *   Pauta: 1-b, 2-V           ← o la pauta completa al final
 */
export interface LegacyQuestion {
  n: number;
  type: "seleccion_multiple" | "verdadero_falso" | "no_reconocida";
  stem: string;
  alternatives: { text: string; correct: boolean }[];
  /** Solo verdadero o falso. */
  answer?: boolean;
  bloomLevel: number;
  warnings: string[];
}

const Q_START = /^\s*(?:pregunta\s*)?(\d{1,3})\s*[.)\-–:]\s*(.+)$/i;
const ALT = /^\s*\(?([a-fA-F])\s*[).\-:]\s*(.+)$/;
const CORRECT_MARK = /\s*(\*|✓|✔|\(correcta\)|\[x\])\s*/gi;
const ANSWER_LINE = /^\s*(?:respuesta|resp\.?|clave|r)\s*[:=]\s*([a-fA-FvVfF]|verdadero|falso)\b/i;
const KEY_LINE = /^\s*(?:pauta|clave|respuestas)\s*[:=]\s*(.+)$/i;
const VF = /^\s*\(?\s*v\s*\/\s*f\s*\)?\s*/i;

export function parseLegacyTest(text: string): { questions: LegacyQuestion[]; ignored: string[] } {
  const questions: LegacyQuestion[] = [];
  const ignored: string[] = [];
  const keyByNumber = new Map<number, string>();
  let cur: LegacyQuestion | null = null;

  const push = () => {
    if (cur) questions.push(cur);
    cur = null;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;

    const key = KEY_LINE.exec(line);
    if (key && /\d/.test(key[1]!)) {
      for (const m of key[1]!.matchAll(/(\d{1,3})\s*[-–:.)=]\s*([a-fA-FvVfF])\b/g)) keyByNumber.set(Number(m[1]), m[2]!.toUpperCase());
      continue;
    }
    const ans = ANSWER_LINE.exec(line);
    if (ans && cur) {
      const a = ans[1]!.toUpperCase();
      const q: LegacyQuestion = cur;
      if (q.type === "verdadero_falso") q.answer = a.startsWith("V");
      else keyByNumber.set(q.n, a[0]!);
      continue;
    }
    const alt = ALT.exec(line);
    if (alt && cur) {
      const q: LegacyQuestion = cur;
      const marked = CORRECT_MARK.test(alt[2]!);
      CORRECT_MARK.lastIndex = 0;
      q.alternatives.push({ text: alt[2]!.replace(CORRECT_MARK, " ").trim(), correct: marked });
      CORRECT_MARK.lastIndex = 0;
      continue;
    }
    const q = Q_START.exec(line);
    if (q) {
      push();
      const isVF = VF.test(q[2]!);
      const stem = q[2]!.replace(VF, "").trim();
      cur = { n: Number(q[1]), type: isVF ? "verdadero_falso" : "seleccion_multiple", stem, alternatives: [], bloomLevel: detectBloomLevel(stem)?.level ?? 1, warnings: [] };
      continue;
    }
    if (cur) {
      const c: LegacyQuestion = cur;
      if (c.alternatives.length === 0) c.stem = `${c.stem} ${line}`.trim(); // enunciado en varias líneas
      else c.alternatives[c.alternatives.length - 1]!.text += ` ${line}`;
    } else {
      ignored.push(line);
    }
  }
  push();

  for (const q of questions) {
    const k = keyByNumber.get(q.n);
    if (q.type === "verdadero_falso") {
      if (k === "V" || k === "F") q.answer = k === "V";
      if (q.answer === undefined) q.warnings.push("Falta indicar si es verdadero o falso");
      continue;
    }
    if (q.alternatives.length === 0) {
      q.type = "no_reconocida";
      q.warnings.push("No se encontraron alternativas: impórtela a mano como otro tipo de pregunta");
      continue;
    }
    if (k) q.alternatives.forEach((a, i) => (a.correct = "ABCDEF"[i] === k));
    const marked = q.alternatives.filter((a) => a.correct).length;
    if (marked === 0) q.warnings.push("No se indicó la respuesta correcta: márquela antes de importar");
    if (marked > 1) q.warnings.push("Hay más de una alternativa marcada como correcta");
    if (q.alternatives.length < 3) q.warnings.push("Tiene menos de 3 alternativas");
  }
  return { questions, ignored };
}

/** Prueba antigua de ejemplo (ficticia), como quedaría tras escanearla y pasarla a texto. */
export const LEGACY_EXAMPLE = `LICEO / INSTITUTO (ejemplo ficticio) — Prueba de Cuidados Básicos — 2019
Nombre: ____________________  Fecha: ________

1. ¿Cuál es el rango normal de saturación de oxígeno en un adulto sano?
a) 80% a 85%
b) 86% a 90%
c) 95% a 100% *
d) 70% a 79%

2. Identifique la vía de administración que corresponde a una inyección en el músculo deltoides.
a) Subcutánea
b) Intramuscular
c) Intradérmica
d) Endovenosa
Respuesta: b

3. (V/F) El pulso radial se controla en la muñeca, por el lado del pulgar.
Respuesta: V

4. Antes de controlar la presión arterial, el paciente debe reposar al menos:
a) 1 minuto
b) 5 minutos
c) 30 minutos

5. Explique con sus palabras qué es la asepsia.

Pauta: 4-b`;

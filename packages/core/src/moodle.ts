import type { ItemVersion } from "./types";

/**
 * Exportación a XML de Moodle (RF-09), importable en el banco de preguntas de
 * Moodle 4.x. Las categorías siguen carrera / módulo / resultado de aprendizaje.
 * El idnumber "banco-<ítem>" permite que al reexportar se actualice la misma
 * pregunta en vez de duplicarla.
 */
export interface MoodleContext {
  careerName(moduleId: number): string;
  moduleName(moduleId: number): string;
  outcomeCode(outcomeId: number): string;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const text = (s: string) => `<text><![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]></text>`;
const html = (s: string) => `<questiontext format="html">${text(`<p>${esc(s).replace(/\n/g, "<br>")}</p>`)}</questiontext>`;

function header(v: ItemVersion, kind: string): string {
  return [
    `  <question type="${kind}">`,
    `    <name>${text(`Ítem ${v.itemId} (v${v.versionNo})`)}</name>`,
    `    ${html(v.stem)}`,
    `    <defaultgrade>${v.points}</defaultgrade>`,
    `    <idnumber>banco-${v.itemId}</idnumber>`,
  ].join("\n");
}

export function toMoodleXml(versions: ItemVersion[], ctx: MoodleContext): string {
  const parts: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', "<quiz>"];
  const byCategory = new Map<string, ItemVersion[]>();
  for (const v of versions) {
    const cat = `$course$/top/${ctx.careerName(v.moduleId)}/${ctx.moduleName(v.moduleId)}/${ctx.outcomeCode(v.outcomeId)}`;
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), v]);
  }

  for (const [cat, list] of byCategory) {
    parts.push(`  <question type="category"><category>${text(cat)}</category></question>`);
    for (const v of list) parts.push(questionXml(v));
  }
  parts.push("</quiz>");
  return parts.join("\n");
}

function questionXml(v: ItemVersion): string {
  const p = v.payload;
  switch (p.type) {
    case "seleccion_multiple":
      return [
        header(v, "multichoice"),
        "    <single>true</single><shuffleanswers>true</shuffleanswers><answernumbering>ABCD</answernumbering>",
        ...p.alternatives.map(
          (a) =>
            `    <answer fraction="${a.correct ? 100 : 0}" format="html">${text(esc(a.text))}<feedback format="html">${text(esc(a.feedback))}</feedback></answer>`,
        ),
        "  </question>",
      ].join("\n");
    case "verdadero_falso":
      return [
        header(v, "truefalse"),
        `    <answer fraction="${p.answer ? 100 : 0}">${text("true")}</answer>`,
        `    <answer fraction="${p.answer ? 0 : 100}">${text("false")}</answer>`,
        "  </question>",
      ].join("\n");
    case "respuesta_breve":
      return [
        header(v, "shortanswer"),
        "    <usecase>0</usecase>",
        ...p.accepted.map((a) => `    <answer fraction="100">${text(a)}</answer>`),
        "  </question>",
      ].join("\n");
    case "pareados":
      return [
        header(v, "matching"),
        "    <shuffleanswers>true</shuffleanswers>",
        ...p.pairs.map((x) => `    <subquestion format="html">${text(esc(x.left))}<answer>${text(x.right)}</answer></subquestion>`),
        ...p.distractors.map((d) => `    <subquestion format="html">${text("")}<answer>${text(d)}</answer></subquestion>`),
        "  </question>",
      ].join("\n");
    case "desarrollo":
      return [
        header(v, "essay"),
        '    <responseformat>editor</responseformat><responserequired>1</responserequired>',
        `    <graderinfo format="html">${text(esc(p.rubric))}</graderinfo>`,
        "  </question>",
      ].join("\n");
  }
}

import { LETTERS, mulberry32 } from "./grading";
import { createInstrument, createItem, getUser, transitionItem, type Db } from "./repo";
import { SCHEMA_SQL } from "./schema";
import type { ItemInput } from "./types";

/**
 * Datos de prueba. TODOS son ficticios: carreras, personas y respuestas se
 * inventaron para la demostración. No hay datos personales reales.
 */
export async function migrate(db: Db): Promise<void> {
  await db.exec(SCHEMA_SQL);
}

const sm = (stem: string, alts: [string, string?][], correct: number, extra: Partial<ItemInput>): ItemInput => ({
  stem,
  payload: {
    type: "seleccion_multiple",
    alternatives: alts.map(([text, feedback], i) => ({ text, correct: i === correct, feedback: feedback ?? "" })),
  },
  points: 2,
  bloomLevel: 1,
  difficulty: 3,
  moduleId: 1,
  outcomeId: 1,
  reason: "Creación",
  ...extra,
});

export async function seed(db: Db): Promise<void> {
  await db.exec(`
    INSERT INTO career (code, name) VALUES
      ('ENF', 'TNS en Enfermería'),
      ('MIN', 'TNS en Mantenimiento Industrial'),
      ('TUR', 'TNS en Turismo de Naturaleza');

    INSERT INTO module (career_id, code, name, program_version) VALUES
      (1, 'ENF-201', 'Cuidados básicos de enfermería', '2026.1'),
      (2, 'MIN-110', 'Seguridad y prevención de riesgos', '2025.2'),
      (3, 'TUR-105', 'Atención de visitantes en áreas protegidas', '2026.1');

    INSERT INTO outcome (module_id, code, text) VALUES
      (1, 'RA1', 'Controlar signos vitales de acuerdo con el protocolo institucional'),
      (1, 'RA2', 'Aplicar medidas de prevención de infecciones asociadas a la atención de salud'),
      (2, 'RA1', 'Identificar riesgos y elementos de protección personal según la tarea'),
      (2, 'RA2', 'Aplicar el procedimiento de bloqueo y etiquetado de energías'),
      (3, 'RA1', 'Explicar las normas de conducta para visitantes en áreas protegidas');

    INSERT INTO criterion (outcome_id, code, text) VALUES
      (1, '1.1', 'Mide presión arterial, pulso, temperatura y frecuencia respiratoria con la técnica correcta'),
      (1, '1.2', 'Registra e informa valores fuera de rango'),
      (2, '2.1', 'Realiza higiene de manos en los cinco momentos'),
      (2, '2.2', 'Usa precauciones estándar y por vía de transmisión'),
      (3, '3.1', 'Selecciona el EPP adecuado al riesgo'),
      (4, '4.1', 'Ejecuta la secuencia de bloqueo y verificación de energía cero'),
      (5, '5.1', 'Describe las normas de la autoridad del área protegida');

    INSERT INTO app_user (name, role, career_id) VALUES
      ('Paula Soto (docente)', 'docente', 1),
      ('Jorge Vera (docente)', 'docente', 2),
      ('Camila Ruiz (revisora)', 'revisor', NULL),
      ('Andrea Muñoz (Área Curricular)', 'area_curricular', NULL),
      ('Luis Pérez (jefatura Enfermería)', 'jefatura', 1),
      ('Marcela Díaz (UTA)', 'uta', NULL),
      ('Administración del sistema', 'admin', NULL),
      ('Rosa Tapia (docente Enfermería)', 'docente', 1);

    INSERT INTO setting (key, value) VALUES
      ('min_responses', '30'),
      ('default_exigency', '0.6'),
      ('coverage_tolerance', '5'),
      ('ai_enabled', 'true'),
      ('ai_daily_limit', '20');
  `);

  const paula = await getUser(db, 1);
  const jorge = await getUser(db, 2);
  const camila = await getUser(db, 3);

  const enf: ItemInput[] = [
    sm("Al controlar la presión arterial de un paciente adulto en el turno de mañana, ¿cuál es la posición correcta del brazo?",
      [["Apoyado y a la altura del corazón"], ["Colgando al costado del cuerpo", "La presión se sobreestima."], ["Elevado sobre la cabeza", "La presión se subestima."], ["Flectado sobre el pecho", "No permite una medición confiable."]], 0,
      { criterionId: 1, difficulty: 2 }),
    sm("Identifique el rango normal de frecuencia respiratoria en un paciente adulto en reposo.",
      [["8 a 10 respiraciones por minuto"], ["12 a 20 respiraciones por minuto"], ["22 a 30 respiraciones por minuto"], ["30 a 40 respiraciones por minuto"]], 1,
      { criterionId: 1, difficulty: 2 }),
    sm("Durante el control de signos vitales, un paciente presenta 39,2 °C de temperatura axilar. ¿Qué acción corresponde realizar primero según el protocolo?",
      [["Registrar el valor e informar de inmediato a la enfermera a cargo"], ["Administrar un antipirético por iniciativa propia", "Requiere indicación."], ["Esperar al siguiente control para confirmar", "Retrasa la atención."], ["Abrigar al paciente para evitar escalofríos", "Puede aumentar la temperatura."]], 0,
      { criterionId: 2, bloomLevel: 3, difficulty: 3 }),
    sm("Calcule la frecuencia de pulso de un paciente si en 15 segundos se cuentan 22 latidos.",
      [["66 latidos por minuto"], ["78 latidos por minuto"], ["88 latidos por minuto"], ["96 latidos por minuto"]], 2,
      { criterionId: 1, bloomLevel: 3, difficulty: 3 }),
    sm("En la atención de un paciente en el servicio de medicina, ¿en cuál de estos momentos NO corresponde realizar higiene de manos según los cinco momentos de la OMS?",
      [["Antes del contacto con el paciente"], ["Después del contacto con el entorno del paciente"], ["Al ingresar a la sala de estar del personal sin contacto previo"], ["Después del riesgo de exposición a fluidos"]], 2,
      { outcomeId: 2, criterionId: 3, bloomLevel: 2, difficulty: 4 }),
    sm("Un paciente del servicio tiene indicación de aislamiento por gotitas. ¿Qué elemento de protección es imprescindible al acercarse a menos de un metro?",
      [["Mascarilla quirúrgica"], ["Solo guantes de procedimiento"], ["Pechera plástica sin mascarilla"], ["Antiparras sin mascarilla"]], 0,
      { outcomeId: 2, criterionId: 4, bloomLevel: 3, difficulty: 3 }),
    sm("Reconocer cuál es la duración mínima recomendada para la higiene de manos con solución alcohólica.",
      [["5 a 10 segundos"], ["20 a 30 segundos"], ["2 minutos"], ["5 minutos"]], 1,
      { outcomeId: 2, criterionId: 3, bloomLevel: 1, difficulty: 2 }),
    sm("En el turno de noche, ¿qué orden de retiro del equipo de protección personal disminuye el riesgo de contaminación?",
      [["Guantes, pechera, antiparras y mascarilla, con higiene de manos al final"], ["Mascarilla, antiparras, pechera y guantes"], ["Pechera, mascarilla, guantes y antiparras"], ["El orden no influye si se usan guantes"]], 0,
      { outcomeId: 2, criterionId: 4, bloomLevel: 3, difficulty: 4 }),
  ];

  const ids: number[] = [];
  for (const it of enf) {
    const d = await createItem(db, paula, it);
    await transitionItem(db, paula, d.id, { to: "recepcionado" });
    await transitionItem(db, camila, d.id, { to: "en_revision" });
    await transitionItem(db, camila, d.id, { to: "visado" });
    ids.push(d.id);
  }

  const vf = await createItem(db, paula, {
    stem: "La temperatura axilar suele ser menor que la temperatura rectal en el mismo paciente.",
    payload: { type: "verdadero_falso", answer: true, requiresJustification: false },
    points: 1, moduleId: 1, outcomeId: 1, criterionId: 1, bloomLevel: 1, difficulty: 2,
  });
  await transitionItem(db, paula, vf.id, { to: "recepcionado" });
  await transitionItem(db, camila, vf.id, { to: "en_revision" });
  await transitionItem(db, camila, vf.id, { to: "visado" });
  ids.push(vf.id);

  // Ítems en otros estados, para ver el flujo de visación.
  const dev = await createItem(db, paula, {
    stem: "Describa siempre los signos vitales.",
    payload: { type: "desarrollo", rubric: "Menciona los 4 signos vitales (1 pt c/u) y su rango normal (1 pt c/u)." },
    points: 8, moduleId: 1, outcomeId: 1, bloomLevel: 4, difficulty: 3,
  });
  await transitionItem(db, paula, dev.id, { to: "recepcionado" });
  await transitionItem(db, camila, dev.id, { to: "en_revision" });
  await transitionItem(db, camila, dev.id, {
    to: "devuelto",
    comment: "El verbo 'describir' es de nivel 2, no 4. Evitar 'siempre' y situar en un caso clínico.",
  });

  await createItem(db, paula, {
    stem: "Relacione cada signo vital con su unidad de medida.",
    payload: {
      type: "pareados",
      pairs: [
        { left: "Presión arterial", right: "mmHg" },
        { left: "Temperatura", right: "°C" },
        { left: "Frecuencia cardiaca", right: "latidos/min" },
        { left: "Saturación de oxígeno", right: "%" },
      ],
      distractors: ["mg/dL"],
    },
    points: 4, moduleId: 1, outcomeId: 1, criterionId: 1, bloomLevel: 1, difficulty: 1,
  });

  const loto = await createItem(db, jorge, {
    stem: "Antes de intervenir una bomba en la planta, ¿cuál es el paso que confirma la energía cero después del bloqueo?",
    payload: {
      type: "seleccion_multiple",
      alternatives: [
        { text: "Intentar el arranque desde el panel local con el equipo bloqueado", correct: true, feedback: "" },
        { text: "Consultar verbalmente al operador", correct: false, feedback: "No es una verificación." },
        { text: "Revisar que la tarjeta esté bien escrita", correct: false, feedback: "La tarjeta no verifica la energía." },
        { text: "Esperar cinco minutos", correct: false, feedback: "El tiempo no garantiza energía cero." },
      ],
    },
    points: 2, moduleId: 2, outcomeId: 4, criterionId: 6, bloomLevel: 3, difficulty: 3,
  });
  await transitionItem(db, jorge, loto.id, { to: "recepcionado" });

  await createItem(db, jorge, {
    stem: "Nombre dos elementos de protección personal obligatorios para esmerilar en el taller.",
    payload: { type: "respuesta_breve", accepted: ["careta facial y guantes", "antiparras y protector auditivo", "careta y protector auditivo"] },
    points: 2, moduleId: 2, outcomeId: 3, criterionId: 5, bloomLevel: 1, difficulty: 2,
  });

  // Instrumento con tabla de especificaciones y respuestas simuladas del Aula Virtual.
  const ins = await createInstrument(db, paula, {
    title: "Prueba 1 · Signos vitales y prevención de IAAS",
    moduleId: 1,
    seed: 2026,
    exigency: 0.6,
    minutes: 45,
    specs: [
      { outcomeId: 1, weight: 50 },
      { outcomeId: 2, weight: 50 },
    ],
    itemIds: ids,
  });

  await simulateResponses(db, ins.id, ins.items.map((v) => ({
    versionId: v.id,
    points: v.points,
    correct: v.payload.type === "seleccion_multiple" ? v.payload.alternatives.findIndex((a) => a.correct) : -1,
    nAlts: v.payload.type === "seleccion_multiple" ? v.payload.alternatives.length : 2,
  })));
}

export interface SimItem { versionId: number; points: number; correct: number; nAlts: number }

/**
 * Perfil de cada pregunta de la Prueba 1 en la simulación (mismo orden de la prueba).
 * Está pensado para que el análisis muestre de todo, con semilla fija:
 * 4 sanas, 2 prioritarias de distinto tipo y 3 alertas menores distintas.
 */
const PROFILE: { a: number; b: number; flip?: boolean; trap?: number; unused?: number; note: string }[] = [
  { a: 1.7, b: -0.1, note: "sana" },
  { a: 1.8, b: 0.5, note: "sana" },
  { a: 1.6, b: 0.8, note: "sana" },
  { a: 1.7, b: 0.2, note: "sana" },
  { a: 1.0, b: -1.2, flip: true, note: "PRIORITARIA: discriminación negativa (enunciado confuso)" },
  { a: 1.5, b: 0.0, unused: 3, note: "menor: distractor que nadie elige" },
  { a: 1.4, b: -2.2, note: "menor: muy fácil" },
  { a: 1.2, b: -0.8, flip: true, trap: 1, note: "PRIORITARIA: clave probablemente errónea (el grupo alto prefiere otra alternativa)" },
  { a: 1.7, b: 2.8, note: "menor: muy difícil" },
];

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Genera los primeros intentos simulados (puros, reproducibles con la semilla). */
export function simulateDemoAttempts(items: SimItem[], count = 64, seed = 1135) {
  const rnd = mulberry32(seed);
  const attempts: { code: string; answers: { versionId: number; choice: string | null; score: number }[] }[] = [];
  for (let s = 1; s <= count; s++) {
    // Suma de uniformes: habilidad con forma de campana.
    const ability = (rnd() + rnd() + rnd() + rnd() - 2) * 2.5 + 1.0;
    const answers = items.map((it, k) => {
      const pr = PROFILE[k] ?? { a: 1.5, b: 0, note: "" };
      const theta = pr.flip ? -ability : ability;
      const keyIdx = it.correct >= 0 ? it.correct : 0; // en V/F, 0 representa la respuesta correcta
      let choiceIdx: number;
      if (pr.trap !== undefined && rnd() < sigmoid(2.4 * (ability - 0.5)) * 0.85) {
        choiceIdx = pr.trap; // el distractor atrae sobre todo a quienes más saben
      } else if (rnd() < sigmoid(pr.a * (theta - pr.b))) {
        choiceIdx = keyIdx;
      } else {
        const wrong = [...Array(it.nAlts).keys()].filter((i) => i !== keyIdx && i !== pr.unused && i !== pr.trap);
        choiceIdx = wrong[Math.floor(rnd() * wrong.length)]!;
      }
      const ok = choiceIdx === keyIdx;
      // Verdadero o falso: se guarda la marca V/F; selección múltiple: la letra original.
      const choice = it.correct >= 0 ? LETTERS[choiceIdx]! : null;
      return { versionId: it.versionId, choice, score: ok ? it.points : 0 };
    });
    attempts.push({ code: `EST-${String(s).padStart(3, "0")}`, answers });
  }
  return attempts;
}

async function simulateResponses(db: Db, instrumentId: number, items: SimItem[]) {
  for (const at of simulateDemoAttempts(items)) {
    const a = await db.query<{ id: number }>(`INSERT INTO attempt (instrument_id, student_code, source) VALUES ($1, $2, 'simulado') RETURNING id`, [instrumentId, at.code]);
    for (const x of at.answers) {
      await db.query(`INSERT INTO answer (attempt_id, item_version_id, choice, score) VALUES ($1,$2,$3,$4)`, [a.rows[0]!.id, x.versionId, x.choice, x.score]);
    }
  }
}

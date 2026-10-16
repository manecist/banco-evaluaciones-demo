import { useMemo, useState } from "react";
import type { AiResult } from "../api";
import { fmtDate, ROLE_LABEL, useApp, useLoad } from "../ctx";
import { ErrorBox, Loading, StatusBadge } from "./common";

const clp = (x: number) => x.toLocaleString("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 2 });
const plain = (name: string | null) => name?.replace(/\s*\(.*\)/, "") ?? "Sistema";

/* ============================ Asistente de IA ============================ */

export function AiView() {
  const { api, catalog, user, go } = useApp();
  const firstModule = catalog.modules.find((m) => m.careerId === user.careerId) ?? catalog.modules[0]!;
  const [moduleId, setModuleId] = useState(firstModule.id);
  const outcomes = useMemo(() => catalog.outcomes.filter((o) => o.moduleId === moduleId), [catalog, moduleId]);
  const [outcomeId, setOutcomeId] = useState(outcomes[0]?.id ?? 0);
  const [context, setContext] = useState("Turno de mañana en un servicio de medicina adulto");
  const [count, setCount] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiResult | null>(null);

  const outcome = outcomes.find((o) => o.id === outcomeId);

  const run = async () => {
    if (!outcome) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.aiDraft({ moduleId, outcomeId, outcomeText: outcome.text, count, context }));
    } catch (e: any) {
      setError([e.message, ...(e.issues ?? [])].join(" · "));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="head">
        <div>
          <h1>Asistente de IA</h1>
          <p className="muted">Propone borradores de ítems a partir de un resultado de aprendizaje. Nada se publica sin revisión humana.</p>
        </div>
      </div>
      <p className="note">Proveedor <b>simulado</b>, sin costo y sin llamadas externas; en producción se conecta el proveedor que defina la institución.</p>

      <div className="grid2">
        <div className="card form">
          <label>Módulo
            <select value={moduleId} onChange={(e) => {
              const mid = Number(e.target.value);
              setModuleId(mid);
              setOutcomeId(catalog.outcomes.find((o) => o.moduleId === mid)?.id ?? 0);
            }}>
              {catalog.modules.map((m) => <option key={m.id} value={m.id}>{m.code} {m.name}</option>)}
            </select>
          </label>
          <label>Resultado de aprendizaje
            <select value={outcomeId} onChange={(e) => setOutcomeId(Number(e.target.value))}>
              {outcomes.map((o) => <option key={o.id} value={o.id}>{o.code} · {o.text}</option>)}
            </select>
          </label>
          <label>Contexto laboral
            <input value={context} maxLength={500} onChange={(e) => setContext(e.target.value)} placeholder="Ej.: faena minera, turno de noche" />
          </label>
          <p className="hint">Antes de enviar el texto al proveedor se eliminan RUT, correos y teléfonos. Pruebe escribiendo uno en el contexto.</p>
          <label>Cantidad de ítems (1 a 5)
            <input type="number" min={1} max={5} value={count} onChange={(e) => setCount(Math.min(5, Math.max(1, Number(e.target.value) || 1)))} />
          </label>
          <div className="actions">
            <button className="primary" disabled={busy || !outcome || !context.trim()} onClick={run}>{busy ? "Generando…" : "Generar borradores"}</button>
          </div>
          <ErrorBox error={error} />
        </div>

        <div className="card">
          <h2>Resultado</h2>
          {!result ? <p className="muted">Aún no se han generado borradores.</p> : (
            <>
              <dl className="kv">
                <div><dt>Borradores creados</dt><dd>{result.created.length}</dd></div>
                <div><dt>Descartados por no cumplir el esquema</dt><dd>{result.discarded}</dd></div>
                <div><dt>Datos personales eliminados</dt><dd>{result.piiRemoved}</dd></div>
                <div><dt>Modelo</dt><dd>{result.model}</dd></div>
                <div><dt>Tokens (entrada / salida)</dt><dd>{result.tokensIn.toLocaleString("es-CL")} / {result.tokensOut.toLocaleString("es-CL")}</dd></div>
                <div><dt>Costo estimado</dt><dd>{clp(result.costClp)}</dd></div>
              </dl>
              {result.created.length > 0 && (
                <>
                  <h3>Borradores (marcados «Generado con IA»)</h3>
                  <ul className="list compact">
                    {result.created.map((it) => (
                      <li key={it.id}>
                        <button className="row" onClick={() => go({ name: "item", id: it.id })}>
                          <div className="row-top"><span className="id">#{it.id}</span><StatusBadge s={it.status} /></div>
                          <p className="stem-line">{it.current.stem}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="hint">Cada borrador debe ser editado y enviado a revisión por la docente; sigue el mismo flujo de visación que cualquier ítem.</p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* ============================ Auditoría ============================ */

export function AuditView() {
  const { api } = useApp();
  const { data, error } = useLoad(() => api.audit(), []);
  return (
    <section>
      <div className="head">
        <div>
          <h1>Bitácora de auditoría</h1>
          <p className="muted">Últimos 100 registros. Cada acción relevante queda con fecha, persona, entidad y detalle; la bitácora no se edita.</p>
        </div>
      </div>
      <ErrorBox error={error} />
      {!data ? <Loading /> : data.length === 0 ? <p className="empty">Sin registros.</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Fecha</th><th>Persona</th><th>Acción</th><th>Entidad</th><th>Detalle</th></tr></thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td className="nowrap">{fmtDate(a.at)}</td>
                  <td>{plain(a.userName)}</td>
                  <td><code>{a.action}</code></td>
                  <td className="nowrap">{a.entity}{a.entityId !== null && ` #${a.entityId}`}</td>
                  <td className="small detail">{Object.keys(a.detail ?? {}).length ? JSON.stringify(a.detail) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ============================ Acerca del demo ============================ */

const SHOWN: [string, string][] = [
  ["RF-01", "Banco de ítems de cinco tipos y búsqueda en español que tolera tildes y errores de tipeo (unaccent + pg_trgm)."],
  ["RF-03", "Metadatos curriculares: carrera, módulo, resultado de aprendizaje, criterio, nivel de Bloom, dificultad y versión del programa."],
  ["RF-04", "Tabla de especificaciones con semáforo de cobertura y asesor por reglas explicables mientras se redacta."],
  ["RF-05", "Flujo de visación borrador → recepcionado → en revisión → visado o devuelto, con reglas verificadas en el servidor."],
  ["RF-06", "Versiones inmutables: la base de datos rechaza con un trigger cualquier modificación o borrado de una versión."],
  ["RF-08", "Asistente de IA con eliminación de datos personales, validación por esquema y revisión humana obligatoria."],
  ["RF-09", "Exportación a formato XML de Moodle."],
  ["RF-10", "Formas A y B barajadas de forma reproducible, pauta de corrección y conversión a nota 1,0–7,0."],
  ["RF-11", "Análisis de ítems: dificultad, discriminación, punto biserial corregida y distribución de alternativas."],
  ["RF-13", "Roles y matriz de permisos aplicada en cada ruta de la API, más bitácora de auditoría."],
];

const ROLES: [string, string, string][] = [
  ["docente", "Paula Soto, Jorge Vera", "Escribe preguntas, las envía a revisión y arma pruebas con las preguntas aprobadas. Puede pedir ayuda a la IA."],
  ["revisor", "Camila Ruiz", "Revisa que cada pregunta esté correcta y bien escrita. La aprueba (visa) o la devuelve con un comentario. Nunca revisa sus propias preguntas."],
  ["area_curricular", "Andrea Muñoz", "Unidad que cuida la calidad curricular: carga los programas (asignaturas, resultados y criterios), define las reglas del asesor, puede revisar y aprobar en cualquier carrera, archiva preguntas obsoletas y revisa la auditoría. También puede redactar preguntas, por ejemplo con la IA, como apoyo a las carreras."],
  ["docente", "Rosa Tapia", "Docente de Enfermería que en el demo actúa como par experto: la jefatura le asigna consultas cuando una revisora duda del contenido."],
  ["jefatura", "Luis Pérez", "Jefe/a de carrera. Tiene un «Panel de carrera»: cuántas preguntas aprobadas hay por asignatura, qué está pendiente de revisión y qué pruebas tienen preguntas con problemas. No redacta ni aprueba: supervisa, atiende las consultas a experto cuando una revisora lo necesita (las responde o las asigna) y decide, por ejemplo, pedir más preguntas en una asignatura."],
  ["uta", "Marcela Díaz", "Unidad Técnico-Pedagógica: asesora a los docentes en cómo evaluar. En «Configuración» define la exigencia para la nota 4,0, la tolerancia de la tabla de especificaciones y cuántas respuestas se necesitan para confiar en el análisis. También analiza resultados y exporta a Moodle."],
  ["admin", "Administración", "Mantiene el sistema funcionando: en «Configuración» activa o desactiva la IA y fija su límite de uso, y revisa qué rol tiene cada persona. No interviene en el contenido de las preguntas."],
];

export function AboutView() {
  const { api } = useApp();
  return (
    <section className="about">
      <h1>Acerca de este demo</h1>
      <p className="note"><b>Todos los datos son ficticios.</b> Personas, carreras, ítems y respuestas fueron inventados para la demostración. Este demo no es un sistema de ninguna institución.</p>

      <div className="card guide">
        <h2>Cómo recorrer el demo en 15 minutos</h2>
        <ol className="guide-steps">
          <li><b>Buscar.</b> Como Paula Soto (docente), en «Banco de ítems» escriba <i>presion</i> sin tilde: igual encuentra «presión».</li>
          <li><b>Crear una pregunta.</b> «+ Nueva pregunta» → «Cargar un ejemplo» → «Guardar pregunta». Mire los consejos del Asesor y pida una segunda opinión a la IA.</li>
          <li><b>Enviar a revisión.</b> En la pregunta guardada, presione «Enviar a revisión».</li>
          <li><b>Aprobar.</b> «Cambiar rol» → Camila Ruiz (revisora). Abra la pregunta: «Tomar para revisión», use la «Ayuda para revisar» → «Visar y publicar».</li>
          <li><b>Consultar a un experto.</b> Si la revisora duda, usa «Consultar a un experto». Luis Pérez (jefatura) la asigna a Rosa Tapia, que responde; después la revisora decide.</li>
          <li><b>Armar una prueba.</b> Vuelva a Paula → «Instrumentos» → «+ Nueva prueba» → «Seleccionar todos» → «Crear prueba». Vea las formas A y B, la pauta, la hoja de respuestas y la exportación a Moodle.</li>
          <li><b>Corregir 40 hojas en segundos.</b> En la «Prueba 1» → «Corregir hojas de respuesta» → «Cargar 40 hojas escaneadas de ejemplo» → «Guardar notas». Luego abra su «Análisis de ítems».</li>
          <li><b>Pasar pruebas antiguas al banco.</b> En «Banco de ítems» → «Importar prueba antigua» → «Usar una prueba escaneada de ejemplo».</li>
          <li><b>Revisar la trazabilidad.</b> Como Andrea Muñoz (Área Curricular), abra «Auditoría»: ahí queda registrado todo lo anterior.</li>
        </ol>
        <p className="hint">Al recargar la página, todo vuelve a su estado inicial.</p>
      </div>

      <div className="card">
        <h2>Quién hace qué</h2>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {ROLES.map(([r, who, what]) => (
                <tr key={who}><th scope="row" className="nowrap">{ROLE_LABEL[r]}<br /><small className="muted">{who}</small></th><td>{what}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">La revisora cuenta con la pauta, el asesor automático y la segunda opinión de IA. Si aun así duda del contenido, consulta a un par experto: la jefatura solo interviene en ese caso. El flujo de aprobación (qué pasos y quién participa) lo configura cada institución.</p>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Qué es</h2>
          <p>
            Una prueba de capacidad técnica de Studios Conari SpA: un módulo de <b>banco de evaluaciones</b> para educación técnica de nivel superior,
            construido para mostrar cómo se abordarían los requisitos de una ficha técnica de este tipo.
          </p>
          <p>
            {api.mode === "local"
              ? "Esta versión corre completa en su navegador: la misma capa de datos del servidor se ejecuta sobre PostgreSQL compilado a WebAssembly (PGlite). Al recargar, los datos vuelven a su estado inicial."
              : "Esta versión está conectada a la API REST con PostgreSQL."}
          </p>
          <h2>Tecnologías</h2>
          <ul className="tags">
            {["TypeScript", "Node.js 20+", "Express 5", "API REST + OpenAPI 3.1", "Zod (validación de esquemas)", "React 19", "Vite", "PostgreSQL 16", "PGlite (demo en navegador)", "Vitest", "Docker Compose"].map((t) => <li key={t}>{t}</li>)}
          </ul>
        </div>

        <div className="card">
          <h2>Qué NO incluye</h2>
          <ul>
            <li>Inicio de sesión institucional real (SSO / OIDC): aquí se elige una persona ficticia.</li>
            <li>Motor PDF institucional: la vista imprimible usa la impresión del navegador.</li>
            <li>Integración con un SGA real ni con un Aula Virtual real: las respuestas de estudiantes son simuladas.</li>
            <li>Un proveedor de IA real: se usa un proveedor simulado, sin costo.</li>
          </ul>
        </div>
      </div>

      <div className="card">
        <h2>Requisitos que muestra</h2>
        <div className="table-wrap">
          <table className="table">
            <tbody>{SHOWN.map(([code, text]) => <tr key={code}><th scope="row" className="nowrap">{code}</th><td>{text}</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      <footer className="about-foot">
        <p>© 2026 Studios Conari SpA. Todos los derechos reservados.</p>
        <p>Código fuente: <a href="https://github.com/manecist/banco-evaluaciones-demo" target="_blank" rel="noreferrer">github.com/manecist/banco-evaluaciones-demo</a></p>
      </footer>
    </section>
  );
}

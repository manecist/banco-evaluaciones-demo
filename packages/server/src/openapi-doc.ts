import { z } from "zod";
import { instrumentInputSchema, itemInputSchema, transitionSchema } from "@banco/core";

const schema = (s: z.ZodType) => z.toJSONSchema(s, { io: "input", unrepresentable: "any" });

/** Especificación OpenAPI 3.1 generada desde los MISMOS esquemas que validan la API. */
export const openApiDocument = {
  openapi: "3.1.0",
  info: { title: "Banco de Evaluaciones — demo Studios Conari", version: "1.0.0" },
  components: {
    securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    schemas: {
      ItemInput: schema(itemInputSchema),
      Transition: schema(transitionSchema),
      InstrumentInput: schema(instrumentInputSchema),
    },
  },
  security: [{ bearer: [] }],
  paths: {
    "/api/items": {
      get: { summary: "Buscar ítems (texto completo en español, filtros)", parameters: ["q", "careerId", "moduleId", "outcomeId", "bloomLevel", "type", "status", "authorId"].map((name) => ({ name, in: "query", schema: { type: "string" } })), responses: { "200": { description: "Lista de ítems" } } },
      post: { summary: "Crear ítem (versión 1)", requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/ItemInput" } } } }, responses: { "201": { description: "Creado" }, "422": { description: "Datos inválidos" } } },
    },
    "/api/items/{id}": {
      get: { summary: "Detalle con versiones, observaciones y auditoría", responses: { "200": { description: "Ítem" } } },
      put: { summary: "Guardar nueva versión inmutable", requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/ItemInput" } } } }, responses: { "200": { description: "Ítem" }, "409": { description: "En revisión" } } },
    },
    "/api/items/{id}/transition": { post: { summary: "Cambiar estado de visación", requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Transition" } } } }, responses: { "200": { description: "Ítem" }, "403": { description: "Sin permiso" } } } },
    "/api/items/{id}/restore/{versionId}": { post: { summary: "Restaurar versión (crea una nueva)", responses: { "200": { description: "Ítem" } } } },
    "/api/items/{id}/archive": { post: { summary: "Archivar (no borra)", responses: { "200": { description: "Ítem" } } } },
    "/api/items/advice": { post: { summary: "Sugerencias del asesor por reglas", responses: { "200": { description: "Sugerencias" } } } },
    "/api/instruments": {
      get: { summary: "Listar instrumentos", responses: { "200": { description: "Lista" } } },
      post: { summary: "Crear instrumento con tabla de especificaciones", requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/InstrumentInput" } } } }, responses: { "201": { description: "Creado" } } },
    },
    "/api/instruments/{id}/analysis": { get: { summary: "Análisis de ítems (p, D, punto biserial corregida)", responses: { "200": { description: "Estadísticos y alertas" } } } },
    "/api/export/moodle": { get: { summary: "Exportar a XML de Moodle", responses: { "200": { description: "XML", content: { "application/xml": {} } } } } },
    "/api/ai/draft": { post: { summary: "Asistente de IA: borradores validados por esquema", responses: { "200": { description: "Borradores creados" } } } },
    "/api/audit": { get: { summary: "Bitácora de auditoría", responses: { "200": { description: "Registros" } } } },
  },
} as const;

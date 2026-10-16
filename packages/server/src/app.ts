import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import { z } from "zod";
import * as core from "@banco/core";
import type { Db, User } from "@banco/core";
import { openApiDocument } from "./openapi-doc.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: User;
  }
}

export interface AppOptions {
  db: Db;
  jwtSecret: string;
  /** En producción el inicio de sesión lo hace el proveedor de identidad del SGA (OIDC). */
  allowDemoLogin: boolean;
  staticDir?: string;
}

const idParam = z.coerce.number().int().positive();

export function createApp({ db, jwtSecret, allowDemoLogin, staticDir }: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: "draft-8", legacyHeaders: false }));

  const h =
    (fn: (req: Request, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) =>
      fn(req, res).then((body) => (res.headersSent ? undefined : res.json(body))).catch(next);

  app.get("/api/health", h(async () => {
    await db.query("SELECT 1");
    return { ok: true };
  }));
  app.get("/api/openapi.json", (_req, res) => res.json(openApiDocument));

  // ---- Identidad (simulada) ----
  app.get("/api/auth/demo-users", h(async () => {
    if (!allowDemoLogin) throw new core.ForbiddenError("Inicio de sesión de demostración desactivado");
    return core.listUsers(db);
  }));
  app.post("/api/auth/demo-login", h(async (req) => {
    if (!allowDemoLogin) throw new core.ForbiddenError("Inicio de sesión de demostración desactivado");
    const { userId } = z.object({ userId: z.number().int().positive() }).parse(req.body);
    const user = await core.getUser(db, userId);
    const token = jwt.sign({ sub: String(user.id), role: user.role }, jwtSecret, { expiresIn: "8h" });
    return { token, user };
  }));

  // Todo lo que sigue exige sesión; el ROL se vuelve a leer de la base en cada solicitud.
  app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    let sub: number;
    try {
      sub = Number((jwt.verify(token, jwtSecret) as { sub: string }).sub);
    } catch {
      return next(Object.assign(new Error("Sesión inválida o vencida"), { status: 401 }));
    }
    core.getUser(db, sub).then((u) => {
      req.user = u;
      next();
    }, () => next(Object.assign(new Error("Usuario no válido"), { status: 401 })));
  });

  const me = (req: Request) => req.user!;

  app.get("/api/me", h(async (req) => me(req)));
  app.get("/api/catalog", h(async () => core.getCatalog(db)));
  app.get("/api/settings", h(async () => core.getSettings(db)));
  app.put("/api/settings", h(async (req) => core.updateSettings(db, me(req), req.body)));
  app.get("/api/career-summary", h(async (req) => core.careerSummary(db, me(req))));

  app.get("/api/items", h(async (req) => core.searchItems(db, me(req), req.query)));
  app.post("/api/items", h(async (req, res) => {
    res.status(201);
    return core.createItem(db, me(req), req.body);
  }));
  app.post("/api/items/advice", h(async (req) => {
    const b = z.object({ stem: z.string(), payload: core.payloadSchema, bloomLevel: z.number(), difficulty: z.number() }).parse(req.body);
    return core.adviseItem(b);
  }));
  app.get("/api/items/:id", h(async (req) => core.getItem(db, me(req), idParam.parse(req.params.id))));
  app.put("/api/items/:id", h(async (req) => core.updateItem(db, me(req), idParam.parse(req.params.id), req.body)));
  app.post("/api/items/:id/transition", h(async (req) => core.transitionItem(db, me(req), idParam.parse(req.params.id), req.body)));
  app.post("/api/items/:id/restore/:versionId", h(async (req) =>
    core.restoreVersion(db, me(req), idParam.parse(req.params.id), idParam.parse(req.params.versionId))));
  app.post("/api/items/:id/archive", h(async (req) => core.archiveItem(db, me(req), idParam.parse(req.params.id))));
  app.post("/api/item-versions/:id/advisor-decisions", h(async (req, res) => {
    const d = z.object({ rule: z.string(), message: z.string(), decision: z.enum(["aceptada", "descartada", "modificada"]) }).parse(req.body);
    await core.recordAdvisorDecision(db, me(req), idParam.parse(req.params.id), d);
    res.status(204).end();
  }));

  app.post("/api/import/legacy", h(async (req) => core.importLegacyItems(db, me(req), req.body)));
  app.post("/api/instruments/:id/sheets", h(async (req) => {
    const b = z.object({ csv: z.string().max(2_000_000) }).parse(req.body);
    return core.saveSheetResults(db, me(req), Number(req.params.id), b.csv);
  }));
  app.post("/api/instruments/:id/moodle-results", h(async (req) => {
    const b = z.object({ csv: z.string().max(5_000_000) }).parse(req.body);
    return core.saveMoodleResults(db, me(req), Number(req.params.id), b.csv);
  }));
  app.get("/api/consultations", h(async (req) => core.listConsultations(db, me(req))));
  app.post("/api/items/:id/consultation", h(async (req) => core.requestConsultation(db, me(req), Number(req.params.id), req.body)));
  app.post("/api/consultations/:id/assign", h(async (req) => core.assignConsultation(db, me(req), Number(req.params.id), req.body)));
  app.post("/api/consultations/:id/resolve", h(async (req) => core.resolveConsultation(db, me(req), Number(req.params.id), req.body)));

  app.get("/api/instruments", h(async (req) => core.listInstruments(db, me(req))));
  app.post("/api/instruments", h(async (req, res) => {
    res.status(201);
    return core.createInstrument(db, me(req), req.body);
  }));
  app.get("/api/instruments/:id", h(async (req) => core.getInstrument(db, me(req), idParam.parse(req.params.id))));
  app.get("/api/instruments/:id/analysis", h(async (req) => {
    const source = z.enum(["simulado", "hojas", "moodle"]).optional().parse(req.query.source || undefined);
    return core.analyzeInstrument(db, me(req), idParam.parse(req.params.id), source);
  }));

  app.get("/api/export/moodle", h(async (req, res) => {
    const q = z.object({ instrumentId: z.coerce.number().int().optional(), itemIds: z.string().optional() }).parse(req.query);
    const r = await core.exportMoodle(db, me(req), {
      instrumentId: q.instrumentId,
      itemIds: q.itemIds?.split(",").map(Number).filter(Boolean),
    });
    res.type("application/xml").attachment("banco-moodle.xml").send(r.xml);
  }));

  app.post("/api/ai/draft", h(async (req) => {
    const b = z.object({
      moduleId: z.number().int(), outcomeId: z.number().int(), outcomeText: z.string(),
      count: z.number().int().min(1).max(5), context: z.string().max(500),
    }).parse(req.body);
    return core.aiDraftItems(db, me(req), b);
  }));

  app.post("/api/ai/review", h(async (req) => {
    const b = z.object({
      stem: z.string().max(4000),
      alternatives: z.array(z.object({ text: z.string().max(1000), correct: z.boolean() })).min(2).max(6),
    }).parse(req.body);
    return core.aiReviewItem(db, me(req), b);
  }));

  app.get("/api/audit", h(async (req) => core.listAudit(db, me(req))));

  if (staticDir) {
    app.use(express.static(staticDir));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile("index.html", { root: staticDir }));
  }

  // Errores: 4xx con mensaje claro; 5xx sin filtrar detalles internos.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) {
      return res.status(422).json({ error: "Datos inválidos", issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    }
    const status = typeof err?.status === "number" ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? "Error interno" : err.message, issues: err.issues });
  });

  return app;
}

import type { Role, Status, User } from "./types";

/**
 * Matriz de permisos (RF-13). Se verifica en CADA ruta de la API, no solo
 * escondiendo botones en la interfaz.
 */
export type Action =
  | "item:read"
  | "item:create"
  | "item:edit_own"
  | "item:submit"
  | "item:review"
  | "item:approve"
  | "item:archive"
  | "instrument:create"
  | "export:moodle"
  | "analysis:read"
  | "audit:read"
  | "ai:use"
  | "settings:edit";

const MATRIX: Record<Role, readonly Action[]> = {
  docente: ["item:read", "item:create", "item:edit_own", "item:submit", "instrument:create", "export:moodle", "analysis:read", "ai:use"],
  jefatura: ["item:read", "analysis:read", "audit:read", "export:moodle"],
  revisor: ["item:read", "item:review", "item:approve", "analysis:read", "audit:read"],
  area_curricular: ["item:read", "item:create", "item:edit_own", "item:submit", "item:review", "item:approve", "item:archive", "instrument:create", "export:moodle", "analysis:read", "audit:read", "ai:use"],
  uta: ["item:read", "export:moodle", "analysis:read", "audit:read", "settings:edit"],
  admin: ["item:read", "audit:read", "settings:edit"],
};

export function can(user: Pick<User, "role">, action: Action): boolean {
  return MATRIX[user.role].includes(action);
}

export class ForbiddenError extends Error {
  readonly status = 403;
}
export class NotFoundError extends Error {
  readonly status = 404;
}
export class ConflictError extends Error {
  readonly status = 409;
}
export class ValidationError extends Error {
  readonly status = 422;
  constructor(message: string, readonly issues: string[] = [message]) {
    super(message);
  }
}

export function assertCan(user: Pick<User, "role">, action: Action): void {
  if (!can(user, action)) throw new ForbiddenError(`El rol "${user.role}" no tiene permiso para ${action}`);
}

/** Transiciones permitidas del flujo de visación (RF-05). */
const TRANSITIONS: Record<Status, Partial<Record<Status, Action>>> = {
  borrador: { recepcionado: "item:submit" },
  devuelto: { recepcionado: "item:submit" },
  recepcionado: { en_revision: "item:review" },
  en_revision: { visado: "item:approve", devuelto: "item:review" },
  visado: {},
};

export function allowedTransitions(from: Status): Status[] {
  return Object.keys(TRANSITIONS[from]) as Status[];
}

export function checkTransition(opts: {
  user: User;
  authorId: number;
  from: Status;
  to: Status;
  comment?: string;
}): void {
  const { user, authorId, from, to, comment } = opts;
  const action = TRANSITIONS[from][to];
  if (!action) throw new ConflictError(`No se puede pasar de "${from}" a "${to}"`);
  assertCan(user, action);
  if (action === "item:submit" && user.id !== authorId && user.role !== "area_curricular") {
    throw new ForbiddenError("Solo la autora o el autor puede enviar su ítem a revisión");
  }
  if ((action === "item:approve" || action === "item:review") && user.id === authorId) {
    throw new ForbiddenError("Un revisor no puede revisar ni visar sus propios ítems");
  }
  if (to === "devuelto" && !comment?.trim()) {
    throw new ValidationError("Devolver un ítem exige un comentario");
  }
}

/** Mientras está en revisión o visado, el ítem no se edita directamente. */
export function isEditable(status: Status): boolean {
  return status === "borrador" || status === "devuelto" || status === "visado";
}

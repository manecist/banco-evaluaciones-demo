# Banco de Evaluaciones — demo técnico

**Demo técnico de Studios Conari SpA** · TypeScript · Node.js · React · PostgreSQL

> [!NOTE]
> **En construcción.** Este repositorio es una prueba de capacidad con **datos ficticios**.
> No es un sistema de ninguna institución.

> [!IMPORTANT]
> © 2026 Studios Conari SpA. Todos los derechos reservados. Ver [`LICENSE`](LICENSE).

Banco de ítems para educación técnica de nivel superior: búsqueda en español tolerante a tildes y errores,
flujo de visación con roles, versiones inmutables, tabla de especificaciones con asesor por reglas,
formas A y B con barajado reproducible, conversión a nota 1,0–7,0, exportación a XML de Moodle,
análisis de ítems (p, D, punto biserial corregida) y asistente de IA con validación humana.

## Estructura

- `packages/core` — modelo de datos (PostgreSQL), reglas de negocio, permisos y pruebas.
- `packages/server` — API REST (Express) con OpenAPI y validación de esquemas.
- `packages/client` — interfaz React; en modo demo usa PostgreSQL en el navegador (PGlite).

## Pruebas

```bash
npm install
npx vitest run
```

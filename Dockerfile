# Imagen de la API REST + interfaz React (modo servidor, contra PostgreSQL 16).

# --- Etapa 1: compila la interfaz React ---
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci
COPY packages ./packages
RUN npm run build -w @banco/client

# --- Etapa 2: ejecución (solo dependencias de producción) ---
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --omit=dev && npm cache clean --force
COPY packages/core/src packages/core/src
COPY packages/server/src packages/server/src
COPY --from=build /app/packages/client/dist packages/client/dist
USER node
EXPOSE 3000
# Crea las tablas y los datos ficticios solo si la base está vacía; luego inicia la API.
CMD ["sh", "-c", "npm run migrate -w @banco/server && npm start -w @banco/server"]

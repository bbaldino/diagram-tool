# syntax=docker/dockerfile:1

# --- build stage: install everything, build frontend + bundle server ---
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
# Reduce node_modules to production deps only for the runtime image.
RUN npm ci --omit=dev

# --- runtime stage: slim, no dev tooling, no Vite ---
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    SERVE_STATIC=true
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/build ./build
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "build/server.js"]

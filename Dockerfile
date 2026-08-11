# ── Build stage ────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .
RUN npx prisma generate
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app ./

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://localhost:3001').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Applies pending migrations against DATABASE_URL before starting —
# prisma migrate deploy is the non-interactive, prod-safe variant
# (unlike `prisma migrate dev`, which prompts and generates new migrations).
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]

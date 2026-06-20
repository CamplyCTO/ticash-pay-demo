# ---- build stage: compile TypeScript -> dist ----
FROM node:20-alpine AS build
WORKDIR /app
# Skip Playwright's browser download during install (it's a dev-only tool).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage: prod deps only ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY public ./public
COPY db ./db
# Render/Railway inject PORT; the app reads it (default 3000). Bind all interfaces.
ENV HOST=0.0.0.0
EXPOSE 3000
CMD ["node", "dist/api/server.js"]

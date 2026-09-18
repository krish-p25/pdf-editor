# ── Stage 1: Install deps ────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./

RUN --mount=type=cache,target=/root/.npm npm ci

# ── Stage 2: Build to dist (Vite) ────────────────────────
FROM deps AS build

WORKDIR /app
COPY . .

# `npm run build` is `tsc -b && vite build`, so a type error fails the image
# build rather than shipping.
RUN npm run build

# ── Stage 3: Production image ────────────────────────────
FROM nginx:alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

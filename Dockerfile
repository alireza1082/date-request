# syntax=docker/dockerfile:1

FROM node:22-alpine AS build

WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

RUN corepack enable \
    && corepack prepare pnpm@12.15.0 --activate

# Keep dependency installation cached until a manifest or lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM nginx/nginx-unprivileged:stable-alpine-slim AS runtime

LABEL org.opencontainers.image.title="Date Wheel" \
      org.opencontainers.image.version="1.3.0" \
      org.opencontainers.image.description="Persian RTL date wheel static frontend"

COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=101:101 /app/dist/ /usr/share/nginx/html/

USER 101:101
EXPOSE 8080

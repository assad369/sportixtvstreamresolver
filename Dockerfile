# Official Playwright image: Chromium + all required system libraries are baked
# in at /ms-playwright, at the browser revision matching playwright 1.61.x.
# Tag MUST track the "playwright" version in package.json.
FROM mcr.microsoft.com/playwright:v1.61.0-noble

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Ensure the Chromium revision our library expects is present (fast no-op when
# the base image already has it). No --with-deps: system libs are in the image.
RUN pnpm exec playwright install chromium

COPY . .
RUN pnpm build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "start"]

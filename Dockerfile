FROM node:20-slim

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Install Chromium and its system dependencies (needs apt-get, available on Debian slim)
RUN pnpm exec playwright install --with-deps chromium

COPY . .
RUN pnpm build

EXPOSE 3000
ENV NODE_ENV=production
CMD ["pnpm", "start"]

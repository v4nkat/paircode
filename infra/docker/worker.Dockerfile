FROM node:24-bookworm-slim
RUN npm install --global pnpm@11.19.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
USER node
CMD ["pnpm", "--filter", "@paircode/worker", "start"]

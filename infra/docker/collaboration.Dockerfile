FROM node:24-bookworm-slim
RUN npm install --global pnpm@11.19.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
USER node
EXPOSE 1234
CMD ["pnpm", "--filter", "@paircode/collaboration", "start"]

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY backend ./backend
COPY llm ./llm
COPY content ./content
COPY frontend ./frontend
COPY tsconfig.json ./
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/.build ./.build
COPY --from=build /app/content ./content
COPY --from=build /app/frontend ./frontend
EXPOSE 3000
CMD ["node", ".build/backend/src/ironmaking-server.js"]

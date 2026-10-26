FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --include=dev --ignore-scripts

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

RUN npm prune --omit=dev --ignore-scripts

CMD ["node", "dist/index.js"]

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production

RUN npm run build

# BOT_TOKEN must be provided at runtime
CMD ["node", "dist/bot/index.js"]


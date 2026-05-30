FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=development

COPY package*.json ./

RUN npm install --include=dev --no-audit --no-fund

COPY . .

RUN npm run build

RUN find dist -maxdepth 4 -type f -print

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/main.js"]
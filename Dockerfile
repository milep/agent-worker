FROM node:24-slim

RUN useradd -m agent

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

USER agent

ENV NODE_ENV=production
ENV PORT=3000

CMD ["npm", "run", "start"]

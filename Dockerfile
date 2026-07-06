FROM node:22-alpine

WORKDIR /app

COPY server.js ./
COPY public ./public
COPY data ./data

ENV PORT=8080
EXPOSE 8080

USER node

CMD ["node", "server.js"]

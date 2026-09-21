FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY dist ./dist

ENV PORT=8000
ENV BNF_SPARQL_URL=https://data.bnf.fr/sparql

EXPOSE 8000

CMD ["node", "dist/http.js"]

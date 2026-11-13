FROM node:22-alpine

WORKDIR /app

# Dépendances d'abord : cette couche reste en cache tant que package*.json ne change pas
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY src ./src
COPY public ./public

# Dossier des données (calendriers + images), à monter en volume pour ne rien perdre
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data
VOLUME /app/data

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# On ne tourne pas en root
USER node

CMD ["node", "server.js"]

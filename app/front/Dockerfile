# Étape 1 : build de l'application React
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN chown -R node:node /app

USER node

RUN npm ci

COPY --chown=node:node . .
RUN npm run build


# Étape 2 : serveur web Nginx
FROM nginx/nginx-unprivileged:alpine AS production

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]

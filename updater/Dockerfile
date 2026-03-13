FROM node:20-alpine

# Install OS utilities required to perform updates on the host repository
RUN apk add --no-cache git docker docker-cli-compose

WORKDIR /updater
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 8080

CMD ["npm", "start"]

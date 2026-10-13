FROM node:22-alpine
WORKDIR /app
COPY package.json server.js hash-password.js ./
COPY public ./public
ENV PORT=5299
EXPOSE 5299
CMD ["node", "server.js"]

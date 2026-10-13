FROM node:22-alpine
WORKDIR /app
COPY package.json server.js hash-password.js ./
COPY public ./public
ENV PORT=3080
EXPOSE 3080
CMD ["node", "server.js"]

FROM node:22-alpine
WORKDIR /app
COPY package.json server.js hash-password.js ./
COPY public ./public
ENV PORT=5095
EXPOSE 5095
CMD ["node", "server.js"]

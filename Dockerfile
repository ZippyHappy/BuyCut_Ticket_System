FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh","-c","npm run migrate && npm start"]



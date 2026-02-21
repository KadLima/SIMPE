FROM node:18-alpine
RUN apk add --no-cache python3 py3-pip
RUN ln -sf python3 /usr/bin/python
RUN pip3 install requests beautifulsoup4 lxml
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
RUN npm install
RUN npx prisma generate
COPY . .
EXPOSE 3000
CMD ["node", "index.js"]
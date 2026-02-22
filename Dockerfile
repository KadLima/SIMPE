FROM node:18-alpine

RUN apk add --no-cache \
    python3 \
    py3-pip \
    chromium \
    chromium-chromedriver \
    harfbuzz \
    nss \
    freetype \
    ttf-freefont \
    fontconfig

RUN python3 -m venv /venv
ENV PATH="/venv/bin:$PATH"

RUN pip3 install --upgrade pip
RUN pip3 install \
    selenium \
    webdriver-manager \
    requests \
    beautifulsoup4 \
    lxml

RUN ln -sf python3 /usr/bin/python

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install
RUN npx prisma generate

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
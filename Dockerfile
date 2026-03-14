FROM node:18-alpine

# Instalar dependências do sistema (incluindo todas necessárias para Chromium)
RUN apk add --no-cache \
    python3 \
    py3-pip \
    chromium \
    chromium-chromedriver \
    harfbuzz \
    nss \
    freetype \
    ttf-freefont \
    fontconfig \
    dbus \
    tzdata \
    udev \
    xrandr \
    xdpyinfo \
    mesa-gl \
    gtk+3.0 \
    cups-libs \
    libxkbcommon \
    libxcomposite \
    libxdamage \
    libxrandr \
    libxi \
    libxtst \
    # Utilitários
    curl \
    wget \
    bash

# Configurar fontes
RUN fc-cache -f

# Configurar Python
RUN python3 -m venv /venv
ENV PATH="/venv/bin:$PATH"

RUN pip3 install --upgrade pip
RUN pip3 install \
    selenium \
    webdriver-manager \
    requests \
    beautifulsoup4 \
    lxml

WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./
COPY prisma ./prisma/

# Instalar dependências Node
RUN npm install
RUN npx prisma generate

# Copiar código fonte
COPY . .

# Criar diretório para dados do Chrome com permissões adequadas
RUN mkdir -p /tmp/chrome-user-data && chmod 777 /tmp/chrome-user-data

# Script de entrada
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
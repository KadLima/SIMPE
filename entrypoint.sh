#!/bin/sh
# entrypoint.sh

# Configurar fontes
mkdir -p /usr/share/fonts
fc-cache -f

# Garantir permissões do Chromium
chmod 1777 /tmp
chmod 1777 /dev/shm

# Criar diretório para dados do Chrome
mkdir -p /tmp/chrome-user-data
chmod 777 /tmp/chrome-user-data

# Iniciar a aplicação
exec node index.js
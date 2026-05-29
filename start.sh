#!/bin/bash
# start.sh
# Script para arrancar The Critic en el servidor Debian
# Uso: bash start.sh
# Mata cualquier instancia anterior y levanta una nueva con todas las variables

echo "Deteniendo instancia anterior (si hay)..."
pkill -f "node server.js" 2>/dev/null
sleep 1

echo "Arrancando The Critic..."
cd /var/www/the-critic

DB_USER=critic_user \
DB_PASSWORD=critic2026 \
DB_NAME=the_critic \
MAIL_USER=interloper.artificialis@gmail.com \
MAIL_PASS="hmsl skkc ffko iyiu" \
SITE_URL=http://192.168.64.5 \
node server.js

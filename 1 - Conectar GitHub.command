#!/bin/bash
# Conecta o app ao GitHub (só precisa fazer 1 vez).
export PATH="$HOME/.local/bin:$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
clear
echo "================================================"
echo "   Conectar o Painel de Mídia Paga ao GitHub"
echo "================================================"
echo ""
echo "Vai aparecer um CODIGO logo abaixo e o navegador abrir."
echo "  1) Copie o codigo"
echo "  2) Cole no navegador e clique em Authorize"
echo "  (se nao tiver conta no GitHub, crie uma gratis na hora)"
echo ""
read -p "Pressione ENTER para comecar..."
echo ""
gh auth login --hostname github.com --git-protocol https --web
echo ""
if gh auth status >/dev/null 2>&1; then
  echo "================================================"
  echo "  CONECTADO! Avise o Claude que ja conectou."
  echo "================================================"
else
  echo "Nao conectou. Tente rodar este arquivo de novo."
fi
echo ""
read -p "Pressione ENTER para fechar."

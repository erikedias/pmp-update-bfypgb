#!/bin/bash
# Abre o Painel de Mídia Paga apontando o Electron pro app (sem a tela padrão)
cd "/Users/erikestecidias/Claude/painel-midia-paga" || exit 1
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
nohup node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . >/tmp/painel-midia-paga.log 2>&1 &
sleep 1
exit 0

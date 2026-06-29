#!/bin/bash
# Recompila o Painel e atualiza o app no /Applications (mantém o ícone do Dock)
cd "/Users/erikestecidias/Claude/painel-midia-paga" || exit 1
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
echo "Empacotando..."; npm run build:mac >/tmp/painel-build.log 2>&1
APP=$(ls -d dist/mac-arm64/*.app 2>/dev/null | head -1)
[ -z "$APP" ] && { echo "Erro no build (veja /tmp/painel-build.log)"; exit 1; }
codesign --force --deep --sign - "$APP" >/dev/null 2>&1
osascript -e 'quit app "Painel Midia Paga"' 2>/dev/null; sleep 1
rm -rf "/Applications/Painel Midia Paga.app"; cp -R "$APP" /Applications/
open "/Applications/Painel Midia Paga.app"
echo "✅ Atualizado e aberto."

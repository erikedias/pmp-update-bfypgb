#!/bin/bash
# Publica uma atualização: sobe o código novo pro GitHub e os usuários puxam pela aba de atualização.
cd "/Users/erikestecidias/Claude/painel-midia-paga" || exit 1
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

NOTES=$(osascript -e 'text returned of (display dialog "O que mudou nesta atualização? (aparece para o usuário)" default answer "Melhorias e correções" with title "Publicar atualização")' 2>/dev/null)
[ -z "$NOTES" ] && { echo "cancelado"; exit 0; }

# incrementa a versão (1.0.0 -> 1.0.1) e gera o manifesto
node -e "const fs=require('fs');const p=require('./package.json');const v=p.version.split('.').map(Number);v[2]++;p.version=v.join('.');fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');"
node scripts/gen-update.js "$NOTES"
V=$(node -e "console.log(require('./package.json').version)")

git add -A && git commit -m "v$V — $NOTES" && git push
if [ $? -eq 0 ]; then
  osascript -e "display notification \"v$V publicada — usuários já podem atualizar\" with title \"Painel de Mídia Paga\"" 2>/dev/null
  echo "✅ v$V publicada com sucesso."
else
  echo "❌ Falhou ao publicar. Veja o erro acima (talvez precise reconectar o GitHub)."
fi
echo "(pode fechar esta janela)"

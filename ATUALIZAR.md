# 🔄 Como as atualizações chegam nos usuários

O app se **atualiza sozinho**. Toda vez que um usuário abre o app, ele checa o
**repositório no GitHub** (`erikedias/pmp-update-bfypgb`); se tiver versão nova, baixa
só os arquivos que mudaram, mostra a telinha *"Atualizando o app…"* e reinicia. O usuário
não precisa fazer nada — instala uma vez e recebe tudo automaticamente.

> Se por acaso não atualizar sozinho (internet lenta), dá pra forçar em
> ⚙️ Configurações → **Verificar atualização**.

⚠️ **Exceção:** um app instalado de um instalador ANTIGO (anterior à v1.3.21) ainda não
tem o auto-update na abertura. Nesse caso, o usuário precisa clicar **uma vez** em
"Verificar atualização"; a partir daí passa a ser automático. Por isso vale distribuir o
instalador mais novo (veja `Instaladores/`).

## Para PUBLICAR uma atualização (o que a Erik/Claude faz)

Fluxo pela linha de comando (é o que o Claude roda):

```bash
cd painel-midia-paga
# 1) sobe o número da versão (patch) no package.json
node -e "const fs=require('fs');const p=require('./package.json');const v=p.version.split('.').map(Number);v[2]++;p.version=v.join('.');fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');console.log(p.version)"
# 2) gera o manifesto (varre src/ + electron/ + package.json; arquivos novos entram sozinhos)
node scripts/gen-update.js "nota curta do que mudou"
# 3) commit + push pro GitHub
git add -A && git commit -m "vX.Y.Z — descrição" && git push origin main
```

Pelo Claude é só pedir: *"publica a atualização"*. Pronto — na próxima vez que cada
usuário abrir o app, ele já pega.

## Detalhes

- A versão instalada fica guardada localmente; quando o `update.json` do GitHub tiver
  versão maior, o app baixa e aplica.
- `asar: false` no build → os arquivos do app ficam soltos e podem ser sobrescritos pelo
  auto-update (por isso funciona no app instalado, não só no modo dev).
- O patch cobre `src/` + `electron/` + `package.json`. Se mexer no **Funil Studio**
  (`src/funil-studio/`, que é compilado à parte), aí sim é melhor gerar um instalador novo.
- O app é instalado na área do usuário → o auto-update não precisa de senha de administrador.

## Gerar instaladores novos (quando precisar)

Só é necessário de vez em quando (ex.: pra quem instala do zero já pegar a versão atual):

```bash
npm run dist        # gera .dmg (Mac) + .exe (Windows) na pasta dist/
```

Depois, copie os arquivos gerados para `Instaladores/Mac/` e `Instaladores/Windows/`
(renomeando para "Painel de Midia Paga - Instalador Mac.dmg" e
"Painel de Midia Paga - Instalador Windows.exe").

## Resumo do dia a dia
> Mudou algo → **"publica a atualização"** (bump + gen-update.js + push) → todo mundo
> pega sozinho ao abrir. ✅

# 🔄 Como publicar uma atualização (patch) pros usuários

O app tem um botão **"Verificar atualização"** (⚙️ Configurações) que baixa só os arquivos
de código que mudaram, do seu **repositório no GitHub**, e reinicia — sem reinstalar o app de 90MB.

## Configuração única (uma vez)

1. Crie um repositório no **GitHub** (pode ser privado? NÃO — precisa ser **público** pra os apps baixarem os arquivos "raw"). Ex.: `painel-midia-paga`.
2. Suba TODO o projeto pra esse repositório (a pasta com `electron/`, `src/`, `update.json` etc.).
3. Pegue o link "raw" base do repo. Formato:
   ```
   https://raw.githubusercontent.com/SEU-USUARIO/SEU-REPO/main
   ```
   (troque `main` por `master` se for o nome do seu branch)
4. **Esse link você cola em cada app** (⚙️ Configurações → "Link de atualização") OU me passa que eu já deixo embutido por padrão pra todos.

## Pra publicar uma atualização (toda vez que mudar algo relevante)

1. Faça a mudança no código (você mesma ou pelo Claude).
2. Abra o **`update.json`** e:
   - **suba o número da versão** (ex.: `0.1.0` → `0.1.1`)
   - escreva uma nota curta em `notes` (ex.: "corrigido erro X, novo botão Y")
   - se mudou algum arquivo que **não** está na lista `files`, adicione o caminho dele
3. Suba (commit + push) pro GitHub. Pelo Claude é só pedir: *"faz commit e push das mudanças"*.
4. Pronto. Cada usuário, ao clicar em **"Verificar atualização"**, vê a nova versão e atualiza num clique.

## Detalhes
- A versão "atual" de cada app é guardada localmente; quando o `update.json` tiver versão maior, aparece o botão de atualizar.
- O patch cobre os arquivos do **painel** (o grosso das mudanças). Se você mexer no **Funil Studio** (pasta `src/funil-studio/`, que é compilada), aí é melhor distribuir o instalador novo — mudanças nele são raras.
- Os arquivos são baixados do seu repo e gravados na pasta do app. Como o app é instalado na área do usuário, não precisa de senha de administrador.

## Resumo do dia a dia
> Mudou algo → bump no `update.json` → push no GitHub → todo mundo clica "Verificar atualização". ✅

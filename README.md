# Painel de Mídia Paga

App de desktop (Mac e Windows) pra rotina de mídia paga: análise semanal de gargalos,
relatórios, subida de campanhas (Meta/Google), negativação de termos de busca, trackeamento (GTM),
Funil Studio (mapa mental) e mais. **Tudo roda local** — suas chaves ficam só na sua máquina.

➡️ **Primeira vez? Leia o [CONFIGURACAO.md](CONFIGURACAO.md)** — o passo a passo de cada integração.

---

## 📥 Instalar (usar o app)

### Mac
1. Abra o **`.dmg`** (pasta `Instaladores/`) e arraste o app pra **Aplicações**
2. **1ª vez — IMPORTANTE:** NÃO dê dois cliques. Clique com o **botão direito (ou Control+clique) no app → Abrir** → na janela, **Abrir** de novo.
3. Se aparecer **"está danificado / mover para o Lixo"** (Macs mais novos bloqueiam apps sem assinatura paga da Apple), faça uma vez:
   - Abra o **Terminal** (Spotlight → "Terminal") e cole:
     ```
     xattr -cr "/Applications/Painel Midia Paga.app"
     ```
   - Aperte Enter e abra o app normalmente. Isso só precisa ser feito **uma vez**.

> O app é seguro — esse aviso é só porque ele não tem o certificado pago da Apple ($99/ano). O comando acima apenas tira a "quarentena" que o macOS coloca em downloads.

### Windows
1. Rode o instalador **`Painel de Mídia Paga Setup.exe`**
2. Avance a instalação → abra pelo atalho
3. Se o Windows Defender avisar (app sem assinatura): **Mais informações → Executar assim mesmo**

Depois de abrir, vá em **⚙️ Configurações** e siga o [CONFIGURACAO.md](CONFIGURACAO.md).

---

## ✏️ Editar o app pelo seu próprio Claude

O app é seu — dá pra pedir mudanças pro **Claude Code** na sua máquina.

1. Instale o **Node.js** (nodejs.org, versão LTS) e o **Claude Code** (claude.ai/code)
2. Abra um terminal **nesta pasta** e rode: `claude`
3. Peça em português. Exemplos:
   - *"adiciona um botão pra exportar a análise em PDF"*
   - *"cria uma aba nova de anotações por cliente"*
   - *"muda o tema pra azul"*
4. Pra ver rodando / gerar o instalável de novo:
   - **Modo dev:** `npm install` (1ª vez) e `npm start`
   - **Gerar instalável:** `npm run build:mac` (Mac) ou `npm run build:win` (Windows)

> Dica: peça *"leia o CONFIGURACAO.md e o electron/main.cjs antes de mexer"* pra ele pegar contexto.

### Estrutura (pro Claude se achar)
- `electron/main.cjs` — processo principal: TODAS as integrações (Reportei, Trello, Gemini, Meta, Google Ads, GA4, GTM, PageSpeed, leads)
- `electron/preload.cjs` — ponte segura entre interface e o main
- `src/index.html` — interface (as abas)
- `src/app.js` — lógica da interface
- `src/engine.js` — motor de gargalos + benchmarks
- `src/styles.css` — estilo
- `src/funil-studio/` — o Funil Studio (mapa mental) já compilado e embutido

---

## 🛠️ Comandos
| Comando | O que faz |
|---|---|
| `npm install` | instala dependências (1ª vez) |
| `npm start` | roda em modo dev |
| `npm run build:mac` | gera o `.dmg` (Mac) |
| `npm run build:win` | gera o `Setup.exe` (Windows) |

> Cada pessoa usa as **próprias chaves** de API (ver CONFIGURACAO.md). Ficam em `store.json`, na pasta de dados do app, só na máquina dela.

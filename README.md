# Painel de Mídia Paga

App de desktop (Mac e Windows) pra rotina de mídia paga: análise semanal de gargalos,
relatórios, subida de campanhas (Meta/Google), negativação de termos de busca, trackeamento (GTM),
Funil Studio (mapa mental) e mais. **Tudo roda local** — suas chaves ficam só na sua máquina.

➡️ **Primeira vez? Leia o [CONFIGURACAO.md](CONFIGURACAO.md)** — o passo a passo de cada integração.

---

## 📥 Instalar (usar o app)

**Baixe o instalador do seu sistema** (sempre a versão mais nova):
👉 https://github.com/erikedias/pmp-update-bfypgb/releases/latest

- **Mac (Apple Silicon):** o arquivo `.dmg`
- **Windows:** o arquivo `.exe`

O passo a passo completo (com telas) está na pasta **`Instaladores/`**, separado por sistema:
- `Instaladores/Windows/` — instalar e desinstalar
- `Instaladores/Mac/` — instalar, **autorizar no Mac** (o Mac pede uma liberação na 1ª vez) e desinstalar

### Resumo rápido

**Mac:** abra o `.dmg`, arraste o app pra Aplicações. Na 1ª vez, botão direito → **Abrir**. Se disser "está danificado", rode uma vez no Terminal:
```
xattr -cr "/Applications/Painel Midia Paga.app"
```

**Windows:** rode o `.exe`. Se o Defender avisar: **Mais informações → Executar assim mesmo**.

> 🔄 **Instala uma vez só.** Depois disso o app **se atualiza sozinho ao abrir** — toda mudança que a Erik publica chega automaticamente. (Se algum dia não atualizar sozinho: ⚙️ Configurações → "Verificar atualização".)

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

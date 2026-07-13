# 🚀 Painel de Mídia Paga — Guia de Configuração

Bem-vinda(o)! Este app centraliza a rotina de mídia paga: análise semanal de gargalos,
relatórios, subida de campanhas (Meta e Google), negativação de termos, trackeamento (GTM)
e mais. **Tudo roda no seu computador** — suas chaves ficam guardadas só na sua máquina
(num arquivo `store.json`), nada é enviado pra servidores de terceiros.

> Você **não precisa configurar tudo de uma vez**. Configure o que for usar. A tabela abaixo
> mostra o que é essencial pra começar e o que é avançado.

---

## 📋 Visão geral — o que cada coisa faz

| Integração | Pra que serve | Essencial? |
|---|---|---|
| **Gemini** (IA) | Gera as análises, relatórios e o trackeamento guiado | ✅ Sim |
| **Reportei** | Puxa os dados das campanhas (a base da análise da semana) | ✅ Sim |
| **Trello** | Envia otimizações e o que foi feito pro board do cliente | 🔸 Recomendado |
| **Google Sheets** | Lê a planilha de leads (qualificação MQL/SQL) | 🔸 Opcional |
| **Meta (token)** | Subir campanhas/criativos no Meta + dados diretos da conta | 🔹 Avançado |
| **Google Ads (OAuth)** | Subir campanhas, negativar termos, dados diretos da conta | 🔹 Avançado |
| **GA4** | Taxa de Conexão (sessões ÷ cliques) na análise | 🔹 Avançado |
| **PageSpeed** | Velocidade do site como gargalo | 🔹 Avançado |
| **Google Tag Manager** | Criar trackeamento (tags/eventos) por cliente | 🔹 Avançado |

Onde colar tudo: dentro do app, aba **⚙️ Configurações**.

---

## 1. ✅ Gemini (IA) — comece por aqui

É o cérebro das análises e dos textos.

1. Acesse **https://aistudio.google.com/app/apikey** (Google AI Studio)
2. Clique em **"Get API key" → Criar chave de API**
3. Copie a chave
4. No app: **⚙️ Configurações → Gemini — API Key** → cole
5. Modelo: deixe `gemini-2.5-flash` (gratuito e rápido)

> A chave do AI Studio tem uso **gratuito** generoso. Modelos "pro" exigem plano pago — o app usa flash por padrão.

---

## 2. ✅ Reportei — dados das campanhas

É de onde vêm os números da análise da semana.

1. Entre no **Reportei** (app.reportei.com) → **Configurações → API**
2. Gere/copie o **token** (Bearer)
3. No app: **⚙️ Configurações → Token do Reportei** → cole → **Salvar chaves**
4. Ainda em Configurações, vá em **Meus clientes (projetos)** → busque o nome do cliente → adicione
   - Cada cliente do painel é um **projeto do Reportei**

---

## 3. 🔸 Trello — enviar otimizações pro board

1. Acesse **https://trello.com/app-key** → copie a **API Key**
2. Na mesma página, clique em **"Token"** (gerar) → autorize → copie o **Token**
3. No app: **⚙️ Configurações → Trello API Key** e **Trello Token** → Salvar
4. No cliente, vincule o **board do Trello** (o app procura pelo nome)
   - O board precisa ter as listas **"Demandas da Semana"** e **"O que foi feito na semana"**

---

## 4. 🔸 Google Sheets — planilha de leads (MQL/SQL)

Pra ler quantos leads viraram MQL/SQL (qualificação) da sua planilha.

1. No **Google Cloud Console** (console.cloud.google.com) → crie/escolha um projeto
2. **APIs e serviços → Biblioteca** → ative **"Google Sheets API"**
3. **APIs e serviços → Credenciais → Criar credenciais → Chave de API** → copie
4. No app: **⚙️ Configurações → Google Sheets API Key** → cole
5. No cliente, configure o link da planilha de leads (botão de leads)
6. A planilha precisa estar **compartilhada como "qualquer pessoa com o link pode ver"**

---

## 5. 🔹 Meta — subir campanhas e puxar dados da conta

Pra criar campanhas/criativos no Meta e puxar dados direto da conta de anúncio.

### 5.1 Criar o app de desenvolvedor (uma vez)
1. **developers.facebook.com** → **Meus Apps → Criar app** → tipo **"Empresa"**
2. Adicione o produto **"Marketing API"**

### 5.2 Gerar o token
1. No app de dev → **Ferramentas → Explorador da Graph API**
2. Selecione seu app e gere um **token de usuário** com as permissões:
   - `ads_management`, `ads_read`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`, `business_management`
3. **Estenda pra longa duração**: Ferramentas → **Depurador de Token** → "Estender token de acesso"
4. No app: **⚙️ Configurações → Meta — Token de acesso** → cole → **testar conexão** e **verificar permissões**

### 5.3 Por cliente
- No cliente, botão **"contas"** → vincule a **conta de anúncio** (`act_...`), a **Página**, e o **beneficiário/pagador** (obrigatório p/ Brasil)

> ⚠️ Pra rodar nas contas de **clientes** (não só nas suas), o app do Meta precisa de **Acesso Avançado** (App Review). Pras suas próprias contas/páginas, o modo de desenvolvimento já funciona.

---

## 6. 🔹 Google Ads + GA4 + Tag Manager — conexão única (OAuth)

Uma única conexão Google libera **Google Ads, Analytics (GA4) e Tag Manager**.

### 6.1 Criar o OAuth Client (Google Cloud, ~5 min)
1. **console.cloud.google.com** → crie um projeto
2. **APIs e serviços → Biblioteca** → ative: **Google Ads API**, **Google Analytics Data API**, **Tag Manager API**, **PageSpeed Insights API**
3. **Tela de consentimento OAuth** → tipo **Externo** → preencha nome/email → em "Usuários de teste" adicione **seu próprio email**
4. **Credenciais → Criar credenciais → ID do cliente OAuth** → tipo **"App para computador"** → copie **Client ID** e **Client Secret**

### 6.2 Developer Token do Google Ads
1. No **Google Ads**, na sua conta **MCC** → **Ferramentas → Central de API** → copie o **Developer Token**
2. (Ele precisa ter **Acesso Básico** aprovado pra funcionar em contas reais — se estiver "Teste", peça o Básico ao Google)

### 6.3 Conectar no app
1. **⚙️ Configurações → card Subida** → cole **Client ID + Client Secret + Developer Token + MCC**
2. Clique em **"🔗 Conectar com Google"** → autorize no navegador (pode aparecer "app não verificado" → Avançado → Acessar)
3. Clique em **"testar conexão"** → deve listar suas contas

### 6.4 PageSpeed (opcional)
- **Credenciais → Chave de API** (a mesma da Sheets serve, se ativar a PageSpeed API nela) → cole em **PageSpeed — API Key**

### 6.5 Por cliente
- Botão **"contas"** → vincule **Customer ID do Google** (botão "buscar contas"), **GA4 Property ID** (número, ex. 312345678) e o **Site** (pra PageSpeed)

---

## 7. 🔹 Google Tag Manager — trackeamento

Já liberado pela conexão do passo 6. Na aba **🏷️ Tag Manager**:
1. Escolha o **cliente** + **Carregar containers** → selecione o container
2. Preencha GA4 Measurement ID (G-XXXX) + ID/rótulo de conversão do Ads → **Salvar config deste cliente** (faz 1x)
3. Use o **Trackeamento guiado**: cole a URL + descreva o que trackear (+ print do botão) → o app cria no **workspace** do GTM (você revisa e publica lá)

---

## ✅ Pra só começar a usar (mínimo)
1. **Gemini** (passo 1)
2. **Reportei** + adicionar clientes (passo 2)
3. (recomendado) **Trello** (passo 3)

Com isso você já faz a **análise da semana**. O resto (Meta/Google/GA4/GTM) você liga quando precisar.

---

## ❓ Dúvidas comuns
- **"Onde ficam minhas chaves?"** Num arquivo local no seu computador (não saem da máquina).
- **"Preciso pagar algo?"** Gemini e as APIs do Google têm uso gratuito. Reportei/Trello dependem do seu plano neles.
- **"Reconectar o Google"**: se aparecer erro de permissão (GA4/GTM), clique em **Conectar com Google** de novo — às vezes uma permissão nova precisa ser reautorizada.

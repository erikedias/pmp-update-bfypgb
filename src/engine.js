/* ============================================================
   engine.js — o "cérebro" do painel (puro, sem DOM)
   Calcula taxas com a fórmula (métrica × 100) ÷ base,
   detecta o gargalo (1ª taxa abaixo do benchmark no funil)
   e mapeia gargalo → hipótese + otimização (playbook).
   Usado tanto no renderer quanto referência p/ o main.
   ============================================================ */
(function (root) {
  "use strict";

  // ---- fórmula percentual (jeito Obsidian dela): (parte × 100) ÷ base ----
  // Retorna null quando não dá pra calcular (dado ausente) → vira "—", não 0%.
  const pct = (parte, base) => (parte == null || base == null || base === 0) ? null : (parte * 100) / base;

  // ---- formatadores ----
  const fmt = {
    n: (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR")),
    brl: (v) => (v == null ? "—" : "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
    pct: (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%"),
  };

  // ---- playbook: gargalo → hipótese + otimização (extraído da planilha/automação) ----
  const PLAYBOOK = {
    "linkedin:Taxa de abertura": { hip: "Assunto/abertura fraca ou público saturado", otim: "Testar novos assuntos e refinar segmentação" },
    "linkedin:Taxa de cliques": { hip: "Público desalinhado ou oferta pouco atrativa", otim: "Checar dados demográficos; ajustar copy/oferta" },
    "linkedin:Taxa de preenchimento": { hip: "Formulário com atrito / desalinhado à oferta", otim: "Revisar o formulário (menos campos, alinhar à copy)" },
    "google:CTR": { hip: "Anúncio pouco relevante para a busca", otim: "Revisar headlines e palavras-chave" },
    "google:Taxa de conversão": { hip: "Página de destino / oferta não converte", otim: "Revisar a página de destino e a correspondência anúncio↔LP" },
    "meta:CTR": { hip: "Criativo com fadiga / público saturado", otim: "Ativar novos criativos" },
    "meta:Taxa de preenchimento": { hip: "Formulário ou LP com atrito", otim: "Revisar formulário e oferta" },
  };

  // ---- definição de cada plataforma: funil (ordem + benchmark) e como derivar as taxas ----
  // metrics: chaves esperadas no objeto normalizado de cada linha (vindo do Reportei)
  const PLATFORMS = {
    linkedin: {
      key: "linkedin",
      label: "LinkedIn Ads",
      tag: "Conversation Ads",
      short: "LinkedIn",
      slug: "linkedin_ads",
      cols: ["Envios", "Aberturas", "Taxa Abertura", "Cliques", "Taxa de Cliques", "Taxa Preench.", "Leads", "CPL", "MQL", "SQL"],
      funnel: [
        { name: "Taxa de abertura", bench: 50 },
        { name: "Taxa de cliques", bench: 1.5 },
        { name: "Taxa de preenchimento", bench: 40 },
      ],
      derive(m, bench) {
        const b = (n, d) => (bench && bench[n] != null ? bench[n] : d);
        const TA = pct(m.opens, m.sends);
        const TC = pct(m.clicks, m.opens);
        const TP = pct(m.leads, m.clicks);
        return {
          cells: [
            { v: fmt.n(m.sends) }, { v: fmt.n(m.opens) }, { rate: TA, bench: b("Taxa de abertura", 50) },
            { v: fmt.n(m.clicks) }, { rate: TC, bench: b("Taxa de cliques", 1.5) }, { rate: TP, bench: b("Taxa de preenchimento", 40) },
            { v: fmt.n(m.leads) }, { v: fmt.brl(m.cpl) }, { v: "—" }, { v: "—" },
          ],
          rates: { "Taxa de abertura": TA, "Taxa de cliques": TC, "Taxa de preenchimento": TP },
        };
      },
    },
    google: {
      key: "google",
      label: "Google Ads",
      tag: "Rede de Pesquisa",
      short: "Google",
      slug: "google_adwords",
      cols: ["Impressões", "Cliques", "CTR", "Conversões", "Taxa Conversão", "CPC", "Custo Total", "CPL", "MQL", "SQL"],
      funnel: [
        { name: "CTR", bench: 5 },
        { name: "Taxa de conversão", bench: 10 },
      ],
      derive(m, bench) {
        const b = (n, d) => (bench && bench[n] != null ? bench[n] : d);
        const CTR = m.ctr != null ? m.ctr : pct(m.clicks, m.impressions);
        const TConv = pct(m.conversions, m.clicks);
        return {
          cells: [
            { v: fmt.n(m.impressions) }, { v: fmt.n(m.clicks) }, { rate: CTR, bench: b("CTR", 5) },
            { v: fmt.n(m.conversions) }, { rate: TConv, bench: b("Taxa de conversão", 10) }, { v: fmt.brl(m.cpc) },
            { v: fmt.brl(m.cost) }, { v: fmt.brl(m.conversions ? m.cost / m.conversions : null) }, { v: "—" }, { v: "—" },
          ],
          rates: { CTR: CTR, "Taxa de conversão": TConv },
        };
      },
    },
    meta: {
      key: "meta",
      label: "Meta Ads",
      tag: "Captação de Leads",
      short: "Meta",
      slug: "facebook_ads",
      cols: ["Impressões", "Alcance", "Cliques", "CTR", "Leads", "Taxa Preench.", "CPL", "Investido"],
      funnel: [
        { name: "CTR", bench: 1 },
        { name: "Taxa de preenchimento", bench: 30 },
      ],
      derive(m, bench) {
        const b = (n, d) => (bench && bench[n] != null ? bench[n] : d);
        const CTR = m.ctr != null ? m.ctr : pct(m.clicks, m.impressions);
        const TP = pct(m.leads, m.clicks);
        return {
          cells: [
            { v: fmt.n(m.impressions) }, { v: fmt.n(m.reach) }, { v: fmt.n(m.clicks) },
            { rate: CTR, bench: b("CTR", 1) }, { v: fmt.n(m.leads) }, { rate: TP, bench: b("Taxa de preenchimento", 30) },
            { v: fmt.brl(m.cpl) }, { v: fmt.brl(m.spend) },
          ],
          rates: { CTR: CTR, "Taxa de preenchimento": TP },
        };
      },
    },
  };

  // ---- detecta o gargalo: 1ª taxa do funil abaixo do benchmark ----
  function findGargalo(platformKey, rates, bench) {
    const plat = PLATFORMS[platformKey];
    for (const step of plat.funnel) {
      const v = rates[step.name];
      const limit = (bench && bench[step.name] != null) ? bench[step.name] : step.bench;
      if (v != null && v < limit) return step.name;
    }
    return null;
  }

  function playbookFor(platformKey, gargalo) {
    return PLAYBOOK[`${platformKey}:${gargalo}`] || { hip: "—", otim: "—" };
  }

  // ---- monta os itens do checklist "Otimizações" no formato exato da automação:
  //      [Plataforma] Campanha: <ação> (gargalo: <X>) ----
  function buildChecklistItems(platformResults) {
    const items = [];
    platformResults.forEach((pr) => {
      const plat = PLATFORMS[pr.platform];
      pr.rows.forEach((row) => {
        if (row.level !== "campaign") return;
        const { rates } = plat.derive(row.metrics);
        const garg = findGargalo(pr.platform, rates);
        if (!garg) return;
        const pb = playbookFor(pr.platform, garg);
        const otim = row.otimOverride || pb.otim;
        items.push({
          platform: pr.platform,
          short: plat.short,
          text: `[${plat.short}] ${row.name}: ${otim} (gargalo: ${garg})`,
        });
      });
    });
    return items;
  }

  const api = { pct, fmt, PLAYBOOK, PLATFORMS, findGargalo, playbookFor, buildChecklistItems };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== "undefined" ? window : globalThis);

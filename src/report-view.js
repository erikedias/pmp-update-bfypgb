/* =========================================================================
   report-view.js — renderiza o relatório no estilo Reportei (layout claro,
   pronto pra PDF). Gráficos em SVG (vetorial → nítido no printToPDF).

   Consome um "contrato" de dados por plataforma (ver PUKET no fim do arquivo,
   que é o fixture com os números reais do PDF do Puket/maio). A Fase A do
   backend vai preencher esse mesmo contrato com dado ao vivo (Meta/Google via
   API própria, LinkedIn via Reportei).
   ========================================================================= */
(function (root) {
  "use strict";

  /* ---------- formatação (igual ao PDF: milhar com vírgula, decimal com ponto) ---------- */
  const nf = (v, d = 0) => (v == null || isNaN(v)) ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtInt = (v) => nf(v, 0);
  const fmtBRL = (v) => (v == null || isNaN(v)) ? "—" : "R$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const trimPct = (v) => (v == null || isNaN(v)) ? "—" : (parseFloat(Number(v).toFixed(2)) + "%");
  const fmtNum2 = (v) => (v == null || isNaN(v)) ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const fmtBy = { int: fmtInt, brl: fmtBRL, pct: trimPct, num2: fmtNum2, raw: (v) => esc(v) };

  // delta % vs período anterior — cor SÓ pelo sinal (igual ao Reportei: sobe=verde, cai=vermelho)
  function deltaHTML(cur, prev) {
    if (prev == null || prev === 0 || cur == null) return "";
    const d = (cur - prev) / prev * 100;
    const v = parseFloat(d.toFixed(2));
    const cls = Math.abs(v) < 0.005 ? "flat" : v > 0 ? "up" : "down";
    const arrow = cls === "up" ? "▲" : cls === "down" ? "▼" : "";
    return `<span class="rr-delta ${cls}">${arrow ? arrow + " " : ""}${v > 0 ? "+" : ""}${v}%</span>`;
  }
  const q = () => `<span class="k-q">?</span>`;

  /* ---------- logos ---------- */
  const LOGO = {
    meta: `<svg viewBox="0 0 40 40" fill="none"><path d="M13 11c-3.4 0-5.7 3.4-7.2 7.1C4.6 21 4 23.5 4 25.4 4 28.5 5.6 30 7.7 30c1.9 0 3.3-1.1 5.2-4.3.6-1 1.3-2.2 2-3.5.8 1.4 1.6 3 2.4 4.4C19 28.9 20.4 30 22.4 30c3.4 0 6.2-3.9 8.3-7.9C33 17.8 34 14.5 34 12c0-2.8-1.5-5-4.1-5-1.9 0-3.5 1.2-5.2 3.6-1.4 1.9-2.7 4.2-3.9 6.3-1.2-2-2.5-4.2-3.9-6C15.9 12 14.6 11 13 11z" fill="#0866FF"/></svg>`,
    google: `<svg viewBox="0 0 40 40" fill="none"><rect x="16" y="6" width="8" height="20" rx="4" fill="#FBBC04"/><rect x="6" y="20" width="20" height="8" rx="4" transform="rotate(-60 16 24)" fill="#4285F4"/><rect x="14" y="20" width="20" height="8" rx="4" transform="rotate(60 24 24)" fill="#34A853"/><circle cx="9.5" cy="30.5" r="4.2" fill="#4285F4"/></svg>`,
    linkedin: `<svg viewBox="0 0 40 40" fill="none"><rect x="5" y="5" width="30" height="30" rx="5" fill="#0A66C2"/><path fill="#fff" d="M12.6 16.4h3.4V27h-3.4V16.4zm1.7-5.2a2 2 0 110 4 2 2 0 010-4zM18.4 16.4h3.2v1.5h.05c.45-.8 1.55-1.7 3.2-1.7 3.4 0 4.05 2.1 4.05 4.9V27h-3.4v-4.9c0-1.2 0-2.7-1.7-2.7-1.7 0-1.95 1.3-1.95 2.6V27h-3.4V16.4z"/></svg>`,
  };

  /* ================================ SVG CHARTS ================================ */
  function niceMax(v) {
    if (!v || v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    const m = n <= 1 ? 1 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 3 ? 3 : n <= 5 ? 5 : 10;
    return m * p;
  }
  const axisLabel = (v) => v >= 1000 ? (v % 1000 === 0 ? (v / 1000) + "." + "000".slice(0, 3) : v.toLocaleString("en-US")) : (Number.isInteger(v) ? v : parseFloat(v.toFixed(1)));

  // funil: trapézios empilhados, gradiente claro→escuro
  function funnelSVG(steps) {
    const W = 560, segH = 60, gap = 5, cx = W / 2;
    const H = steps.length * segH + (steps.length - 1) * gap;
    const topFrac = 1, botFrac = 0.40;
    const frac = (k) => topFrac - (topFrac - botFrac) * (k / steps.length);
    const c1 = [231, 239, 253], c2 = [11, 60, 147];
    const col = (t) => `rgb(${c1.map((a, i) => Math.round(a + (c2[i] - a) * t)).join(",")})`;
    let y = 0; const parts = [];
    steps.forEach((s, i) => {
      const t = steps.length === 1 ? 0 : i / (steps.length - 1);
      const wt = W * frac(i), wb = W * frac(i + 1);
      const fill = col(t), dark = t > 0.30, tc = dark ? "#fff" : "#1f2937";
      parts.push(`<path d="M${cx - wt / 2},${y} L${cx + wt / 2},${y} L${cx + wb / 2},${y + segH} L${cx - wb / 2},${y + segH} Z" fill="${fill}"/>`);
      const arr = s.dir === "up" ? `<tspan fill="#16a34a"> ▲</tspan>` : s.dir === "down" ? `<tspan fill="#e5484d"> ▼</tspan>` : "";
      parts.push(`<text x="${cx}" y="${y + segH / 2 - 3}" text-anchor="middle" font-size="12" font-weight="700" fill="${tc}">${esc(s.label)}</text>`);
      parts.push(`<text x="${cx}" y="${y + segH / 2 + 14}" text-anchor="middle" font-size="13" font-weight="800" fill="${tc}">${esc(s.value)}${arr}</text>`);
      y += segH + gap;
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" style="max-width:100%">${parts.join("")}</svg>`;
  }

  // linha de dois eixos (CTR verde à esquerda, Cliques azul à direita)
  function lineSVG(labels, sA, sB) {
    const W = 560, H = 240, ml = 36, mr = 40, mt = 12, mb = 56, iw = W - ml - mr, ih = H - mt - mb;
    const n = labels.length, maxA = niceMax(Math.max(...sA, 0.1)), maxB = niceMax(Math.max(...sB, 1));
    const X = (i) => ml + (n <= 1 ? iw / 2 : iw * i / (n - 1));
    const YA = (v) => mt + ih - (v / maxA) * ih, YB = (v) => mt + ih - (v / maxB) * ih;
    const g = [];
    for (let k = 0; k <= 3; k++) {
      const yy = mt + ih * k / 3;
      g.push(`<line x1="${ml}" y1="${yy}" x2="${ml + iw}" y2="${yy}" stroke="#eef1f5" stroke-width="1"/>`);
      g.push(`<text x="${ml - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="#9aa4b2">${axisLabel(maxA * (3 - k) / 3)}</text>`);
      g.push(`<text x="${ml + iw + 6}" y="${yy + 4}" text-anchor="start" font-size="10" fill="#9aa4b2">${axisLabel(maxB * (3 - k) / 3)}</text>`);
    }
    const step = Math.ceil(n / 15);
    for (let i = 0; i < n; i += step) g.push(`<text x="${X(i)}" y="${mt + ih + 14}" text-anchor="end" font-size="9" fill="#9aa4b2" transform="rotate(-40 ${X(i)} ${mt + ih + 14})">${esc(labels[i])}</text>`);
    const path = (s, Y, color) => `<polyline points="${s.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" style="max-width:100%">${g.join("")}${path(sB, YB, "#2563eb")}${path(sA, YA, "#22c55e")}</svg>`;
  }

  // barras agrupadas (impressões verde + alcance azul)
  function barsSVG(labels, sImp, sReach) {
    const W = 560, H = 240, ml = 50, mr = 8, mt = 12, mb = 54, iw = W - ml - mr, ih = H - mt - mb;
    const n = labels.length, max = niceMax(Math.max(...sImp, ...sReach, 1));
    const Y = (v) => mt + ih - (v / max) * ih;
    const gw = iw / n, bw = Math.min(22, gw * 0.28);
    const g = [];
    for (let k = 0; k <= 4; k++) { const yy = mt + ih * k / 4; g.push(`<line x1="${ml}" y1="${yy}" x2="${ml + iw}" y2="${yy}" stroke="#eef1f5"/>`); g.push(`<text x="${ml - 8}" y="${yy + 4}" text-anchor="end" font-size="10" fill="#9aa4b2">${axisLabel(max * (4 - k) / 4)}</text>`); }
    labels.forEach((lb, i) => {
      const cx = ml + gw * i + gw / 2;
      const h1 = (sImp[i] / max) * ih, h2 = (sReach[i] / max) * ih;
      g.push(`<rect x="${cx - bw - 2}" y="${Y(sImp[i])}" width="${bw}" height="${Math.max(0, h1)}" rx="2" fill="#22c55e"/>`);
      g.push(`<rect x="${cx + 2}" y="${Y(sReach[i])}" width="${bw}" height="${Math.max(0, h2)}" rx="2" fill="#2563eb"/>`);
      g.push(`<text x="${cx}" y="${mt + ih + 16}" text-anchor="middle" font-size="10" fill="#6b7280">${esc(lb)}</text>`);
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" style="max-width:100%">${g.join("")}</svg>`;
  }

  // pizza (alcance por dispositivo)
  function pieSVG(slices) {
    const size = 190, r = 82, cx = size / 2, cy = size / 2;
    const total = slices.reduce((a, s) => a + s.value, 0) || 1;
    let ang = -Math.PI / 2; const parts = [];
    slices.forEach((s) => {
      const frac = s.value / total, a2 = ang + frac * Math.PI * 2;
      const large = frac > 0.5 ? 1 : 0;
      const x1 = cx + r * Math.cos(ang), y1 = cy + r * Math.sin(ang);
      const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
      if (frac >= 0.999) parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${s.color}"/>`);
      else parts.push(`<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${s.color}"/>`);
      if (frac >= 0.0004) {
        const mid = ang + frac * Math.PI, lr = frac > 0.85 ? r * 0.5 : r * 1.16;
        const lx = cx + lr * Math.cos(mid), ly = cy + lr * Math.sin(mid);
        parts.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="${frac > 0.85 ? "#fff" : "#374151"}">${(frac * 100).toFixed(2)}%</text>`);
      }
      ang = a2;
    });
    return `<svg class="rr-pie" viewBox="0 0 ${size} ${size}" width="${size}">${parts.join("")}</svg>`;
  }

  const legend = (items) => `<div class="rr-legend">${items.map((i) => `<span><i style="background:${i.c}"></i>${esc(i.t)}</span>`).join("")}</div>`;

  /* ================================ BLOCOS ================================ */
  function kpiCell(k) {
    const fmt = fmtBy[k.kind] || fmtBy.raw;
    return `<div class="rr-kpi${k.big ? " big" : ""}">
      <div class="k-lbl">${esc(k.label)} ${q()}</div>
      <div class="k-row"><span class="k-val">${fmt(k.value)}</span>${deltaHTML(k.value, k.prev)}</div>
      ${k.prev != null ? `<div class="k-prev"><b>${fmt(k.prev)}</b> no período anterior</div>` : ""}
    </div>`;
  }
  function kpiGrid(kpis) {
    const main = kpis.filter((k) => !k.big), big = kpis.filter((k) => k.big);
    let html = `<div class="rr-kpis">${main.map(kpiCell).join("")}</div>`;
    if (big.length) html += `<div class="rr-kpis duo">${big.map(kpiCell).join("")}</div>`;
    return html;
  }

  function table(t) {
    const head = t.cols.map((c) => `<th class="${c.l ? "l" : ""}${c.sort ? " sort" : ""}">${esc(c.label)}${c.sort ? " ↓" : ""}</th>`).join("");
    const body = t.rows.map((r) => `<tr>${r.map((cell) => {
      if (cell && cell.thumb !== undefined) return `<td class="l"><div class="rr-ad-name"><img class="rr-thumb" src="${cell.thumb || TRANSPARENT}" alt=""/><span>${esc(cell.name)}</span></div></td>`;
      if (cell && cell.l) return `<td class="l">${esc(cell.v)}${cell.sub ? `<span class="r-sub">${esc(cell.sub)}</span>` : ""}</td>`;
      if (cell && typeof cell === "object") return `<td>${esc(cell.v)}${cell.sub ? `<span class="r-sub">${esc(cell.sub)}</span>` : ""}</td>`;
      return `<td>${esc(cell)}</td>`;
    }).join("")}</tr>`).join("");
    return `<div class="rr-tbl-wrap"><table class="rr-tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }
  const TRANSPARENT = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Crect width='46' height='46' rx='8' fill='%23eef1f5'/%3E%3C/svg%3E";

  function analysisBlock(a, editable) {
    if (typeof a === "string") return `<div class="rr-analysis"${editable ? ' contenteditable="true"' : ""}>${a}</div>`;
    const html = a.map((b) => `${b.title ? `<h4>${esc(b.title)}</h4>` : ""}<p>${esc(b.text)}</p>`).join("");
    return `<div class="rr-analysis"${editable ? ' contenteditable="true"' : ""}>${html}</div>`;
  }

  function chartsGrid(ch) {
    if (!ch) return "";
    const cell = (title, leg, svg) => `<div class="rr-chart"><div class="rr-ctitle">${esc(title)} ${q()}</div>${leg}${svg}</div>`;
    const out = [];
    if (ch.timeseries) out.push(cell("Cliques e CTR durante o tempo", legend([{ c: "#22c55e", t: "CTR (Todos)" }, { c: "#2563eb", t: "Cliques" }]), lineSVG(ch.timeseries.labels, ch.timeseries.ctr, ch.timeseries.clicks)));
    if (ch.age) out.push(cell("Impressões e alcance por idade", legend([{ c: "#22c55e", t: "Impressões" }, { c: "#2563eb", t: "Alcance" }]), barsSVG(ch.age.labels, ch.age.impressions, ch.age.reach)));
    if (ch.device) out.push(cell("Alcance por plataforma de dispositivo", legend(ch.device.map((s) => ({ c: s.color, t: s.label }))), pieSVG(ch.device)));
    if (ch.gender) out.push(cell("Impressões e alcance por gênero", legend([{ c: "#22c55e", t: "Impressões" }, { c: "#2563eb", t: "Alcance" }]), barsSVG(ch.gender.labels, ch.gender.impressions, ch.gender.reach)));
    return `<div class="rr-charts">${out.join("")}</div>`;
  }

  /* ---------- seção de uma plataforma ---------- */
  function section(d, opts) {
    opts = opts || {};
    const accent = d.accent || "#1877f2";
    let inner = `<div class="rr-head"><div class="rr-logo">${LOGO[d.platform] || ""}</div>
      <div class="rr-head-txt"><h2>${esc(d.label)}</h2>${d.subtitle ? `<div class="rr-sub">${esc(d.subtitle)}</div>` : ""}</div>
      <span class="rr-clock">🕐</span></div>`;
    inner += kpiGrid(d.kpis || []);
    if (d.funnel) inner += `<div class="rr-title">Funil ${q()}</div><div class="rr-funnel">${funnelSVG(d.funnel)}</div>`;
    inner += chartsGrid(d.charts);
    (d.blocks || []).forEach((b) => {
      if (b.type === "title") inner += `<div class="rr-title">${esc(b.text)} ${q()}</div>`;
      else if (b.type === "table") inner += table(b);
      else if (b.type === "analysis" && b.id) inner += `<div class="rr-analysis" data-analysis="${esc(b.id)}"${opts.editable ? ' contenteditable="true"' : ""}><span class="rr-ph">⏳ gerando análise…</span></div>`;
      else if (b.type === "analysis") inner += analysisBlock(b.data, opts.editable);
    });
    return `<section class="rr-section${d.topAccent ? " rr-top-accent" : ""}" style="--rr-accent:${accent}">${inner}</section>`;
  }

  function renderInto(el, sections, opts) {
    el.classList.add("rr-doc");
    el.innerHTML = `<div class="rr-page">${sections.map((s) => section(s, opts)).join("")}</div>`;
  }

  root.ReportView = { renderInto, section, fmt: { fmtInt, fmtBRL, trimPct, fmtNum2 } };

  /* ======================================================================
     FIXTURE — números reais do PDF (Puket, 01–31/05/2026). Só pra validar o
     visual; a Fase A do backend substitui por dado ao vivo no mesmo formato.
     (séries diárias dos gráficos são aproximadas — marcadas como fixture)
     ====================================================================== */
  const days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0") + "/05/2026");
  const wave = (base, amp, seed) => days.map((_, i) => +(base + amp * Math.sin(i / 2.2 + seed) + amp * 0.4 * Math.sin(i / 1.3 + seed * 2)).toFixed(2));

  root.ReportView.PUKET = [
    {
      platform: "meta", label: "Meta Ads", subtitle: "Puket | Franquia: Raizhe", accent: "#1877f2",
      kpis: [
        { label: "Impressões Totais", kind: "int", value: 836174, prev: 843005 },
        { label: "Alcance Total", kind: "int", value: 308940, prev: 332762 },
        { label: "CPM médio", kind: "brl", value: 21.50, prev: 18.47 },
        { label: "Total de cliques no link", kind: "int", value: 6728, prev: 5564 },
        { label: "CPC médio", kind: "brl", value: 2.67, prev: 2.80 },
        { label: "CTR (Taxa de cliques no link)", kind: "pct", value: 0.8, prev: 0.66 },
        { label: "Frequência", kind: "num2", value: 2.71, prev: 2.53 },
        { label: "Todos os cadastros (leads)", kind: "int", value: 357, prev: 375 },
        { label: "Custo por Todos os cadastros (leads)", kind: "brl", value: 50.35, prev: 41.53, big: true },
        { label: "Valor investido", kind: "brl", value: 17974.54, prev: 15573.13, big: true },
      ],
      funnel: [
        { label: "Valor investido", value: "R$17,974.54", dir: "up" },
        { label: "Impressões Totais", value: "836,174", dir: "down" },
        { label: "Alcance Total", value: "308,940", dir: "down" },
        { label: "Total de cliques no link", value: "6,728", dir: "up" },
        { label: "Conversas iniciadas por mensagem", value: "22", dir: "up" },
        { label: "Todos os cadastros (leads)", value: "357", dir: "down" },
      ],
      charts: {
        timeseries: { labels: days, ctr: wave(0.95, 0.28, 0), clicks: wave(230, 90, 1.5) },
        age: { labels: ["18-24", "25-34", "35-44", "45-54", "55-64", "65+", "Desconhecido"], impressions: [105000, 295000, 290000, 90000, 20000, 10000, 3000], reach: [30000, 100000, 110000, 32000, 8000, 4000, 1000] },
        device: [{ label: "Mobile app", value: 99.94, color: "#2563eb" }, { label: "Desktop", value: 0.05, color: "#22c55e" }, { label: "Mobile web", value: 0.01, color: "#7cc4ff" }],
        gender: { labels: ["Feminino", "Masculino", "Desconhecido"], impressions: [740000, 60000, 2000], reach: [270000, 20000, 500] },
      },
      blocks: [
        { type: "title", text: "Campanhas em destaque" },
        {
          type: "table",
          cols: [{ label: "Nome da Campanha", l: true }, { label: "Impressões" }, { label: "Alcance" }, { label: "CPM" }, { label: "CTR (Taxa de cliques no link)" }, { label: "Resultados", sort: true }, { label: "Custo por resultados" }, { label: "Valor investido" }],
          rows: [[{ v: "[RZ][ABO][Estrutura por Região e Peso] 19.01.26", l: true }, "836,174", "308,940", "R$21.50", "0.8%", { v: "357", sub: "Lead" }, { v: "R$50.35", sub: "Lead" }, "R$17,974.54"]],
        },
        { type: "title", text: "Conjunto de anúncios em destaque" },
        {
          type: "table",
          cols: [{ label: "Conjunto de anúncio", l: true }, { label: "Impressões" }, { label: "Alcance" }, { label: "CPM" }, { label: "CTR (Taxa de cliques no link)" }, { label: "Resultados", sort: true }, { label: "Custo por resultados" }, { label: "Valor investido" }],
          rows: [
            [{ v: "Cidades Peso 03 | 17/03/26", l: true }, "354,143", "132,597", "R$17.58", "0.74%", { v: "127", sub: "Lead" }, { v: "R$49.02", sub: "Lead" }, "R$6,226.01"],
            [{ v: "Público Webinar | 19/05/26", l: true }, "76,220", "31,766", "R$17.36", "1.01%", { v: "72", sub: "Leads no Meta" }, { v: "R$18.38", sub: "Leads no Meta" }, "R$1,323.38"],
            [{ v: "Cidades Peso 02 | 19/01/26", l: true }, "197,083", "71,929", "R$26.48", "0.84%", { v: "65", sub: "Leads no Meta" }, { v: "R$80.28", sub: "Leads no Meta" }, "R$5,218.26"],
            [{ v: "Cidades Específicas Repasse | 01/04/26", l: true }, "102,490", "49,499", "R$15.27", "0.65%", { v: "42", sub: "Leads no Meta" }, { v: "R$37.26", sub: "Leads no Meta" }, "R$1,564.87"],
            [{ v: "Cidades Peso 01 | 19/01/26", l: true }, "61,334", "31,800", "R$35.82", "0.93%", { v: "26", sub: "Leads no Meta" }, { v: "R$84.51", sub: "Leads no Meta" }, "R$2,197.17"],
          ],
        },
        {
          type: "analysis",
          data: [
            { text: "O público de Webinar (19/05) foi o destaque absoluto do mês, com 72 leads e custo por lead de apenas R$ 18,38, bem abaixo da média da conta. A estratégia de webinar trouxe lead barato e em volume." },
            { text: "O público Cidades Peso 03 (17/03) foi o motor de volume, com 127 leads e custo por lead de R$ 49,02, enquanto o público Cidades Específicas Repasse (01/04) se destacou pela eficiência, com 42 leads e custo por lead de R$ 37,26." },
            { text: "Já os públicos Cidades Peso 01 e Cidades Peso 02 estão caros, com custo por lead entre R$ 80,28 e R$ 85,49, concentrando verba sem o retorno proporcional. São os principais candidatos a realocação de orçamento." },
          ],
        },
        { type: "title", text: "Anúncios em Destaque" },
        {
          type: "table",
          cols: [{ label: "Anúncio", l: true }, { label: "Impressões" }, { label: "Alcance" }, { label: "CPM" }, { label: "CTR (Taxa de cliques no link)" }, { label: "Frequência" }, { label: "Resultados", sort: true }, { label: "Custo por resultados" }, { label: "Valor investido" }],
          rows: [
            [{ thumb: "", name: "Criativo 02 | Webinar | 19.05" }, "76,220", "31,766", "R$17.36", "1.01%", "2.4", { v: "72", sub: "Leads no Meta" }, { v: "R$18.38", sub: "Leads no Meta" }, "R$1,323.38"],
            [{ thumb: "", name: "Ad 04 | Quer abrir uma Puket | 08.04" }, "127,372", "67,722", "R$18.11", "0.63%", "1.88", { v: "58", sub: "Lead" }, { v: "R$39.76", sub: "Lead" }, "R$2,306.08"],
            [{ thumb: "", name: "Ad 04 | Quer abrir uma Puket | 07/01 — Cópia" }, "96,447", "48,078", "R$15.17", "0.65%", "2.01", { v: "41", sub: "Leads no Meta" }, { v: "R$35.68", sub: "Leads no Meta" }, "R$1,462.88"],
            [{ thumb: "", name: "Ad Vídeo | 08.05" }, "134,849", "64,006", "R$20.97", "0.91%", "2.11", { v: "41", sub: "Lead" }, { v: "R$68.95", sub: "Lead" }, "R$2,827.11"],
            [{ thumb: "", name: "Ad novo 01 — Cópia — Cópia" }, "53,643", "34,063", "R$26.83", "0.73%", "1.57", { v: "25", sub: "Leads no Meta" }, { v: "R$57.56", sub: "Leads no Meta" }, "R$1,438.99"],
            [{ thumb: "", name: "Ad Vídeo | 08.05" }, "28,648", "16,970", "R$29.55", "0.95%", "1.69", { v: "18", sub: "Leads no Meta" }, { v: "R$47.02", sub: "Leads no Meta" }, "R$846.41"],
            [{ thumb: "", name: "AD 03 | FORM NOVO | 08.04" }, "44,409", "28,058", "R$9.43", "0.61%", "1.58", { v: "15", sub: "Lead" }, { v: "R$27.91", sub: "Lead" }, "R$418.66"],
            [{ thumb: "", name: "Ad Vídeo | 08.05" }, "92,560", "37,887", "R$25.99", "0.88%", "2.44", { v: "15", sub: "Leads no Meta" }, { v: "R$160.36", sub: "Leads no Meta" }, "R$2,405.44"],
            [{ thumb: "", name: "Ad novo 02 — Cópia — Cópia — Cópia" }, "23,333", "15,629", "R$27.28", "0.73%", "1.49", { v: "14", sub: "Leads no Meta" }, { v: "R$45.47", sub: "Leads no Meta" }, "R$636.61"],
          ],
        },
      ],
    },
    {
      platform: "google", label: "Google Ads", subtitle: "Puket | Expansão Franquias", accent: "#16a34a", topAccent: true,
      kpis: [
        { label: "Impressões", kind: "int", value: 17286, prev: 20764 },
        { label: "CPM médio", kind: "brl", value: 175.02, prev: 146.40 },
        { label: "Cliques", kind: "int", value: 2071, prev: 2747 },
        { label: "CPC médio", kind: "brl", value: 1.46, prev: 1.11 },
        { label: "CTR (Taxa de Cliques)", kind: "pct", value: 11.98, prev: 13.23 },
        { label: "Visualizações dos Vídeos", kind: "int", value: 229, prev: 594 },
        { label: "Conversões", kind: "int", value: 73, prev: 53 },
        { label: "Taxa de conversão", kind: "pct", value: 3.17, prev: 1.59 },
        { label: "Custo por Conversão", kind: "brl", value: 41.44, prev: 57.36, big: true },
        { label: "Custo", kind: "brl", value: 3025.43, prev: 3039.88, big: true },
      ],
      blocks: [
        {
          type: "analysis",
          data: [
            { title: "Investimento", text: "No mês, as campanhas registraram um investimento total de R$ 3025.43. Comparado ao período anterior, houve uma leve redução de -0.5% no investimento total da plataforma." },
            { title: "Impressões", text: "As campanhas geraram 17286 impressões ao longo do período. Comparado ao mês anterior, houve uma queda de -16.8%. Essa redução está diretamente ligada ao aumento do Custo por Mil Impressões (CPM), que impactou o volume de entrega dos anúncios." },
            { title: "Custo por mil impressões (CPM)", text: "O CPM apresentou um aumento significativo de +19.5%, atingindo R$ 175.02, impactando o alcance e o volume de entrega. Possíveis causas para esse aumento incluem maior concorrência de mercado e competitividade no segmento." },
            { title: "Cliques", text: "As campanhas geraram 2071 cliques no período." },
            { title: "Taxa de cliques (CTR)", text: "O CTR ficou em 11.98%, representando uma variação de -9.4% em relação ao período anterior. Apesar da queda, o CTR permanece acima do benchmark de mercado (≥5%), indicando que os anúncios ainda são relevantes para o público." },
            { title: "Conversões", text: "No período, as campanhas geraram 73 conversões, o que representa um aumento expressivo de +37.7% em comparação ao mês anterior." },
            { title: "Taxa de conversão", text: "A taxa de conversão ficou em 3.52%, apresentando um crescimento notável de +82.7% em relação ao período anterior. Embora tenha havido um aumento significativo, a taxa de conversão ainda se encontra abaixo do benchmark ideal de mercado (≥10%), indicando espaço para otimização na jornada do usuário." },
          ],
        },
        { type: "title", text: "Todas as Campanhas" },
        {
          type: "table",
          cols: [{ label: "Campanhas", l: true }, { label: "Impressões" }, { label: "Cliques", sort: true }, { label: "CTR (Taxa de Cliques)" }, { label: "CPC médio" }, { label: "Conversões" }, { label: "Custo por conversão" }, { label: "% de Anúncios na 1ª posição" }, { label: "Custo" }],
          rows: [
            [{ v: "PMax - Franquias", l: true }, "9,605", "1,054", "10.97%", "R$2.00", "57", "R$37.07", "0%", "R$2,112.86"],
            [{ v: "[RZ - S - Franqueados]", l: true }, "7,681", "1,017", "13.24%", "R$0.90", "16", "R$57.04", "33.63%", "R$912.56"],
          ],
        },
      ],
    },
  ];
})(typeof window !== "undefined" ? window : globalThis);

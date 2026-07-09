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
    // marcas oficiais (single-path / multipath) — Meta infinito azul, Google Ads barras amarela+azul, LinkedIn "in"
    meta: `<svg viewBox="0 0 24 24"><path fill="#0866FF" d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.442.76-1.01 1.144-1.658 2.663-4.334l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.386-3.72l-.868-1.45c-.292-.488-.583-.977-.87-1.454.63-.977 1.13-1.673 1.53-2.166.62-.759 1.03-1.15 1.44-1.29a.9.9 0 0 1 .008-.001zM6.9 6.156c.86 0 1.582.386 2.343 1.245.396.448.735.949 1.09 1.463l-.657 1.006c-.61.93-1.017 1.593-1.35 2.135-.69 1.11-1.145 1.734-1.7 2.303-.653.667-1.278.972-2.021.972-.99 0-1.635-.734-1.635-2.16 0-2.204.86-4.717 1.983-6.202.663-.878 1.394-1.605 2.323-1.605z"/></svg>`,
    // Google Ads oficial: barra amarela + barra azul + círculo VERDE (embaixo à esquerda)
    google: `<svg viewBox="0 0 24 24"><path fill="#FBBC04" d="M12.001 0a2.4 2.4 0 0 0-2.077 1.199L.32 17.727a2.4 2.4 0 1 0 4.155 2.4L14.078 3.599A2.4 2.4 0 0 0 12 0z"/><path fill="#4285F4" d="M17.759 5.775a2.4 2.4 0 0 0-2.079 1.202 2.4 2.4 0 0 0 0 2.398l5.759 9.976a2.4 2.4 0 1 0 4.157-2.398l-5.759-9.976a2.4 2.4 0 0 0-2.078-1.202z"/><circle fill="#34A853" cx="4.531" cy="19.516" r="2.516"/></svg>`,
    linkedin: `<svg viewBox="0 0 24 24"><rect width="24" height="24" rx="4.5" fill="#0A66C2"/><path fill="#fff" d="M8.34 18.34H5.67V9.75h2.67v8.59zM7 8.58a1.55 1.55 0 1 1 0-3.1 1.55 1.55 0 0 1 0 3.1zm11.34 9.76h-2.67v-4.18c0-1-.02-2.28-1.39-2.28-1.39 0-1.6 1.09-1.6 2.21v4.25h-2.67V9.75h2.56v1.17h.04c.36-.68 1.23-1.39 2.53-1.39 2.7 0 3.2 1.78 3.2 4.1v4.71z"/></svg>`,
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

  /* ---------- funil HORIZONTAL (cards lado a lado + curva de fluxo, estilo Reportei) ---------- */
  const isCurrency = (v) => /^\s*R\$/.test(String(v == null ? "" : v));
  const parseNum = (v) => { const f = parseFloat(String(v == null ? "" : v).replace(/[^0-9.,]/g, "").replace(/,/g, "")); return isNaN(f) ? 0 : f; };
  function smoothArea(pts, W, H) {
    if (pts.length < 2) return "";
    let d = `M ${pts[0][0]},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], cx = (x0 + x1) / 2;
      d += ` C ${cx.toFixed(1)},${y0.toFixed(1)} ${cx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
    }
    const line = d;
    const area = `${d} L ${W},${H} L 0,${H} Z`;
    return { line, area };
  }
  function funnelHorizontal(steps) {
    const n = steps.length;
    if (!n) return "";
    const nums = steps.map((s) => parseNum(s.value));
    // altura da curva: normaliza pelos valores; etapas em R$ (moeda) começam no topo pra não distorcer o funil de contagens
    const counts = steps.map((s, i) => (isCurrency(s.value) ? null : nums[i])).filter((v) => v != null);
    const cmax = Math.max(...counts, 1);
    const W = 1000, H = 132, top = 10;
    const curveVal = steps.map((s, i) => (isCurrency(s.value) ? cmax : nums[i]));
    const pts = [];
    curveVal.forEach((v, i) => { const x = (i + 0.5) / n * W; const y = top + (1 - Math.min(1, v / cmax)) * (H - top - 6); pts.push([x, y]); });
    pts.unshift([0, pts[0][1]]); pts.push([W, pts[pts.length - 1][1]]);
    const { line, area } = smoothArea(pts, W, H);
    const svg = `<svg class="rr-fn-curve" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${area}" fill="var(--rr-fn-fill)"/><path d="${line}" fill="none" stroke="var(--rr-fn-line)" stroke-width="2.5"/></svg>`;
    const cards = steps.map((s, i) => {
      const prevStep = i > 0 ? steps[i - 1] : null;
      const showRatio = prevStep && !isCurrency(prevStep.value) && !isCurrency(s.value) && nums[i - 1] > 0;
      let ratio = showRatio ? parseFloat((nums[i] / nums[i - 1] * 100).toFixed(2)) : null;
      // taxa > 100% = a etapa cresceu em vez de afunilar (caminhos paralelos, ex.: mensagem vs lead) → não é etapa real do funil
      if (ratio != null && ratio > 100) ratio = null;
      const delta = (s.prev != null && s.prev !== "") ? deltaHTML(nums[i], parseNum(s.prev)) : (s.dir ? `<span class="rr-delta ${s.dir === "up" ? "up" : s.dir === "down" ? "down" : "flat"}">${s.dir === "up" ? "▲" : s.dir === "down" ? "▼" : ""}</span>` : "");
      return `<div class="rr-fcard">
        <div class="rr-fc-top">
          <div class="rr-fc-lbl">${esc(s.label)}</div>
          <div class="rr-fc-val">${esc(s.value)}</div>
          ${delta ? `<div class="rr-fc-delta">${delta}</div>` : ""}
          ${(s.prev != null && s.prev !== "") ? `<div class="rr-fc-prev">${esc(s.prev)}<br>no período anterior</div>` : ""}
        </div>
        <div class="rr-fc-ratio">${ratio != null ? `<b>${ratio}%</b> de ${esc(prevStep.value)}` : ""}</div>
      </div>`;
    }).join("");
    return `<div class="rr-funnel-h" style="--fn:${n}">${svg}<div class="rr-fn-cards">${cards}</div></div>`;
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
  function kpiCell(k, editable) {
    const fmt = fmtBy[k.kind] || fmtBy.raw;
    const x = editable ? `<button type="button" class="rr-kpi-x" title="Remover esta métrica do relatório">✕</button>` : "";
    return `<div class="rr-kpi${k.big ? " big" : ""}" data-metric="${esc(k.label)}">${x}
      <div class="k-lbl">${esc(k.label)} ${q()}</div>
      <div class="k-row"><span class="k-val">${fmt(k.value)}</span>${deltaHTML(k.value, k.prev)}</div>
      ${k.prev != null ? `<div class="k-prev"><b>${fmt(k.prev)}</b> no período anterior</div>` : ""}
    </div>`;
  }
  function kpiGrid(kpis, opts, d) {
    opts = opts || {}; const ed = opts.editable;
    const main = kpis.filter((k) => !k.big), big = kpis.filter((k) => k.big);
    let html = `<div class="rr-kpis">${main.map((k) => kpiCell(k, ed)).join("")}</div>`;
    if (big.length) html += `<div class="rr-kpis duo">${big.map((k) => kpiCell(k, ed)).join("")}</div>`;
    if (ed && d && (d.extraMetrics || []).length) html += `<div class="rr-addmetric-wrap"><button type="button" class="rr-addmetric" data-platform="${esc(d.platform)}">➕ Adicionar métrica</button></div>`;
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
      <span class="rr-clock">🕐</span>
      <button type="button" class="rr-remove" title="Remover esta plataforma do relatório">Remover ✕</button></div>`;
    inner += kpiGrid(d.kpis || [], opts, d);
    if (d.funnel) inner += `<div class="rr-title">Funil ${q()}</div>${funnelHorizontal(d.funnel)}`;
    inner += chartsGrid(d.charts);
    (d.blocks || []).forEach((b) => {
      if (b.type === "title") inner += `<div class="rr-title">${esc(b.text)} ${q()}</div>`;
      else if (b.type === "table") inner += table(b);
      else if (b.type === "proximos") inner += `<div class="rr-nextsteps"><div class="rr-ns-title">🎯 Próximos Passos</div><div class="rr-analysis" data-analysis="${esc(b.id)}"${opts.editable ? ' contenteditable="true"' : ""}><span class="rr-ph">⏳ definindo os próximos passos…</span></div></div>`;
      else if (b.type === "analysis" && b.id) inner += `<div class="rr-analysis" data-analysis="${esc(b.id)}"${opts.editable ? ' contenteditable="true"' : ""}><span class="rr-ph">⏳ gerando análise…</span></div>`;
      else if (b.type === "analysis") inner += analysisBlock(b.data, opts.editable);
    });
    return `<section class="rr-section${d.topAccent ? " rr-top-accent" : ""}" style="--rr-accent:${accent}">${inner}</section>`;
  }

  function renderInto(el, sections, opts) {
    el.classList.add("rr-doc");
    el.innerHTML = `<div class="rr-page">${sections.map((s) => section(s, opts)).join("")}</div>`;
  }

  root.ReportView = { renderInto, section, kpiCardHtml: (k, editable) => kpiCell(k, editable), fmt: { fmtInt, fmtBRL, trimPct, fmtNum2 } };

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
        { label: "Valor investido", value: "R$17,974.54", prev: "R$15,573.13", dir: "up" },
        { label: "Impressões Totais", value: "836,174", prev: "843,005", dir: "down" },
        { label: "Alcance Total", value: "308,940", prev: "332,762", dir: "down" },
        { label: "Total de cliques no link", value: "6,728", prev: "5,564", dir: "up" },
        { label: "Conversas iniciadas por mensagem", value: "22", prev: "18", dir: "up" },
        { label: "Todos os cadastros (leads)", value: "357", prev: "375", dir: "down" },
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

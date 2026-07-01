/* ============================================================
   main.cjs — processo principal do Electron
   - Janela + carregamento da UI
   - Armazenamento local (store.json em userData)
   - Integrações: Reportei v2, Trello v1, Gemini
   - Histórico semanal por cliente
   ============================================================ */
const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

/* ---------------------------------------------------------- */
/* Armazenamento local                                         */
/* ---------------------------------------------------------- */
const STORE_PATH = () => path.join(app.getPath("userData"), "store.json");
const DEFAULT_STORE = {
  settings: { reporteiToken: "", trelloKey: "", trelloToken: "", geminiKey: "", geminiModel: "gemini-2.5-flash", aiEngine: "gemini", reportTemplate: "", googleSheetsKey: "", metaToken: "", googleAdsDevToken: "", googleAdsClientId: "", googleAdsClientSecret: "", googleAdsRefreshToken: "", googleAdsLoginCustomerId: "", googleAdsApiVersion: "", pageSpeedKey: "", updateBaseUrl: "https://raw.githubusercontent.com/erikedias/pmp-update-bfypgb/main", ekyteKey: "", ekyteAnalystEmail: "", ekytePoEmail: "", ekyteTaskTypeId: "", ekyteWorkspaceId: "", ekyteCompanyId: "", ekyteWebhookUrl: "", ekyteMcpUrl: "", ekyteMcpToken: "", ekyteMcpTool: "" },
  clients: [], // [{projectId, name, trelloBoardId, trelloBoardName}]
  history: [], // [{id, projectId, clientName, weekLabel, start, end, savedAt, platformResults, items, analysisText, trello}]
  actions: [], // [{id, at, projectId, clientName, type, summary, detail}]
};

function readStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH(), "utf8");
    return Object.assign({}, DEFAULT_STORE, JSON.parse(raw));
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_STORE));
  }
}
function writeStore(store) {
  fs.mkdirSync(path.dirname(STORE_PATH()), { recursive: true });
  fs.writeFileSync(STORE_PATH(), JSON.stringify(store, null, 2), "utf8");
}

/* ---------------------------------------------------------- */
/* HTTP helper                                                 */
/* ---------------------------------------------------------- */
async function httpJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const e = body && body.error;
    // Meta/Graph: a razão real costuma vir em error_user_msg / error_user_title, não em message
    let msg;
    if (e && typeof e === "object") {
      // Google Ads: o motivo real fica em error.details[].errors[].message (+ qual campo em location)
      let gads = null;
      try {
        (e.details || []).forEach((d) => { (d.errors || []).forEach((x) => {
          if (gads) return;
          const fp = ((x.location && x.location.fieldPathElements) || []).map((f) => f.fieldName).filter(Boolean);
          if (x.message) gads = x.message + (fp.length ? ` [campo: ${fp.slice(-3).join(".")}]` : "");
        }); });
      } catch {}
      msg = gads || e.error_user_msg || e.error_user_title || e.message || JSON.stringify(e);
    } else {
      msg = (body && body.message) || (typeof e === "string" ? e : null) || text || `HTTP ${res.status}`;
    }
    const err = new Error(`${res.status} — ${msg}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------- */
/* Reportei v2                                                 */
/* ---------------------------------------------------------- */
const REPORTEI = "https://app.reportei.com/api/v2";
const rpHeaders = (token) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" });

// config de cada plataforma: reference_keys de total + tabelas (campanha/público).
// Os OBJETOS de métrica (id UUID, metrics, dimensions, type) vêm de /metrics?integration_slug=
// — usar o objeto EXATO é obrigatório (payload chutado dá "invalid_metrics_combination").
const FETCH = {
  linkedin_ads: {
    platform: "linkedin",
    totals: ["li_ads:sends", "li_ads:opens", "li_ads:actionClicks", "li_ads:oneClickLeads", "li_ads:costPerLead", "li_ads:cost"],
    campaignTable: null,
    audienceTable: "li_ads:featuredSponsoredMessaging", // público: envios/aberturas/cliques (sem leads)
    adsTable: "li_ads:posts",
  },
  google_adwords: {
    platform: "google",
    totals: ["gads:impressions", "gads:clicks", "gads:conversions", "gads:average_cpc", "gads:cost_micros"],
    campaignTable: "gads:top_campaigns",
    audienceTable: "gads:summary_per_adgroups",
    adsTable: "gads:ads_summary_table",
  },
  facebook_ads: {
    platform: "meta",
    totals: ["fb_ads:impressions", "fb_ads:reach", "fb_ads:clicks", "fb_ads:ctr", "fb_ads:actions_lead", "fb_ads:actions_cost_per_lead", "fb_ads:spend"],
    campaignTable: "fb_ads:insights_by_campaign",
    audienceTable: "fb_ads:adset",
    adsTable: "fb_ads:ads",
  },
};

const numOf = (data, rk) => {
  const cell = data && data[rk];
  if (!cell || cell.type === "no_data_in_period" || cell.values == null) return null;
  const v = typeof cell.values === "string" ? parseFloat(cell.values) : cell.values;
  return Number.isFinite(v) ? v : null;
};

// normaliza os TOTAIS de uma integração para o schema do engine
function normalizeTotals(slug, data) {
  if (slug === "linkedin_ads") {
    // "Cliques" no LinkedIn = aberturas de formulário com um clique (actionClicks), não li_ads:clicks
    const liLeads = numOf(data, "li_ads:oneClickLeads"), liCost = numOf(data, "li_ads:cost");
    const liCpl = (liCost != null && liLeads) ? liCost / liLeads : numOf(data, "li_ads:costPerLead"); // costPerLead vem 0 → calcula
    return { sends: numOf(data, "li_ads:sends"), opens: numOf(data, "li_ads:opens"), clicks: numOf(data, "li_ads:actionClicks"), leads: liLeads, cpl: liCpl, spend: liCost };
  }
  if (slug === "google_adwords") {
    return { impressions: numOf(data, "gads:impressions"), clicks: numOf(data, "gads:clicks"), conversions: numOf(data, "gads:conversions"), cpc: numOf(data, "gads:average_cpc"), cost: numOf(data, "gads:cost_micros") };
  }
  if (slug === "facebook_ads") {
    // CTR é computado pelo engine a partir de cliques÷impressões (evita ambiguidade de unidade)
    return { impressions: numOf(data, "fb_ads:impressions"), reach: numOf(data, "fb_ads:reach"), clicks: numOf(data, "fb_ads:clicks"), ctr: null, leads: numOf(data, "fb_ads:actions_lead"), cpl: numOf(data, "fb_ads:actions_cost_per_lead"), spend: numOf(data, "fb_ads:spend") };
  }
  return {};
}

// ---- helpers de parsing de datatables ----
const cellNum = (x) => { if (x == null) return null; if (typeof x === "object") x = x.value != null ? x.value : x.text; const v = typeof x === "string" ? parseFloat(x) : x; return Number.isFinite(v) ? v : null; };
const cellName = (x) => (x && typeof x === "object" ? (x.text || String(x.value ?? "")) : String(x ?? ""));

// Meta às vezes vem SEM headers — ordem fixa: [nome, leads{}, cpl{}, spend, reach, impressions, ctr%, cpc, cpm, freq]
function parseMetaFixed(cell, level) {
  return cell.values.map((row) => {
    const impressions = cellNum(row[5]), ctr = cellNum(row[6]);
    return { level, name: cellName(row[0]), metrics: {
      leads: cellNum(row[1]), cpl: cellNum(row[2]), spend: cellNum(row[3]), reach: cellNum(row[4]),
      impressions, ctr, clicks: (impressions != null && ctr != null) ? Math.round(impressions * ctr / 100) : null,
    } };
  }).filter((r) => r.name);
}

// parser por headers (Google/LinkedIn) com fallback Meta sem header
function parseTable(slug, cell, level) {
  if (!cell || !Array.isArray(cell.values)) return [];
  const headered = cell.headers && Object.keys(cell.headers).length;
  if (slug === "facebook_ads" && !headered) return parseMetaFixed(cell, level);
  if (!headered) return [];
  const keys = Object.keys(cell.headers);
  const dimIdx = Math.max(0, keys.findIndex((k) => cell.headers[k].isDimension));
  const find = (...subs) => keys.findIndex((k) => subs.some((s) => k.toLowerCase().includes(s)));
  const at = (row, i) => (i >= 0 ? row[i] : null);
  return cell.values.map((row) => {
    const name = cellName(at(row, dimIdx));
    const m = {};
    if (slug === "google_adwords") {
      m.impressions = cellNum(at(row, find("impressions"))); m.clicks = cellNum(at(row, find("clicks")));
      m.conversions = cellNum(at(row, find("conversions"))); m.cpc = cellNum(at(row, find("average_cpc", "cpc")));
      m.cost = cellNum(at(row, find("cost_micros", "cost", "spend")));
    } else if (slug === "facebook_ads") {
      m.impressions = cellNum(at(row, find("impressions"))); m.reach = cellNum(at(row, find("reach")));
      m.clicks = cellNum(at(row, find("clicks"))); m.leads = cellNum(at(row, find("lead")));
      m.spend = cellNum(at(row, find("spend", "cost"))); const c = cellNum(at(row, find("ctr"))); if (c != null) m.ctr = c;
    } else if (slug === "linkedin_ads") {
      m.sends = cellNum(at(row, find("sends"))); m.opens = cellNum(at(row, find("opens")));
      const ac = cellNum(at(row, find("actionclicks"))), cl = cellNum(at(row, find("clicks")));
      m.clicks = (ac != null && ac > 0) ? ac : cl; m.leads = null; // LinkedIn não entrega leads por público
    }
    return { level, name, metrics: m };
  }).filter((r) => r.name);
}

// parser genérico de anúncios (só pro relatório): nome + métricas comuns por header
function parseAdsRows(cell) {
  if (!cell || !Array.isArray(cell.values) || !cell.headers) return [];
  const keys = Object.keys(cell.headers);
  if (!keys.length) return [];
  const dimIdx = Math.max(0, keys.findIndex((k) => cell.headers[k].isDimension));
  const find = (...subs) => keys.findIndex((k) => subs.some((s) => k.toLowerCase().includes(s)));
  const at = (row, i) => (i >= 0 ? row[i] : null);
  return cell.values.slice(0, 20).map((row) => ({
    level: "ad", name: cellName(at(row, dimIdx)),
    metrics: {
      impressions: cellNum(at(row, find("impressions"))), clicks: cellNum(at(row, find("clicks"))),
      spend: cellNum(at(row, find("spend", "cost"))), leads: cellNum(at(row, find("lead"))),
      ctr: cellNum(at(row, find("ctr"))),
    },
  })).filter((r) => r.name);
}

async function reporteiProjects(token, q) {
  const url = new URL(`${REPORTEI}/projects`);
  url.searchParams.set("per_page", "100");
  if (q) url.searchParams.set("q", q);
  const body = await httpJson(url.toString(), { headers: rpHeaders(token) });
  return (body.data || []).map((p) => ({ id: p.id, name: p.name }));
}

async function reporteiIntegrations(token, projectId) {
  const url = new URL(`${REPORTEI}/integrations`);
  url.searchParams.set("project_id", String(projectId));
  url.searchParams.set("per_page", "100");
  const body = await httpJson(url.toString(), { headers: rpHeaders(token) });
  return body.data || [];
}

// cache das definições de métrica por slug (id UUID + metrics/dimensions/type corretos)
const _defsCache = {};
async function getMetricDefs(token, slug) {
  if (_defsCache[slug]) return _defsCache[slug];
  const url = new URL(`${REPORTEI}/metrics`);
  url.searchParams.set("integration_slug", slug);
  const body = await httpJson(url.toString(), { headers: rpHeaders(token) });
  const map = {};
  (body.data || []).forEach((m) => { map[m.reference_key] = m; });
  _defsCache[slug] = map;
  return map;
}

// puxa usando os OBJETOS exatos e remapeia a resposta (chaveada por id UUID) → reference_key
async function reporteiGetData(token, integrationId, start, end, defObjs) {
  const body = await httpJson(`${REPORTEI}/metrics/get-data`, {
    method: "POST",
    headers: rpHeaders(token),
    body: JSON.stringify({ start, end, integration_id: integrationId, metrics: defObjs }),
  });
  if (body && (body.code || body.exception)) return { __exception: body };
  const raw = body.data || body.values || body || {};
  const id2key = {};
  defObjs.forEach((d) => { id2key[d.id] = d.reference_key; });
  const out = {};
  Object.entries(raw).forEach(([k, v]) => { out[id2key[k] || k] = v; });
  return out;
}

const PLATFORM_LABEL = { meta: "Meta Ads", google: "Google Ads", linkedin: "LinkedIn Ads" };

async function reporteiWeekData(token, projectId, start, end, includeAds) {
  const integrations = await reporteiIntegrations(token, projectId);
  const wanted = integrations.filter((i) => FETCH[i.slug]); // não filtra por status
  const results = [];
  const notes = [];
  const emptyByPlatform = {};

  for (const integ of wanted) {
    const cfg = FETCH[integ.slug];
    let defs;
    try { defs = await getMetricDefs(token, integ.slug); }
    catch (e) { notes.push(`${PLATFORM_LABEL[cfg.platform]} · "${integ.name}": erro ao listar métricas — ${e.message}`); continue; }

    const wantKeys = [...cfg.totals, cfg.campaignTable, cfg.audienceTable, includeAds ? cfg.adsTable : null].filter(Boolean);
    const defObjs = wantKeys.map((k) => defs[k]).filter(Boolean);

    let data;
    try { data = await reporteiGetData(token, integ.id, start, end, defObjs); }
    catch (e) { notes.push(`${PLATFORM_LABEL[cfg.platform]} · "${integ.name}": erro ao puxar — ${e.message}`); continue; }

    if (data.__exception) {
      const ex = data.__exception;
      const msg = (ex.exception && ex.exception.message) || ex.code;
      const expired = ex.code === "integration_expired" || /expired|reintegrate/i.test(String(msg));
      notes.push(expired
        ? `${PLATFORM_LABEL[cfg.platform]} · "${integ.name}": integração EXPIRADA no Reportei. Reconecte a rede em app.reportei.com (Integrações → reintegrar) e analise de novo.`
        : `${PLATFORM_LABEL[cfg.platform]} · "${integ.name}": ${msg}`);
      continue;
    }
    console.log(`[reportei] ${integ.slug} keys=${JSON.stringify(Object.keys(data))}`);

    const totals = normalizeTotals(integ.slug, data);
    if (!Object.values(totals).some((v) => v != null)) {
      (emptyByPlatform[cfg.platform] = emptyByPlatform[cfg.platform] || []).push(integ.name);
      continue;
    }
    const campRows = cfg.campaignTable && data[cfg.campaignTable] ? parseTable(integ.slug, data[cfg.campaignTable], "campaign") : [];
    const audRows = cfg.audienceTable && data[cfg.audienceTable] ? parseTable(integ.slug, data[cfg.audienceTable], "audience") : [];
    // Meta: tabela de anúncios vem SEM headers (ordem fixa) → usa o parser fixo; Google/LinkedIn têm headers
    const adCell = includeAds && cfg.adsTable ? data[cfg.adsTable] : null;
    const adRows = adCell ? (integ.slug === "facebook_ads" ? parseTable(integ.slug, adCell, "ad").slice(0, 20) : parseAdsRows(adCell)) : [];
    const campaign = campRows.length ? campRows : [{ level: "campaign", name: integ.name || "Total da conta", metrics: totals }];
    results.push({ platform: cfg.platform, slug: integ.slug, integrationId: integ.id, name: integ.name, rows: campaign.concat(audRows, adRows), totals });
  }

  // avisa quando uma plataforma existe mas nenhuma conta dela tem dado na semana
  Object.entries(emptyByPlatform).forEach(([plat, names]) => {
    if (!results.some((r) => r.platform === plat)) {
      notes.push(`${PLATFORM_LABEL[plat]}: nenhuma das ${names.length} conta(s) tem dados nesta semana (integração inativa/desconectada no Reportei?).`);
    }
  });

  return { platforms: results, notes };
}

/* ---------------------------------------------------------- */
/* Urgência: detecta clientes fora do padrão nos últimos 2 dias */
/* ---------------------------------------------------------- */
const isoDate = (dt) => { const p = (n) => String(n).padStart(2, "0"); return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`; };
const daysAgo = (n) => { const x = new Date(); x.setDate(x.getDate() - n); return isoDate(x); };

// totais por plataforma (sem tabelas) — leve, pro scan de urgência
async function reporteiTotals(token, projectId, start, end) {
  const integrations = await reporteiIntegrations(token, projectId);
  const wanted = integrations.filter((i) => FETCH[i.slug]);
  const out = {};
  for (const integ of wanted) {
    const cfg = FETCH[integ.slug];
    let defs; try { defs = await getMetricDefs(token, integ.slug); } catch { continue; }
    const defObjs = cfg.totals.map((k) => defs[k]).filter(Boolean);
    let data; try { data = await reporteiGetData(token, integ.id, start, end, defObjs); } catch { continue; }
    if (!data || data.__exception) continue;
    const t = normalizeTotals(integ.slug, data);
    const p = out[cfg.platform] = out[cfg.platform] || { spend: 0, cost: 0, leads: 0, conversions: 0 };
    ["spend", "cost", "leads", "conversions"].forEach((k) => { if (t[k] != null) p[k] += t[k]; });
  }
  return out;
}
function detectAnomalies(recent, base) {
  const alerts = [];
  const L = { meta: "Meta", google: "Google", linkedin: "LinkedIn" };
  const f = 2 / 14; // baseline (14d) escalado pra janela de 2 dias
  Object.keys(recent).forEach((p) => {
    const r = recent[p], b = base[p] || {};
    const rSpend = (r.spend || 0) + (r.cost || 0), bSpend = ((b.spend || 0) + (b.cost || 0)) * f;
    const rLeads = (r.leads || 0) + (r.conversions || 0), bLeads = ((b.leads || 0) + (b.conversions || 0)) * f;
    const nm = L[p] || p;
    // PRINCIPAL: investiu e não gerou NENHUM lead nos últimos 2 dias
    if (rSpend >= 20 && rLeads === 0) alerts.push({ sev: "alta", txt: `${nm}: SEM LEADS nos últimos 2 dias — investiu R$ ${rSpend.toFixed(0)} e não gerou nenhum lead` });
    else if (bLeads >= 4 && rLeads < bLeads * 0.4) alerts.push({ sev: "média", txt: `${nm}: queda de leads (${rLeads} vs ~${bLeads.toFixed(1)} esperado no período)` });
    if (bSpend >= 20 && rSpend > bSpend * 1.6) alerts.push({ sev: "alta", txt: `${nm}: investimento ${Math.round((rSpend / bSpend - 1) * 100)}% acima do normal (R$ ${rSpend.toFixed(0)} em 2d vs ~R$ ${bSpend.toFixed(0)})` });
    const rCpl = rLeads ? rSpend / rLeads : null;
    const bL = (b.leads || 0) + (b.conversions || 0), bS = (b.spend || 0) + (b.cost || 0), bCpl = bL ? bS / bL : null;
    if (rCpl != null && bCpl && rCpl > bCpl * 1.6) alerts.push({ sev: "média", txt: `${nm}: CPL disparou (R$ ${rCpl.toFixed(2)} vs ~R$ ${bCpl.toFixed(2)} normal)` });
  });
  return alerts;
}
ipcMain.handle("urgency:scan", async () => {
  const st = readStore(); const token = st.settings.reporteiToken;
  if (!token) throw new Error("Configure o token do Reportei.");
  const recentStart = daysAgo(2), recentEnd = daysAgo(1);
  const baseStart = daysAgo(16), baseEnd = daysAgo(3);
  const out = [];
  for (const c of st.clients) {
    if (c.noReportei) continue; // cliente entrou só pelo Trello, sem projeto no Reportei
    try {
      const recent = await reporteiTotals(token, c.projectId, recentStart, recentEnd);
      const base = await reporteiTotals(token, c.projectId, baseStart, baseEnd);
      const alerts = detectAnomalies(recent, base);
      if (alerts.length) out.push({ clientName: c.name, projectId: c.projectId, alerts });
    } catch { /* pula cliente com erro */ }
  }
  out.sort((a, b) => b.alerts.filter((x) => x.sev === "alta").length - a.alerts.filter((x) => x.sev === "alta").length || b.alerts.length - a.alerts.length);
  return { results: out, period: `${recentStart} a ${recentEnd}`, scanned: st.clients.length };
});

/* ---------------------------------------------------------- */
/* Trello v1                                                   */
/* ---------------------------------------------------------- */
const TRELLO = "https://api.trello.com/1";
const trelloAuth = (s) => `key=${encodeURIComponent(s.trelloKey)}&token=${encodeURIComponent(s.trelloToken)}`;

async function trelloBoards(s, q) {
  const body = await httpJson(`${TRELLO}/members/me/boards?fields=name&${trelloAuth(s)}`);
  let boards = (body || []).map((b) => ({ id: b.id, name: b.name }));
  if (q) boards = boards.filter((b) => b.name.toLowerCase().includes(q.toLowerCase()));
  return boards;
}
async function trelloLists(s, boardId) {
  return await httpJson(`${TRELLO}/boards/${boardId}/lists?fields=name&${trelloAuth(s)}`);
}
function findList(lists, ...needles) {
  const lower = lists.map((l) => ({ ...l, n: l.name.toLowerCase() }));
  for (const needle of needles) {
    const hit = lower.find((l) => l.n.includes(needle));
    if (hit) return hit.id;
  }
  return null;
}
async function trelloCreateCard(s, listId, name, desc) {
  const params = new URLSearchParams({ idList: listId, name, desc: desc || "", key: s.trelloKey, token: s.trelloToken });
  return await httpJson(`${TRELLO}/cards`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() });
}
async function trelloAddChecklist(s, cardId, name) {
  const params = new URLSearchParams({ name, key: s.trelloKey, token: s.trelloToken });
  return await httpJson(`${TRELLO}/cards/${cardId}/checklists`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() });
}
async function trelloAddCheckItem(s, checklistId, name) {
  const params = new URLSearchParams({ name, key: s.trelloKey, token: s.trelloToken });
  return await httpJson(`${TRELLO}/checklists/${checklistId}/checkItems`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() });
}
// anexa uma imagem (URL externa, ex. CDN do Meta/Google) a um card: baixa o binário e sobe como anexo.
// Retorna o ID do anexo criado (string) ou null. Se o upload falhar, tenta anexar só pela URL.
async function trelloAttachImageFromUrl(s, cardId, imageUrl, filename) {
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`download ${imgRes.status}`);
    const buf = await imgRes.arrayBuffer();
    const type = imgRes.headers.get("content-type") || "image/jpeg";
    const form = new FormData();
    form.append("key", s.trelloKey);
    form.append("token", s.trelloToken);
    form.append("file", new Blob([buf], { type }), filename || "criativo.jpg");
    const res = await fetch(`${TRELLO}/cards/${cardId}/attachments`, { method: "POST", body: form });
    if (res.ok) { const att = await res.json().catch(() => null); return (att && att.id) || null; }
    throw new Error(`upload ${res.status}`);
  } catch {
    // fallback: anexa referenciando a URL (não rebaixa; pode expirar, mas serve)
    const params = new URLSearchParams({ url: imageUrl, key: s.trelloKey, token: s.trelloToken });
    const r2 = await fetch(`${TRELLO}/cards/${cardId}/attachments`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() });
    if (r2.ok) { const att = await r2.json().catch(() => null); return (att && att.id) || null; }
    return null;
  }
}
// define a capa do card como o anexo, em modo "full" (a imagem preenche a face do card, sem o letterbox)
async function trelloSetCardCover(s, cardId, idAttachment) {
  return httpJson(`${TRELLO}/cards/${cardId}?${trelloAuth(s)}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cover: { idAttachment, size: "full", brightness: "light" } }),
  });
}

async function trelloSendWeek(s, boardId, week, items, analysisText, negated) {
  const lists = await trelloLists(s, boardId);
  const demandasId = findList(lists, "demandas da semana", "demandas");
  const feitosId = findList(lists, "o que foi feito na semana", "feito na semana", "feitos");
  if (!demandasId) throw new Error('Lista "Demandas da Semana" não encontrada no board.');

  const result = {};
  // 1) card de otimizações + checklist
  const optCard = await trelloCreateCard(s, demandasId, `Otimizações da semana de ${week.label}`,
    `Próximos passos a executar nesta semana (${week.label}), com base na análise da semana ${week.label}.`);
  const checklist = await trelloAddChecklist(s, optCard.id, "Otimizações");
  for (const it of items) await trelloAddCheckItem(s, checklist.id, it.text);
  result.optCardUrl = optCard.shortUrl || optCard.url;

  // 2) card de análise (se a lista existir e houver texto)
  if (feitosId && analysisText) {
    const aCard = await trelloCreateCard(s, feitosId, `Análise da semana de ${week.label}`, analysisText);
    result.analysisCardUrl = aCard.shortUrl || aCard.url;
  }
  // 3) termos negativados na semana → card em "O que foi feito" (lista na descrição, já estão feitos)
  if (feitosId && negated && negated.length) {
    const desc = `${negated.length} termo(s) negativado(s) no Google Ads nesta semana:\n\n` + negated.map((t) => `- ${t}`).join("\n");
    const nCard = await trelloCreateCard(s, feitosId, `Termos negativados na semana de ${week.label}`, desc);
    result.negatedCardUrl = nCard.shortUrl || nCard.url;
  }
  return result;
}

/* ---------------------------------------------------------- */
/* Gemini                                                      */
/* ---------------------------------------------------------- */
function leadsLine(leads) {
  if (!leads || !leads.total) return "";
  return `\nQualificação de leads (planilha do cliente no período): ${leads.total} leads, ${leads.mqls} MQL (${leads.mqlRate.toFixed(1)}%)${leads.hasSql ? `, ${leads.sqls} SQL/reuniões (${leads.sqlRate.toFixed(1)}%)` : ""}.`;
}
// CPL ideal pela unit economics: LTV(=LT×ticket) ÷ (LTV/CAC) × tx(SQL→venda) × tx(MQL→SQL) × tx(Lead→MQL)
function idealCplOf(c) {
  if (!c || !c.ticketMedio || !c.lt || !c.ltvCac) return null;
  return c.lt * c.ticketMedio / c.ltvCac * ((c.rateSqlVenda || 10) / 100) * ((c.rateMqlSql || 15) / 100) * ((c.rateLeadMql || 0) / 100);
}
function actualCplFrom(prs) {
  let invest = 0, leads = 0;
  (prs || []).forEach((pr) => { const t = pr.totals || {}; invest += (t.spend || 0) + (t.cost || 0); leads += (t.leads || 0) + (t.conversions || 0); });
  return leads ? invest / leads : null;
}
const brlFmt = (v) => v == null ? "—" : "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function cplLine(cplIdeal, prs) {
  const ideal = idealCplOf(cplIdeal); if (!ideal) return "";
  const real = actualCplFrom(prs);
  let cmp = "";
  if (real != null) cmp = real <= ideal ? ` → CPL real ABAIXO do ideal (POSITIVO: lead barato, relação LTV/CAC melhor que o alvo)` : ` → CPL real ACIMA do ideal (ATENÇÃO/gargalo: lead caro pro retorno do cliente)`;
  return `\nCusto por lead — ideal x real: CPL ideal ${brlFmt(ideal)} (ticket médio R$ ${cplIdeal.ticketMedio}, LT ${cplIdeal.lt}, LTV/CAC ${cplIdeal.ltvCac}). CPL real no período: ${brlFmt(real)}${cmp}.`;
}
function buildAnalysisPrompt(clientName, week, platformResults, benchmarks, leads, cplIdeal, gargalos) {
  const Engine = require(path.join(__dirname, "..", "src", "engine.js"));
  const linhas = [];
  platformResults.forEach((pr) => {
    const plat = Engine.PLATFORMS[pr.platform];
    const pb = (benchmarks && benchmarks[pr.platform]) || {};
    linhas.push(`\n### ${plat.label}`);
    pr.rows.forEach((row) => {
      const { rates } = plat.derive(row.metrics, pb);
      const garg = Engine.findGargalo(pr.platform, rates, pb);
      const ratesStr = Object.entries(rates).map(([k, v]) => `${k}: ${v == null ? "—" : v.toFixed(2) + "%"}`).join(" · ");
      linhas.push(`- ${row.name} | ${ratesStr} | gargalo: ${garg || "nenhum"}`);
    });
    // MQL/SQL da planilha do cliente, no nível da plataforma (final do funil: Leads → MQL → SQL)
    const lp = leads && leads.byPlatform && leads.byPlatform[pr.platform];
    if (lp && lp.total) {
      const txMql = lp.mqls / lp.total * 100;
      const txSql = lp.mqls ? lp.sqls / lp.mqls * 100 : null;
      linhas.push(`- Qualificação (planilha): ${lp.total} leads, ${lp.mqls} MQL (Taxa de MQL ${txMql.toFixed(1)}% · bench ≥30%)${leads.hasSql ? `, ${lp.sqls} SQL/reuniões (Taxa de SQL ${txSql == null ? "—" : txSql.toFixed(1) + "%"} dos MQL · bench 15–20%)` : ""}`);
    }
  });
  // gargalos REVISADOS pela analista (descartou / adicionou / editou no painel) — a análise foca SÓ neles
  let gargBloco = "", temGarg = Array.isArray(gargalos);
  if (temGarg) {
    const blocos = gargalos.map((p) => {
      if (!p.gargalos || !p.gargalos.length) return `\n### ${p.label}\n(sem gargalos — a analista considerou dentro do esperado)`;
      const gs = p.gargalos.map((g) => `- Gargalo: ${g.gargalo}${g.nome ? ` (em "${g.nome}")` : ""}${g.hipotese ? `\n  Hipótese: ${g.hipotese}` : ""}${(g.otimizacoes || []).length ? `\n  Otimizações: ${g.otimizacoes.join("; ")}` : ""}`).join("\n");
      return `\n### ${p.label}\n${gs}`;
    }).join("\n");
    gargBloco = `\n\nGARGALOS REVISADOS PELA ANALISTA (use SOMENTE estes — ela já descartou os irrelevantes e ajustou as hipóteses/otimizações):${blocos}`;
  }
  return [
    `Você é uma analista de mídia paga escrevendo a análise semanal do cliente "${clientName}", semana ${week.label}.`,
    `Escreva em português, tom explicativo e profissional, exatamente nestas seções, sem markdown de título com #:`,
    `"Panorama geral da semana" (resumo de leads e desempenho), uma seção por plataforma (Google Ads, Meta Ads, LinkedIn Ads) citando as campanhas, os números e o(s) gargalo(s) com a hipótese, depois "Métricas de performance por plataforma" e por fim "Otimizações realizadas/propostas".`,
    temGarg
      ? `IMPORTANTE: a análise dos gargalos e das otimizações deve usar EXCLUSIVAMENTE a lista "GARGALOS REVISADOS PELA ANALISTA" abaixo. NÃO invente gargalos novos, NÃO cite gargalos que não estão na lista, e respeite as hipóteses/otimizações que ela escreveu. Se uma plataforma não tem gargalo na lista, diga que está dentro do esperado (sem inventar problema). Os números/benchmarks servem só de contexto pros resultados.`
      : `O gargalo é a primeira taxa abaixo do benchmark descendo o funil.`,
    `Benchmarks (contexto): Google CTR ≥5% e Taxa de conversão ≥10%; Meta CTR ≥1% e Taxa de preenchimento ≥30%; LinkedIn Taxa de abertura ≥50%, Taxa de cliques ≥1,5% e Taxa de preenchimento ≥40%. Funil termina em Leads → MQL → SQL.`,
    leads && leads.total ? `Inclua na análise de CADA plataforma a QUALIDADE dos leads (não só volume): comente a taxa de MQL e quantos viraram reunião.` : "",
    idealCplOf(cplIdeal) ? `Comente o Custo por Lead real vs ideal: ABAIXO do ideal = positivo; ACIMA = ponto de eficiência.` : "",
    `\nDados da semana (contexto/números):${linhas.join("\n")}${leadsLine(leads)}${cplLine(cplIdeal, platformResults)}${gargBloco}`,
  ].filter(Boolean).join("\n");
}

// prompt de RELATÓRIO MENSAL — segue a JORNADA DO USUÁRIO de cada plataforma, ponto por ponto,
// com comparação vs mês anterior, nos níveis GERAL → PÚBLICOS → ANÚNCIOS (modelo do Obsidian dela)
function buildReportPrompt(clientName, monthLabel, platformResults, prevResults, template, benchmarks, leads, leadsPrev, cplIdeal) {
  const Engine = require(path.join(__dirname, "..", "src", "engine.js"));
  const prevMap = {}; (prevResults || []).forEach((p) => { prevMap[p.platform] = p.totals || {}; });
  const dl = (c, p) => (c == null || p == null || p === 0) ? null : ((c - p) / p) * 100;
  const dtxt = (d) => d == null ? "" : ` (${d >= 0 ? "+" : ""}${d.toFixed(1)}% vs mês anterior)`;
  const cpm = (spend, impr) => (spend != null && impr) ? (spend / impr * 1000) : null;
  const r2 = (x) => x == null ? "—" : (Math.round(x * 100) / 100);
  const ratio = (a, b) => (a != null && b) ? a / b * 100 : null;
  const lpOf = (l, key) => (l && l.byPlatform && l.byPlatform[key]) || null;

  const blocos = [];
  (platformResults || []).forEach((pr) => {
    const plat = Engine.PLATFORMS[pr.platform];
    const pb = (benchmarks && benchmarks[pr.platform]) || {};
    const bOf = (name) => { const f = plat.funnel.find((x) => x.name === name); return pb[name] != null ? pb[name] : (f ? f.bench : null); };
    const t = pr.totals || {}, pv = prevMap[pr.platform] || {};
    const invC = t.spend != null ? t.spend : t.cost, invP = pv.spend != null ? pv.spend : pv.cost;

    // pontos da jornada: número simples, valor em R$ ou taxa com benchmark — sempre com Δ vs mês anterior
    const num = (nome, c, p) => c == null ? null : `${nome}: ${c}${dtxt(dl(c, p))}`;
    const brl = (nome, c, p) => c == null ? null : `${nome}: R$ ${r2(c)}${dtxt(dl(c, p))}`;
    const rate = (nome, c, p, bench) => c == null ? null : `${nome}: ${r2(c)}%${dtxt(dl(c, p))}${bench != null ? ` [benchmark ≥${bench}%]` : ""}`;

    // MQL/SQL da planilha do cliente (taxas no jeito dela: MQL÷leads e SQL÷MQL)
    const lp = lpOf(leads, pr.platform), lpv = lpOf(leadsPrev, pr.platform);
    const mqlSteps = lp && lp.total ? [
      num("MQL (planilha do cliente)", lp.mqls, lpv ? lpv.mqls : null),
      rate("Taxa de MQL", ratio(lp.mqls, lp.total), lpv ? ratio(lpv.mqls, lpv.total) : null, 30),
      ...(leads.hasSql ? [
        num("SQL / reuniões (planilha do cliente)", lp.sqls, lpv ? lpv.sqls : null),
        rate("Taxa de SQL (SQL÷MQL)", ratio(lp.sqls, lp.mqls), lpv ? ratio(lpv.sqls, lpv.mqls) : null, 15),
      ] : []),
    ] : [];

    const cplC = t.cpl != null ? t.cpl : (invC != null && (t.leads || t.conversions) ? invC / (t.leads || t.conversions) : null);
    const cplP = pv.cpl != null ? pv.cpl : (invP != null && (pv.leads || pv.conversions) ? invP / (pv.leads || pv.conversions) : null);

    let lines;
    if (pr.platform === "linkedin") {
      lines = [
        brl("Investimento", invC, invP),
        num("Envios", t.sends, pv.sends),
        num("Aberturas", t.opens, pv.opens),
        rate("Taxa de abertura", ratio(t.opens, t.sends), ratio(pv.opens, pv.sends), bOf("Taxa de abertura")),
        num("Aberturas de formulário (cliques)", t.clicks, pv.clicks),
        rate("Taxa de cliques", ratio(t.clicks, t.opens), ratio(pv.clicks, pv.opens), bOf("Taxa de cliques")),
        num("Leads", t.leads, pv.leads),
        rate("Taxa de preenchimento", ratio(t.leads, t.clicks), ratio(pv.leads, pv.clicks), bOf("Taxa de preenchimento")),
        ...mqlSteps,
        brl("Custo por lead", cplC, cplP),
      ];
    } else if (pr.platform === "meta") {
      lines = [
        brl("Investimento", invC, invP),
        num("Impressões", t.impressions, pv.impressions),
        brl("CPM", cpm(invC, t.impressions), cpm(invP, pv.impressions)),
        num("Alcance", t.reach, pv.reach),
        num("Cliques", t.clicks, pv.clicks),
        rate("Taxa de cliques (CTR)", ratio(t.clicks, t.impressions), ratio(pv.clicks, pv.impressions), bOf("CTR")),
        num("Leads", t.leads, pv.leads),
        rate("Taxa de preenchimento", ratio(t.leads, t.clicks), ratio(pv.leads, pv.clicks), bOf("Taxa de preenchimento")),
        ...mqlSteps,
        brl("Custo por lead", cplC, cplP),
      ];
    } else { // google
      lines = [
        brl("Investimento", invC, invP),
        num("Impressões", t.impressions, pv.impressions),
        brl("CPM", cpm(invC, t.impressions), cpm(invP, pv.impressions)),
        num("Cliques", t.clicks, pv.clicks),
        rate("Taxa de cliques (CTR)", ratio(t.clicks, t.impressions), ratio(pv.clicks, pv.impressions), bOf("CTR")),
        brl("CPC", t.cpc, pv.cpc),
        num("Conversões (leads)", t.conversions, pv.conversions),
        rate("Taxa de conversão", ratio(t.conversions, t.clicks), ratio(pv.conversions, pv.clicks), bOf("Taxa de conversão")),
        ...mqlSteps,
        brl("Custo por lead", cplC, cplP),
      ];
    }
    lines = lines.filter(Boolean);

    const rowLine = (r) => {
      const m = r.metrics, { rates } = plat.derive(m, pb);
      const rs = Object.entries(rates).map(([k, v]) => `${k} ${v == null ? "—" : r2(v) + "%"}`).join(", ");
      const inv = m.spend != null ? m.spend : m.cost;
      const ex = [
        m.sends != null ? `${m.sends} envios` : null, m.opens != null ? `${m.opens} aberturas` : null,
        m.impressions != null ? `${m.impressions} impr` : null, m.clicks != null ? `${m.clicks} cliques` : null,
        m.conversions != null ? `${m.conversions} conversões` : null, m.leads != null ? `${m.leads} leads` : null,
        inv != null ? `R$ ${r2(inv)}` : null, m.cpl != null ? `CPL R$ ${r2(m.cpl)}` : null,
      ].filter(Boolean).join(", ");
      return `  • ${r.name}: ${rs}${ex ? " | " + ex : ""}`;
    };
    const camps = pr.rows.filter((r) => r.level === "campaign").map(rowLine);
    const pubs = pr.rows.filter((r) => r.level === "audience").map(rowLine);
    const ads = pr.rows.filter((r) => r.level === "ad").map((r) => {
      const m = r.metrics;
      const ex = [m.impressions != null ? `${m.impressions} impr` : null, m.clicks != null ? `${m.clicks} cliques` : null, m.ctr != null ? `CTR ${r2(m.ctr)}%` : null, m.leads != null ? `${m.leads} leads` : null, m.spend != null ? `R$ ${r2(m.spend)}` : null, m.cpl != null ? `CPL R$ ${r2(m.cpl)}` : null].filter(Boolean).join(", ");
      return `  • ${r.name}: ${ex || "—"}`;
    });
    // MQL por público: cada aba da planilha = um público
    const mqlTabs = (leads && leads.byTab ? leads.byTab : []).filter((tb) => tb.platform === pr.platform && tb.total)
      .map((tb) => `  • ${tb.title}: ${tb.total} leads, ${tb.mqls} MQL (${ratio(tb.mqls, tb.total).toFixed(1)}%)${leads.hasSql ? `, ${tb.sqls} SQL` : ""}`);
    const bench = plat.funnel.map((f) => f.name + " ≥" + (pb[f.name] != null ? pb[f.name] : f.bench) + "%").join(", ");
    blocos.push(`\n## ${plat.label} (benchmarks: ${bench}; Taxa de MQL ≥30%; Taxa de SQL 15–20%)`
      + `\nNÍVEL GERAL — jornada ponto a ponto (vs mês anterior):\n${lines.map((l) => "  " + l).join("\n")}`
      + `\nCAMPANHAS:\n${camps.join("\n") || "  (sem dado)"}`
      + `\nPÚBLICOS:\n${pubs.join("\n") || "  (sem dado)"}`
      + (mqlTabs.length ? `\nMQL/SQL POR PÚBLICO (planilha do cliente):\n${mqlTabs.join("\n")}` : "")
      + `\nANÚNCIOS:\n${ads.join("\n") || "  (sem dado)"}`);
  });

  const tpl = (template && template.trim())
    ? `Siga EXATAMENTE este modelo (mesma estrutura e a mesma forma de desenvolver cada métrica):\n"""\n${template.trim()}\n"""`
    : "";
  return [
    `Você é uma analista de mídia paga escrevendo o RELATÓRIO MENSAL do cliente "${clientName}", referente a ${monthLabel}.`,
    `Tom profissional voltado ao cliente, em português.`,
    `FORMATO: cada título de métrica em uma linha própria SEM asteriscos e SEM markdown (escreva "Investimento", nunca "**Investimento**"), seguido de um parágrafo de análise — sempre citando a variação vs mês anterior e o benchmark quando fizer sentido, explicando causas e a relação entre métricas (ex.: CPM mais alto reduz impressões e alcance; cliques subindo menos que impressões derrubam o CTR).`,
    `O relatório percorre a JORNADA DO USUÁRIO de cada plataforma, PONTO POR PONTO, exatamente nesta ordem:`,
    `- LinkedIn Ads: Investimento → Envios → Aberturas → Taxa de abertura → Aberturas de formulário → Taxa de cliques → Leads → Taxa de preenchimento → MQL → Taxa de MQL → SQL → Taxa de SQL → Custo por lead.`,
    `- Meta Ads: Investimento → Impressões → CPM → Alcance → Cliques → Taxa de cliques (CTR) → Leads → Taxa de preenchimento → MQL → Taxa de MQL → SQL → Taxa de SQL → Custo por lead.`,
    `- Google Ads: Investimento → Impressões → CPM → Cliques → Taxa de cliques (CTR) → CPC → Conversões → Taxa de conversão → MQL → Taxa de MQL → SQL → Taxa de SQL → Custo por lead.`,
    `Em cada plataforma, a análise tem 3 níveis, nesta ordem: 1) NÍVEL GERAL — a jornada completa acima, cada ponto com seu título e parágrafo; 2) NÍVEL DE PÚBLICOS — cada público individualmente seguindo a mesma lógica de funil, destacando os de melhor CPL e melhor CTR; 3) NÍVEL DE ANÚNCIOS — as métricas principais de cada anúncio (impressões, cliques, CTR, leads, CPL), destacando os melhores e os que precisam ser trocados.`,
    `Pule apenas os pontos sem dado. Ao identificar a etapa da jornada onde a performance cai abaixo do benchmark, nomeie o gargalo ali mesmo.`,
    tpl,
    `Use SOMENTE os dados reais abaixo. Não invente. Onde não houver comparação (sem dado do mês anterior), analise apenas o mês atual.`,
    leads && leads.total ? `MQL e SQL vêm da planilha de qualificação do cliente — comente QUALIDADE (taxa de MQL e quantos viraram reunião), não só volume, como parte da jornada de cada plataforma.` : "",
    idealCplOf(cplIdeal) ? `Comente o Custo por Lead real vs ideal: abaixo do ideal é positivo (lead barato); acima é ponto de atenção.` : "",
    `\nDADOS DE ${monthLabel.toUpperCase()}:${blocos.join("\n")}${leadsLine(leads)}${cplLine(cplIdeal, platformResults)}`,
    `\nTermine com "Próximos Passos": ações concretas que ATACAM diretamente os pontos e gargalos levantados na análise acima (ex.: CTR abaixo do benchmark → testar novos criativos; taxa de preenchimento baixa → revisar formulário), já indicando em qual etapa da jornada está cada problema. Cada próximo passo deve responder a algo que você analisou — nada genérico.`,
  ].filter(Boolean).join("\n");
}

// linhas de totais com delta vs mês anterior (mesma lógica do relatório)
function platTotalsLines(t, pv) {
  const dl = (c, p) => (c == null || p == null || p === 0) ? null : ((c - p) / p) * 100;
  const dtxt = (d) => d == null ? "" : ` (${d >= 0 ? "+" : ""}${d.toFixed(1)}% vs mês anterior)`;
  const r2 = (x) => x == null ? "—" : (Math.round(x * 100) / 100);
  const cpm = (sp, im) => (sp != null && im) ? sp / im * 1000 : null;
  const invC = t.spend != null ? t.spend : t.cost, invP = pv.spend != null ? pv.spend : pv.cost;
  const ctrC = (t.clicks != null && t.impressions) ? t.clicks / t.impressions * 100 : null;
  const ctrP = (pv.clicks != null && pv.impressions) ? pv.clicks / pv.impressions * 100 : null;
  const tpC = (t.leads != null && t.clicks) ? t.leads / t.clicks * 100 : null, tpP = (pv.leads != null && pv.clicks) ? pv.leads / pv.clicks * 100 : null;
  const cvC = (t.conversions != null && t.clicks) ? t.conversions / t.clicks * 100 : null, cvP = (pv.conversions != null && pv.clicks) ? pv.conversions / pv.clicks * 100 : null;
  const taC = (t.opens != null && t.sends) ? t.opens / t.sends * 100 : null, taP = (pv.opens != null && pv.sends) ? pv.opens / pv.sends * 100 : null;
  return [
    invC != null ? `Investimento: R$ ${r2(invC)}${dtxt(dl(invC, invP))}` : null,
    t.sends != null ? `Envios: ${t.sends}${dtxt(dl(t.sends, pv.sends))}` : null,
    t.opens != null ? `Aberturas: ${t.opens}${dtxt(dl(t.opens, pv.opens))}` : null,
    taC != null ? `Taxa de abertura: ${r2(taC)}%${dtxt(dl(taC, taP))}` : null,
    t.impressions != null ? `Impressões: ${t.impressions}${dtxt(dl(t.impressions, pv.impressions))}` : null,
    cpm(invC, t.impressions) != null ? `CPM: R$ ${r2(cpm(invC, t.impressions))}${dtxt(dl(cpm(invC, t.impressions), cpm(invP, pv.impressions)))}` : null,
    t.reach != null ? `Alcance: ${t.reach}${dtxt(dl(t.reach, pv.reach))}` : null,
    t.clicks != null ? `Cliques: ${t.clicks}${dtxt(dl(t.clicks, pv.clicks))}` : null,
    ctrC != null ? `CTR/Taxa de cliques: ${r2(ctrC)}%${dtxt(dl(ctrC, ctrP))}` : null,
    t.conversions != null ? `Conversões: ${t.conversions}${dtxt(dl(t.conversions, pv.conversions))}` : null,
    cvC != null ? `Taxa de conversão: ${r2(cvC)}%${dtxt(dl(cvC, cvP))}` : null,
    t.leads != null ? `Leads: ${t.leads}${dtxt(dl(t.leads, pv.leads))}` : null,
    tpC != null ? `Taxa de preenchimento: ${r2(tpC)}%${dtxt(dl(tpC, tpP))}` : null,
    (invC != null && (t.leads || t.conversions)) ? `CPL: R$ ${r2(invC / ((t.leads || 0) + (t.conversions || 0)))}${dtxt(dl(invC / ((t.leads || 0) + (t.conversions || 0)), (invP != null && ((pv.leads || 0) + (pv.conversions || 0))) ? invP / ((pv.leads || 0) + (pv.conversions || 0)) : null))}` : null,
  ].filter(Boolean);
}
function rowsLines(plat, rows, level) {
  const Engine = require(path.join(__dirname, "..", "src", "engine.js"));
  const r2 = (x) => x == null ? "—" : (Math.round(x * 100) / 100);
  return rows.filter((r) => r.level === level).map((r) => {
    const m = r.metrics, { rates } = Engine.PLATFORMS[plat].derive(m);
    const rs = Object.entries(rates).map(([k, v]) => `${k} ${v == null ? "—" : r2(v) + "%"}`).join(", ");
    const ex = [m.sends != null ? `${m.sends} envios` : null, m.opens != null ? `${m.opens} aberturas` : null, m.impressions != null ? `${m.impressions} impr` : null, m.clicks != null ? `${m.clicks} cliques` : null, m.conversions != null ? `${m.conversions} conv` : null, m.leads != null ? `${m.leads} leads` : null, m.spend != null ? `R$ ${r2(m.spend)}` : null, m.cost != null ? `R$ ${r2(m.cost)}` : null, m.ctr != null ? `CTR ${r2(m.ctr)}%` : null].filter(Boolean).join(", ");
    return `  • ${r.name}: ${rs}${ex ? " | " + ex : ""}`;
  });
}

// prompt por PLATAFORMA: 3 análises (campanha/público/anúncio) com marcadores pra separar
function buildPlatformSectionsPrompt(clientName, monthLabel, pr, prevTotals, template, bench) {
  const Engine = require(path.join(__dirname, "..", "src", "engine.js"));
  const plat = Engine.PLATFORMS[pr.platform];
  const benchStr = plat.funnel.map((f) => f.name + " ≥" + ((bench && bench[f.name]) != null ? bench[f.name] : f.bench) + "%").join(", ");
  const totals = platTotalsLines(pr.totals || {}, prevTotals || {});
  const camp = rowsLines(pr.platform, pr.rows, "campaign");
  const aud = rowsLines(pr.platform, pr.rows, "audience");
  const ads = rowsLines(pr.platform, pr.rows, "ad");
  return [
    `Você é uma analista de mídia paga escrevendo a análise de ${plat.label} do relatório mensal do cliente "${clientName}" (${monthLabel}). Benchmarks: ${benchStr}.`,
    `ESTILO: métrica por métrica — o nome da métrica numa linha própria SEM asteriscos/markdown, seguido de um parágrafo comparando com o mês anterior (variação %) e o benchmark, explicando causas e a relação entre métricas. Tom profissional voltado ao cliente. Use SOMENTE os dados abaixo, não invente.`,
    template ? `Modelo a seguir:\n"""${template.slice(0, 1200)}"""` : "",
    `Responda nas TRÊS seções OBRIGATÓRIAS abaixo, sempre iniciando cada uma com a linha-marcador exata (sozinha na linha). Nunca omita um marcador:`,
    `===CAMPANHAS===  (análise geral da plataforma + campanhas, métrica por métrica usando os totais com variação)`,
    `===PUBLICOS===  (análise por público, individualmente)`,
    `===ANUNCIOS===  (análise por anúncio; se não houver dados, escreva uma linha dizendo que não há dados de anúncio no período)`,
    `\nTOTAIS DA PLATAFORMA (com variação vs mês anterior):\n${totals.join("\n")}`,
    `\nCAMPANHAS:\n${camp.join("\n") || "(sem dados)"}`,
    `\nPÚBLICOS:\n${aud.join("\n") || "(sem dados)"}`,
    `\nANÚNCIOS:\n${ads.join("\n") || "(sem dados)"}`,
  ].filter(Boolean).join("\n");
}

// conclusão do relatório: panorama + qualificação + CPL ideal + próximos passos
function buildReportFinalPrompt(clientName, monthLabel, platformResults, leads, cplIdeal) {
  const linhas = (platformResults || []).map((pr) => {
    const t = pr.totals || {};
    return `- ${pr.platform}: investido R$ ${((t.spend || 0) + (t.cost || 0)).toFixed(2)}, leads ${((t.leads || 0) + (t.conversions || 0))}`;
  });
  return [
    `Você é uma analista de mídia paga fechando o relatório mensal do cliente "${clientName}" (${monthLabel}). Sem asteriscos/markdown; títulos em linha própria.`,
    `Escreva DUAS seções separadas pelos marcadores:`,
    `===QUALIFICACAO===  (seção "Qualificação de Leads": MQL, SQL e custo por lead real vs ideal — abaixo do ideal é positivo, acima é ponto de atenção)`,
    `===PROXIMOS===  (seção "Próximos Passos": ações concretas que atacam os gargalos do mês — nada genérico)`,
    `\nResumo do mês:\n${linhas.join("\n")}${leadsLine(leads)}${cplLine(cplIdeal, platformResults)}`,
  ].join("\n");
}

ipcMain.handle("gemini:reportPlatform", async (_e, { clientName, monthLabel, pr, prevTotals, benchmarks }) => {
  const s = readStore().settings;
  const bench = (benchmarks && benchmarks[pr.platform]) || {};
  return aiAnalyze(s, buildPlatformSectionsPrompt(clientName, monthLabel, pr, prevTotals, s.reportTemplate, bench));
});
ipcMain.handle("gemini:reportFinal", async (_e, { clientName, monthLabel, platformResults, leads, cplIdeal }) => {
  const s = readStore().settings;
  return aiAnalyze(s, buildReportFinalPrompt(clientName, monthLabel, platformResults, leads, cplIdeal));
});

// prompt livre (usado pelo Funil Studio embutido pra montar estratégias por descrição)
ipcMain.handle("gemini:raw", async (_e, { prompt }) => aiAnalyze(readStore().settings, prompt));

/* ---- Cofre do cliente no Obsidian (~/Claude/Clientes) ---- */
const CLIENTS_DIR = path.join(os.homedir(), "Claude", "Clientes");

// acha a pasta do cofre: 1º pelo reportei_project_id no frontmatter; senão por nome
function findVault(projectId, clientName) {
  if (!fs.existsSync(CLIENTS_DIR)) throw new Error("Pasta ~/Claude/Clientes não encontrada.");
  const dirs = fs.readdirSync(CLIENTS_DIR).filter((d) => { try { return fs.statSync(path.join(CLIENTS_DIR, d)).isDirectory(); } catch { return false; } });
  let vault = null;
  if (projectId) {
    for (const d of dirs) {
      let txt = ""; try { txt = fs.readFileSync(path.join(CLIENTS_DIR, d, d + ".md"), "utf8"); } catch {}
      if (new RegExp(`reportei_project_id:\\s*\`?${projectId}\`?`).test(txt)) { vault = d; break; }
    }
  }
  if (!vault && clientName) {
    const key = clientName.toLowerCase().split(/[\s—-]/)[0];
    vault = dirs.find((d) => d.toLowerCase().includes(key) || clientName.toLowerCase().includes(d.toLowerCase()));
  }
  return vault;
}

// lê TODO o conteúdo legível do cofre (todos os .md), juntando por arquivo
function readVaultAll(vault, maxChars) {
  const dir = path.join(CLIENTS_DIR, vault);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".md")); } catch {}
  // ordem: nota principal (vault.md) primeiro, depois as demais
  files.sort((a, b) => (a === vault + ".md" ? -1 : b === vault + ".md" ? 1 : a.localeCompare(b)));
  const parts = [];
  for (const f of files) {
    let txt = ""; try { txt = fs.readFileSync(path.join(dir, f), "utf8"); } catch {}
    if (txt.trim()) parts.push(`## ${f.replace(/\.md$/i, "")}\n${txt.trim()}`);
  }
  return parts.join("\n\n---\n\n").slice(0, maxChars || 30000);
}

const sanitizeFs = (name, fallback) => String(name || "").replace(/[\/\\:*?"<>|]/g, "-").replace(/\s+/g, " ").trim() || fallback;

// cria o cofre do cliente se não existir e grava/atualiza uma nota .md com o conteúdo gerado no app
ipcMain.handle("obsidian:saveNote", async (_e, { projectId, clientName, title, content }) => {
  if (!content || !String(content).trim()) throw new Error("Nada para salvar.");
  if (!fs.existsSync(CLIENTS_DIR)) fs.mkdirSync(CLIENTS_DIR, { recursive: true });
  let vault = findVault(projectId, clientName);
  let created = false;
  if (!vault) {
    vault = sanitizeFs(clientName, "Cliente");
    const dir = path.join(CLIENTS_DIR, vault);
    fs.mkdirSync(dir, { recursive: true });
    const main = path.join(dir, vault + ".md");
    if (!fs.existsSync(main)) fs.writeFileSync(main, `---\nreportei_project_id: ${projectId || ""}\n---\n\n# ${clientName || vault}\n\nCofre criado pelo Painel de Mídia Paga.\n`);
    created = true;
  }
  const dir = path.join(CLIENTS_DIR, vault);
  const file = path.join(dir, sanitizeFs(title, "Nota") + ".md");
  const header = `> Gerado pelo Painel de Mídia Paga · ${new Date().toLocaleDateString("pt-BR")}\n\n`;
  fs.writeFileSync(file, header + String(content).trim() + "\n");
  return { vault, file: path.basename(file), created };
});

ipcMain.handle("obsidian:clientProfile", async (_e, { projectId, clientName }) => {
  const vault = findVault(projectId, clientName);
  if (!vault) throw new Error("Não achei o cofre desse cliente em ~/Claude/Clientes (confere o nome ou o project_id).");
  const content = readVaultAll(vault, 16000);
  if (!content) throw new Error(`Cofre "${vault}" encontrado, mas sem conteúdo legível.`);
  const prompt = [
    "A partir das notas de Obsidian abaixo sobre um cliente de mídia paga, extraia um PERFIL OBJETIVO.",
    'Responda SÓ um JSON: {"servico":"...","oQueFaz":"...","oQueNaoFaz":"...","persona":"...","obs":"..."}',
    "servico = 1 frase do que o cliente vende. oQueFaz = serviços/ofertas principais (bullet em texto corrido). oQueNaoFaz = o que NÃO é o negócio, útil pra negativar buscas irrelevantes (ex.: vagas de emprego, cursos, termos de concorrentes irrelevantes). persona = cliente ideal resumido. obs = outro ponto útil. Em português, conciso.",
    `Notas:\n"""${content}"""`,
  ].join("\n\n");
  const raw = await aiAnalyze(readStore().settings, prompt);
  const m = raw.match(/\{[\s\S]*\}/);
  const prof = m ? JSON.parse(m[0]) : { servico: "", oQueFaz: raw.slice(0, 600), oQueNaoFaz: "", persona: "", obs: "" };
  prof._vault = vault;
  return prof;
});

// lista os arquivos do cofre (pra mostrar o que o app está lendo)
ipcMain.handle("obsidian:vaultFiles", async (_e, { projectId, clientName }) => {
  const vault = findVault(projectId, clientName);
  if (!vault) return { vault: null, files: [] };
  let files = [];
  try { files = fs.readdirSync(path.join(CLIENTS_DIR, vault)).filter((f) => f.toLowerCase().endsWith(".md")).map((f) => f.replace(/\.md$/i, "")); } catch {}
  return { vault, files };
});

// CONVERSAR com o app usando o conteúdo do cofre como contexto
ipcMain.handle("obsidian:ask", async (_e, { projectId, clientName, question, history }) => {
  const vault = findVault(projectId, clientName);
  if (!vault) throw new Error("Não achei o cofre desse cliente em ~/Claude/Clientes.");
  const content = readVaultAll(vault, 28000);
  if (!content) throw new Error(`Cofre "${vault}" sem conteúdo legível.`);
  const hist = (history || []).slice(-6).map((h) => `${h.role === "user" ? "Pergunta" : "Resposta"}: ${h.text}`).join("\n");
  const prompt = [
    `Você é a assistente de mídia paga da @diasesteci. Responda à pergunta dela sobre o cliente "${clientName || vault}" USANDO as notas do Obsidian abaixo como fonte de verdade.`,
    "Regras: baseie-se SÓ nas notas + no que ela perguntar; se a informação não estiver nas notas, diga claramente que não consta. Seja objetiva e direta, em português. Pode usar listas e tabelas em markdown.",
    hist ? `Conversa até agora:\n${hist}` : "",
    `NOTAS DO COFRE "${vault}":\n"""${content}"""`,
    `PERGUNTA: ${question}`,
  ].filter(Boolean).join("\n\n");
  const text = await aiAnalyze(readStore().settings, prompt);
  return { vault, text };
});

/* ---------------------------------------------------------- */
/* SUBIDA DE CAMPANHAS — Meta Marketing API (rascunhos PAUSED) */
/* ---------------------------------------------------------- */
const GRAPH = "https://graph.facebook.com/v21.0";

ipcMain.handle("meta:test", async () => {
  const s = readStore().settings;
  if (!s.metaToken) throw new Error("Cole o token de acesso do Meta em Configurações.");
  const r = await httpJson(`${GRAPH}/me/adaccounts?fields=name,account_id&limit=100&access_token=${encodeURIComponent(s.metaToken)}`);
  return (r.data || []).map((a) => ({ id: `act_${a.account_id}`, name: a.name }));
});

// SUBIDA DE CAMPANHA NO GOOGLE (Pesquisa) — orçamento → campanha → grupo → keywords → anúncio RSA. Tudo PAUSADO.
function gKwMatch(line) {
  const s = String(line).trim();
  if (/^\[.*\]$/.test(s)) return { text: s.replace(/^\[|\]$/g, "").trim(), matchType: "EXACT" };
  if (/^".*"$/.test(s)) return { text: s.replace(/^"|"$/g, "").trim(), matchType: "PHRASE" };
  return { text: s, matchType: "BROAD" };
}
// tipo de campanha (PT da pré-estrutura) → canal do Google + estratégia de lance + se tem ad group
const G_TYPES = [
  { re: /pesquisa|search/i, type: "SEARCH", bid: { manualCpc: {} }, net: { targetGoogleSearch: true, targetSearchNetwork: true, targetContentNetwork: false, targetPartnerSearchNetwork: false }, group: "search" },
  { re: /performance\s*max|pmax/i, type: "PERFORMANCE_MAX", bid: { maximizeConversions: {} }, group: "asset" },
  { re: /display/i, type: "DISPLAY", bid: { manualCpc: {} }, net: { targetGoogleSearch: false, targetSearchNetwork: false, targetContentNetwork: true, targetPartnerSearchNetwork: false }, group: "display" },
  { re: /demand|demanda/i, type: "DEMAND_GEN", bid: { maximizeConversions: {} }, group: "campaignOnly" },
  { re: /v[ií]deo|youtube/i, type: "VIDEO", bid: { targetCpm: {} }, group: "campaignOnly" },
  { re: /shopping/i, type: "SHOPPING", needs: "Merchant Center vinculado", group: "block" },
  { re: /\bapp\b/i, type: "APP", needs: "o app publicado na loja", group: "block" },
];
function gType(camp) {
  const t = `${camp.tipoCampanha || ""} ${camp.nome || ""}`;
  return G_TYPES.find((x) => x.re.test(t)) || G_TYPES[0]; // default Pesquisa
}
function firstUrl(camp) {
  for (const g of (camp.conjuntos || [])) for (const a of (g.anuncios || [])) if (a.finalUrl || a.url) return a.finalUrl || a.url;
  return null;
}

// extrai interesses (palavras) e sites (URLs) do grupo (campos estruturados ou parseando publicoDef)
function parseTargeting(grupo) {
  if (grupo.interesses || grupo.sites) return { interesses: grupo.interesses || [], sites: grupo.sites || [] };
  const txt = grupo.publicoDef || "";
  const sites = (txt.match(/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s,;]*)?/gi) || []).filter((u) => !/^[\d.]+$/.test(u));
  let interesses = [];
  const mi = txt.match(/interesses?:\s*([^.]+)/i);
  if (mi) interesses = mi[1].split(",").map((s) => s.trim()).filter(Boolean).filter((s) => !/sites?\s+semelhantes|p[uú]blico/i.test(s));
  return { interesses, sites };
}
// cria público personalizado (interesses=KEYWORD, sites=URL) e devolve o resourceName
async function googleCustomAudience(cid, headers, name, interesses, sites) {
  const members = [];
  (interesses || []).forEach((t) => { const k = String(t).trim(); if (k) members.push({ memberType: "KEYWORD", keyword: k }); });
  (sites || []).forEach((u) => { let x = String(u).trim().replace(/\/+$/, ""); if (x) { if (!/^https?:\/\//.test(x)) x = "https://" + x; members.push({ memberType: "URL", url: x }); } });
  if (!members.length) return null;
  const r = await googleAdsApi(`customers/${cid}/customAudiences:mutate`, { method: "POST", headers, body: JSON.stringify({ operations: [{ create: { name: `${name} ${Date.now()}`, description: "Criado pelo Painel de Mídia Paga", members } }] }) });
  return r.results && r.results[0] && r.results[0].resourceName;
}
// sobe uma imagem como asset de imagem e devolve o resourceName
async function googleImageAsset(cid, headers, name, src) {
  let dataUrl = src;
  if (src && !/^data:/.test(src)) { try { dataUrl = readImageDataUrl(src); } catch {} }
  if (!dataUrl || !/^data:/.test(dataUrl)) return null;
  const r = await googleAdsApi(`customers/${cid}/assets:mutate`, { method: "POST", headers, body: JSON.stringify({ operations: [{ create: { name: `${name} ${Date.now()}`, type: "IMAGE", imageAsset: { data: dataUrl.split(",")[1] } } }] }) });
  return r.results && r.results[0] && r.results[0].resourceName;
}

ipcMain.handle("upload:google", async (_e, { customerId, plataforma }) => {
  const cid = String(customerId || "").replace(/-/g, "");
  if (!cid) throw new Error("Cliente sem conta Google vinculada (Customer ID).");
  const headers = await gadsHeaders();
  const mut = (res, operations) => googleAdsApi(`customers/${cid}/${res}:mutate`, { method: "POST", headers, body: JSON.stringify({ operations }) });
  const log = [];
  for (const camp of (plataforma.campanhas || [])) {
    const G = gType(camp);
    if (G.group === "block") { log.push({ ok: true, soft: true, txt: `⏭️ "${camp.nome}" (${G.type}): precisa de ${G.needs} — configure no Google e monte por lá.` }); continue; }
    const monthly = Number(camp.monthly) || 0;
    const dailyMicros = Math.max(Math.round((monthly / 30) || 30), 1) * 1e6;
    try {
      const bres = await mut("campaignBudgets", [{ create: { name: `${camp.nome || "Campanha"} ${Date.now()}`, amountMicros: dailyMicros, deliveryMethod: "STANDARD", explicitlyShared: false } }]);
      const budget = bres.results[0].resourceName;
      const campCreate = { name: `${camp.nome || "Campanha"} [RASCUNHO]`, status: "PAUSED", advertisingChannelType: G.type, campaignBudget: budget, ...G.bid, containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING" };
      if (G.net) campCreate.networkSettings = G.net;
      // PMax: desliga "Brand Guidelines" (senão exige nome de empresa vinculado)
      if (G.type === "PERFORMANCE_MAX") campCreate.brandGuidelinesEnabled = false;
      const cres = await mut("campaigns", [{ create: campCreate }]);
      const campaignRes = cres.results[0].resourceName; const campId = campaignRes.split("/").pop();
      log.push({ ok: true, txt: `✅ Campanha "${camp.nome}" (${G.type}) criada pausada (id ${campId})` });

      // PERFORMANCE MAX: o grupo de recursos exige texto + logo + imagem 1.91:1 (que o criativo social não tem).
      // Subimos os criativos pra biblioteca e a montagem do grupo finaliza no Google.
      if (G.group === "asset") {
        let upN = 0;
        for (const cj of (camp.conjuntos || [])) for (const ad of (cj.anuncios || [])) { const src = ad.imageUrl || ad.imagePath; if (src) { try { if (await googleImageAsset(cid, headers, ad.nome || "criativo", src)) upN++; } catch {} } }
        log.push({ ok: true, soft: true, txt: `　ℹ️ PMax: campanha criada. ${upN} criativo(s) enviado(s) pra BIBLIOTECA da conta. Finalize o grupo de recursos no Google (precisa de logo + títulos + descrições + imagem 1.91:1).` });
        continue;
      }
      // VÍDEO / DEMAND GEN: campanha só (criativo precisa de vídeo do YouTube / mídia)
      if (G.group === "campaignOnly") {
        log.push({ ok: true, soft: true, txt: `　ℹ️ ${G.type}: monte os grupos e o criativo no Google (precisa de ${G.type === "VIDEO" ? "vídeo do YouTube" : "mídia/criativo"}).` });
        continue;
      }

      // SEARCH / DISPLAY: têm ad group
      const agType = G.type === "DISPLAY" ? "DISPLAY_STANDARD" : "SEARCH_STANDARD";
      for (const grupo of (camp.conjuntos || [])) {
        const ares = await mut("adGroups", [{ create: { name: grupo.nome || "Grupo", campaign: campaignRes, status: "PAUSED", type: agType, cpcBidMicros: 1e6 } }]);
        const agRes = ares.results[0].resourceName;
        log.push({ ok: true, txt: `　✅ Grupo "${grupo.nome}" criado (id ${agRes.split("/").pop()})` });
        if (G.type === "SEARCH") {
          const kws = String(grupo.keywords || "").split("\n").map((l) => l.trim()).filter(Boolean).map(gKwMatch);
          if (kws.length) {
            try {
              const ops = kws.map((k) => ({ create: { adGroup: agRes, status: "ENABLED", keyword: { text: cleanKeyword(k.text), matchType: k.matchType } } })).filter((o) => o.create.keyword.text);
              const kr = await googleAdsApi(`customers/${cid}/adGroupCriteria:mutate`, { method: "POST", headers, body: JSON.stringify({ operations: ops, partialFailure: true }) });
              log.push({ ok: true, txt: `　　✅ ${mutateSummary(kr).ok}/${ops.length} palavra(s)-chave no grupo` });
            } catch (e) { log.push({ ok: false, txt: `　　❌ palavras-chave: ${e.message}` }); }
          }
          for (const ad of (grupo.anuncios || [])) {
            const heads = (Array.isArray(ad.headlines) ? ad.headlines : [ad.headlines]).map((x) => String(x || "").trim()).filter(Boolean).slice(0, 15);
            const descs = (Array.isArray(ad.descriptions) ? ad.descriptions : [ad.descriptions]).map((x) => String(x || "").trim()).filter(Boolean).slice(0, 4);
            const url = ad.finalUrl || ad.url;
            if (heads.length < 3 || descs.length < 2 || !url) { log.push({ ok: true, soft: true, txt: `　　⏭️ Anúncio "${ad.nome || ""}": precisa de ≥3 títulos, ≥2 descrições e 1 URL — complete no Google.` }); continue; }
            try {
              await mut("adGroupAds", [{ create: { adGroup: agRes, status: "PAUSED", ad: { finalUrls: [url], responsiveSearchAd: { headlines: heads.map((t) => ({ text: t })), descriptions: descs.map((t) => ({ text: t })) } } } }]);
              log.push({ ok: true, txt: `　　✅ Anúncio RSA "${ad.nome || ""}" criado pausado` });
            } catch (e) { log.push({ ok: false, txt: `　　❌ Anúncio "${ad.nome || ""}": ${e.message}` }); }
          }
        } else if (G.type === "DISPLAY") {
          // 1) segmentação: público personalizado (interesses + sites semelhantes) anexado ao grupo
          const { interesses, sites } = parseTargeting(grupo);
          if (interesses.length || sites.length) {
            try {
              const aud = await googleCustomAudience(cid, headers, `${camp.nome} · ${grupo.nome}`, interesses, sites);
              if (aud) {
                await mut("adGroupCriteria", [{ create: { adGroup: agRes, customAudience: { customAudience: aud } } }]);
                log.push({ ok: true, txt: `　　✅ Segmentação aplicada: ${interesses.length} interesse(s) + ${sites.length} site(s) semelhante(s)` });
              }
            } catch (e) { log.push({ ok: false, txt: `　　❌ segmentação: ${e.message}` }); }
          }
          // 2) criativos → biblioteca de assets (prontos pra usar). O anúncio de Display em si
          // finaliza no Google: criativo social 1080² não é tamanho de anúncio de imagem, e o
          // responsivo de Display exige logo + texto + imagem 1.91:1 (que o social não fornece).
          let upN = 0;
          for (const ad of (grupo.anuncios || [])) { const src = ad.imageUrl || ad.imagePath; if (src) { try { if (await googleImageAsset(cid, headers, ad.nome || "criativo", src)) upN++; } catch {} } }
          if (upN) log.push({ ok: true, soft: true, txt: `　　ℹ️ ${upN} criativo(s) enviado(s) pra BIBLIOTECA da conta. Crie o anúncio de Display no Google selecionando essas imagens (o Google completa logo + texto da conta).` });
        }
      }
    } catch (e) { log.push({ ok: false, txt: `❌ Campanha "${camp.nome}": ${e.message}` }); }
  }
  return { log, accountId: cid };
});

// GA4: sessões por canal no período (pra Taxa de Conexão: sessões ÷ cliques)
async function ga4Sessions(propertyId, start, end) {
  const s = readStore().settings;
  if (!propertyId || !s.googleAdsRefreshToken) return null;
  const at = await googleAdsAccessToken(s); // mesmo OAuth (precisa do escopo analytics.readonly)
  const pid = String(propertyId).replace(/[^0-9]/g, "");
  const r = await httpJson(`https://analyticsdata.googleapis.com/v1beta/properties/${pid}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: start, endDate: end }],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }],
    }),
  });
  const byChannel = {}; let total = 0;
  (r.rows || []).forEach((row) => {
    const ch = row.dimensionValues[0].value; const n = Number(row.metricValues[0].value || 0);
    byChannel[ch] = n; total += n;
  });
  // mapeia canais do GA4 → plataformas do painel
  const paidSearch = byChannel["Paid Search"] || 0;
  const paidSocial = byChannel["Paid Social"] || 0;
  return { byChannel, total, google: paidSearch, meta: paidSocial };
}
ipcMain.handle("ga4:sessions", async (_e, { propertyId, start, end }) => ga4Sessions(propertyId, start, end));


// Google Ads DIRETO da conta, em árvore (campanha → grupo → anúncio) com nomes certos
async function googleWeekData(customerId, start, end) {
  const s = readStore().settings;
  if (!s.googleAdsRefreshToken || !customerId) return null;
  const cid = String(customerId).replace(/-/g, "");
  const headers = await gadsHeaders();
  const run = async (sel, from, extraWhere) => {
    // só campanhas ATIVAS e COM DADOS no período (impressões > 0)
    const query = `SELECT ${sel} FROM ${from} WHERE segments.date BETWEEN '${start}' AND '${end}' AND campaign.status = 'ENABLED' AND metrics.impressions > 0${extraWhere || ""}`;
    let pt = null, rows = [];
    do { const body = JSON.stringify(pt ? { query, pageToken: pt } : { query }); const r = await googleAdsApi(`customers/${cid}/googleAds:search`, { method: "POST", headers, body }); rows = rows.concat(r.results || []); pt = r.nextPageToken; } while (pt && rows.length < 600);
    return rows;
  };
  const M = (m = {}) => ({ impressions: Number(m.impressions || 0), clicks: Number(m.clicks || 0), conversions: Number(m.conversions || 0), cost: Number(m.costMicros || 0) / 1e6, cpc: Number(m.averageCpc || 0) / 1e6 });
  const METRICS = "metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros, metrics.average_cpc";
  const camps = await run(`campaign.id, campaign.name, ${METRICS}`, "campaign");
  const ags = await run(`campaign.id, ad_group.id, ad_group.name, ${METRICS}`, "ad_group", " AND ad_group.status = 'ENABLED'");
  const ads = await run(`campaign.id, ad_group.id, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.responsive_search_ad.headlines, ${METRICS}`, "ad_group_ad", " AND ad_group_ad.status = 'ENABLED'");
  const rows = [], totals = { impressions: 0, clicks: 0, conversions: 0, cost: 0 };
  for (const c of camps) {
    const cm = M(c.metrics); totals.impressions += cm.impressions; totals.clicks += cm.clicks; totals.conversions += cm.conversions; totals.cost += cm.cost;
    rows.push({ level: "campaign", name: (c.campaign && c.campaign.name) || "(campanha)", metrics: cm });
    for (const a of ags.filter((x) => x.campaign.id === c.campaign.id)) {
      rows.push({ level: "audience", name: (a.adGroup && a.adGroup.name) || "(grupo)", metrics: M(a.metrics) });
      for (const ad of ads.filter((x) => x.adGroup.id === a.adGroup.id).slice(0, 12)) {
        const A = ad.adGroupAd && ad.adGroupAd.ad;
        const hl = A && A.responsiveSearchAd && A.responsiveSearchAd.headlines;
        const nm = (A && A.name) || (hl && hl[0] && hl[0].text) || `Anúncio ${A ? A.id : ""}`;
        rows.push({ level: "ad", name: nm, metrics: M(ad.metrics) });
      }
    }
  }
  if (!rows.length) return null;
  return { platform: "google", slug: "google_adwords", name: "Google (API)", source: "google_api", rows, totals };
}

// PageSpeed Insights: performance do site (0-100) + métricas-chave
ipcMain.handle("pagespeed:check", async (_e, { url, strategy }) => {
  const s = readStore().settings;
  if (!s.pageSpeedKey) throw new Error("Configure a chave do PageSpeed em Configurações.");
  if (!url) throw new Error("Cliente sem site vinculado.");
  const u = /^https?:\/\//.test(url) ? url : `https://${url}`;
  const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(u)}&strategy=${strategy || "MOBILE"}&category=PERFORMANCE&key=${encodeURIComponent(s.pageSpeedKey)}`;
  const r = await httpJson(api);
  const lh = r.lighthouseResult || {};
  const score = lh.categories && lh.categories.performance ? Math.round(lh.categories.performance.score * 100) : null;
  const a = lh.audits || {};
  const metric = (k) => a[k] && a[k].displayValue;
  return { score, lcp: metric("largest-contentful-paint"), cls: metric("cumulative-layout-shift"), tbt: metric("total-blocking-time"), fcp: metric("first-contentful-paint"), strategy: strategy || "MOBILE", url: u };
});

/* ---- Meta Insights: dados da semana DIRETO da conta de anúncio (mais fiel que o Reportei) ---- */
// garante o prefixo act_ — sem ele o Graph trata o ID como Página e devolve "#190 Page Access Token"
const actId = (id) => { id = String(id || "").trim().replace(/^act_/, ""); return id ? "act_" + id : ""; };
async function metaInsights(accountId, tok, start, end, level) {
  accountId = actId(accountId);
  const tr = encodeURIComponent(JSON.stringify({ since: start, until: end }));
  // campos de identificação (pra montar a árvore campanha→público→anúncio)
  const idFields = { campaign: ["campaign_id", "campaign_name"], adset: ["campaign_id", "adset_id", "adset_name"], ad: ["campaign_id", "adset_id", "ad_id", "ad_name"] }[level] || [];
  const fields = idFields.concat(["impressions", "reach", "inline_link_clicks", "inline_link_click_ctr", "clicks", "ctr", "spend", "actions"]);
  let url = `${GRAPH}/${accountId}/insights?fields=${fields.join(",")}&time_range=${tr}&limit=400&access_token=${encodeURIComponent(tok)}`;
  if (level) url += `&level=${level}`;
  // só ATIVOS (campanha/conjunto/anúncio com veiculação ativa)
  if (level) {
    const f = JSON.stringify([{ field: `${level}.effective_status`, operator: "IN", value: ["ACTIVE"] }]);
    url += `&filtering=${encodeURIComponent(f)}`;
  }
  const r = await httpJson(url);
  return r.data || [];
}
function metaMetricsFrom(row) {
  const num = (x) => (x == null || x === "" ? null : Number(x));
  const acts = row.actions || [];
  const act = (t) => { const a = acts.find((x) => x.action_type === t); return a ? Number(a.value) : null; };
  // leads: usa o tipo unificado 'lead'; se não houver, cai pro pixel/lead form (sem somar p/ não duplicar)
  const leads = act("lead") ?? act("offsite_conversion.fb_pixel_lead") ?? act("leadgen_grouped") ?? act("onsite_conversion.lead_grouped") ?? 0;
  const linkClicks = num(row.inline_link_clicks);
  const clicks = linkClicks != null ? linkClicks : num(row.clicks); // CTR de LINK (modelo dela)
  const ctr = row.inline_link_click_ctr != null ? Number(row.inline_link_click_ctr) : (row.ctr != null ? Number(row.ctr) : null);
  const spend = num(row.spend);
  return { impressions: num(row.impressions), reach: num(row.reach), clicks, ctr, leads, spend, cpl: (spend != null && leads) ? spend / leads : null };
}
async function metaWeekData(accountId, start, end) {
  const s = readStore().settings; const tok = s.metaToken;
  if (!tok || !accountId) return null;
  const campRaw = await metaInsights(accountId, tok, start, end, "campaign");
  // totais = soma só das campanhas ATIVAS (não o resumo da conta, que inclui pausadas)
  const totals = campRaw.reduce((t, c) => {
    const m = metaMetricsFrom(c);
    ["impressions", "reach", "clicks", "leads", "spend"].forEach((k) => { if (m[k] != null) t[k] = (t[k] || 0) + m[k]; });
    return t;
  }, {});
  if (totals.spend != null && totals.leads) totals.cpl = totals.spend / totals.leads;
  const adsetRaw = await metaInsights(accountId, tok, start, end, "adset");
  const adRaw = await metaInsights(accountId, tok, start, end, "ad");
  // só itens COM DADOS (impressões/cliques/gasto) — descarta campanha ativa sem veiculação
  const hasData = (m) => (m.impressions || 0) > 0 || (m.clicks || 0) > 0 || (m.spend || 0) > 0;
  // monta a ÁRVORE: campanha → seus públicos → os anúncios daquele público
  const rows = [];
  for (const c of campRaw) {
    const cm = metaMetricsFrom(c); if (!hasData(cm)) continue;
    rows.push({ level: "campaign", name: c.campaign_name || "(campanha)", metrics: cm });
    const myAdsets = adsetRaw.filter((a) => a.campaign_id === c.campaign_id);
    for (const a of myAdsets) {
      const am = metaMetricsFrom(a); if (!hasData(am)) continue;
      rows.push({ level: "audience", name: a.adset_name || "(público)", metrics: am });
      const myAds = adRaw.filter((x) => x.adset_id === a.adset_id).slice(0, 12);
      for (const ad of myAds) { const dm = metaMetricsFrom(ad); if (!hasData(dm)) continue; rows.push({ level: "ad", name: ad.ad_name || "(anúncio)", metrics: dm }); }
    }
  }
  if (!rows.length && !Object.values(totals).some((v) => v != null)) return null;
  if (!rows.length) rows.push({ level: "campaign", name: "Total da conta", metrics: totals });
  return { platform: "meta", slug: "facebook_ads", name: "Meta (API)", source: "meta_api", rows, totals };
}

// lista as Páginas que o token acessa (anúncio é publicado em nome de uma Página)
ipcMain.handle("meta:pages", async () => {
  const s = readStore().settings;
  if (!s.metaToken) throw new Error("Cole o token do Meta.");
  const r = await httpJson(`${GRAPH}/me/accounts?fields=name,id&limit=100&access_token=${encodeURIComponent(s.metaToken)}`);
  return (r.data || []).map((p) => ({ id: p.id, name: p.name }));
});

// verificador de permissões: o que o token JÁ tem e o que falta pra cada recurso
ipcMain.handle("meta:permissions", async () => {
  const s = readStore().settings;
  if (!s.metaToken) throw new Error("Cole o token de acesso do Meta em Configurações.");
  const tok = encodeURIComponent(s.metaToken);
  const r = await httpJson(`${GRAPH}/me/permissions?access_token=${tok}`);
  const granted = new Set((r.data || []).filter((p) => p.status === "granted").map((p) => p.permission));
  // quantas Páginas o token enxerga (anúncio precisa de Página)
  let pages = [];
  try { const pg = await httpJson(`${GRAPH}/me/accounts?fields=name&limit=50&access_token=${tok}`); pages = (pg.data || []).map((p) => p.name); } catch {}
  const REQS = [
    { perm: "ads_management", label: "Criar campanha / conjunto / anúncio", essencial: true },
    { perm: "ads_read", label: "Ler métricas e contas", essencial: false },
    { perm: "pages_show_list", label: "Listar Páginas do cliente", essencial: true },
    { perm: "pages_read_engagement", label: "Ler dados da Página", essencial: true },
    { perm: "pages_manage_ads", label: "Publicar anúncio em nome da Página", essencial: true },
    { perm: "business_management", label: "Acessar ativos do Business (conta + página)", essencial: true },
  ];
  return {
    checks: REQS.map((x) => ({ ...x, ok: granted.has(x.perm) })),
    granted: [...granted],
    pages,
    podeCampanha: granted.has("ads_management"),
    podeCriativo: ["ads_management", "pages_manage_ads", "pages_show_list"].every((p) => granted.has(p)) && pages.length > 0,
  };
});

// mapas: opções da pré-estrutura (PT) → enums oficiais da API do Meta
const META_OBJ = {
  "Reconhecimento": "OUTCOME_AWARENESS", "Tráfego": "OUTCOME_TRAFFIC", "Engajamento": "OUTCOME_ENGAGEMENT",
  "Leads": "OUTCOME_LEADS", "Promoção do app": "OUTCOME_APP_PROMOTION", "Vendas": "OUTCOME_SALES",
};
const META_OPT = {
  "Maximizar número de leads": "LEAD_GENERATION", "Maximizar número de conversões": "OFFSITE_CONVERSIONS",
  "Cliques no link": "LINK_CLICKS", "Visualizações da página de destino": "LANDING_PAGE_VIEWS",
  "Alcance único diário": "REACH", "Impressões": "IMPRESSIONS", "ThruPlay (vídeo)": "THRUPLAY", "Conversas": "CONVERSATIONS",
};

// CTA da pré-estrutura (PT) → enum do Meta
const META_CTA = {
  "Saiba mais": "LEARN_MORE", "Cadastre-se": "SIGN_UP", "Comprar agora": "SHOP_NOW", "Fale conosco": "CONTACT_US",
  "Enviar mensagem": "MESSAGE_PAGE", "Enviar mensagem pelo WhatsApp": "WHATSAPP_MESSAGE", "Baixar": "DOWNLOAD",
  "Obter oferta": "GET_OFFER", "Obter orçamento": "GET_QUOTE", "Inscrever-se": "SUBSCRIBE", "Ligar agora": "CALL_NOW",
  "Agendar horário": "BOOK_TRAVEL", "Assistir mais": "WATCH_MORE",
};

// sobe a imagem do criativo pra conta e devolve o image_hash (aceita URL pública ou base64 data:)
async function metaUploadImage(accountId, tok, imageUrl) {
  // aceita data URL, caminho local (lê do disco) ou URL pública
  if (imageUrl && !/^(data:|https?:)/.test(imageUrl)) { try { imageUrl = readImageDataUrl(imageUrl); } catch {} }
  const body = new URLSearchParams({ access_token: tok });
  if (String(imageUrl).startsWith("data:")) body.set("bytes", String(imageUrl).split(",")[1]);
  else body.set("url", imageUrl);
  const r = await httpJson(`${GRAPH}/${accountId}/adimages`, { method: "POST", body });
  const imgs = r.images || {};
  const first = Object.values(imgs)[0];
  return first && first.hash;
}

// normaliza um campo em lista de strings não-vazias (aceita array ou valor único)
const toArr = (v) => (Array.isArray(v) ? v : v != null ? [v] : []).map((x) => String(x).trim()).filter(Boolean);

// sobe vídeo pra conta (multipart), espera processar e devolve {videoId, thumbUrl}
async function metaUploadVideo(accountId, tok, videoUrl) {
  const form = new FormData();
  form.append("access_token", tok);
  if (String(videoUrl).startsWith("data:")) {
    const b64 = String(videoUrl).split(",")[1];
    const buf = Buffer.from(b64, "base64");
    form.append("source", new Blob([buf], { type: "video/mp4" }), "video.mp4");
  } else {
    form.append("file_url", videoUrl);
  }
  const up = await fetch(`${GRAPH}/${accountId}/advideos`, { method: "POST", body: form });
  const upBody = await up.json().catch(() => ({}));
  if (!up.ok) throw new Error((upBody.error && (upBody.error.error_user_msg || upBody.error.message)) || "falha no upload do vídeo");
  const videoId = upBody.id;
  // o vídeo processa de forma assíncrona — espera ficar "ready" (até ~2min)
  let ready = false;
  for (let i = 0; i < 30; i++) {
    await sleep(4000);
    const st = await httpJson(`${GRAPH}/${videoId}?fields=status&access_token=${encodeURIComponent(tok)}`);
    const vs = st.status && st.status.video_status;
    if (vs === "ready") { ready = true; break; }
    if (vs === "error") throw new Error("o Meta não conseguiu processar este vídeo");
  }
  if (!ready) throw new Error("o vídeo ainda está processando no Meta — tente de novo em 1 min");
  // miniatura (obrigatória no criativo de vídeo): pega a preferida que o Meta gerou
  let thumbUrl = null;
  try {
    const th = await httpJson(`${GRAPH}/${videoId}/thumbnails?access_token=${encodeURIComponent(tok)}`);
    const t = (th.data || []).find((x) => x.is_preferred) || (th.data || [])[0];
    thumbUrl = t && t.uri;
  } catch {}
  return { videoId, thumbUrl };
}

// cria criativo + anúncio (PAUSED) dentro de um conjunto já criado
async function metaCreateAd(accountId, tok, pageId, adsetId, ad) {
  let texts = toArr(ad.primaryTexts); if (!texts.length) texts = toArr(ad.descricao || ad.copy || ad.nome);
  let titles = toArr(ad.headlines); if (!titles.length) titles = toArr(ad.nome);
  const descs = toArr(ad.descriptions);
  const link = ad.url || ad.finalUrl || `https://facebook.com/${pageId}`;
  const ctaType = (ad.cta && META_CTA[ad.cta]) || "LEARN_MORE";
  const multi = texts.length > 1 || titles.length > 1 || descs.length > 1;
  let spec;

  // VÍDEO tem prioridade: se houver, sobe o vídeo e monta criativo de vídeo
  if (ad.videoUrl) {
    const { videoId, thumbUrl } = await metaUploadVideo(accountId, tok, ad.videoUrl);
    if (multi) {
      const afs = {
        ad_formats: ["SINGLE_VIDEO"],
        videos: [{ video_id: videoId, thumbnail_url: thumbUrl }],
        bodies: texts.map((t) => ({ text: t })),
        titles: titles.map((t) => ({ text: t })),
        link_urls: [{ website_url: link }],
        call_to_action_types: [ctaType],
      };
      if (descs.length) afs.descriptions = descs.map((t) => ({ text: t }));
      spec = { page_id: pageId, asset_feed_spec: afs };
    } else {
      const videoData = { video_id: videoId, title: titles[0] || "", message: texts[0] || "" };
      if (thumbUrl) videoData.image_url = thumbUrl;
      if (descs[0]) videoData.link_description = descs[0];
      if (ad.cta && META_CTA[ad.cta]) videoData.call_to_action = { type: ctaType, value: { link } };
      spec = { page_id: pageId, video_data: videoData };
    }
    const crv = await httpJson(`${GRAPH}/${accountId}/adcreatives`, {
      method: "POST",
      body: new URLSearchParams({ name: `${ad.nome || "Criativo"} [RASCUNHO]`, object_story_spec: JSON.stringify(spec), access_token: tok }),
    });
    const adv = await httpJson(`${GRAPH}/${accountId}/ads`, {
      method: "POST",
      body: new URLSearchParams({ name: `${ad.nome || "Anúncio"} [RASCUNHO]`, adset_id: adsetId, creative: JSON.stringify({ creative_id: crv.id }), status: "PAUSED", access_token: tok }),
    });
    return adv.id;
  }

  let imageHash = null;
  const imgSrc = ad.imageUrl || ad.imagePath;
  if (imgSrc) { try { imageHash = await metaUploadImage(accountId, tok, imgSrc); } catch {} }

  if (imageHash && multi) {
    // criativo flexível (Advantage+): manda TODAS as variações; o Meta testa entre elas
    const afs = {
      ad_formats: ["SINGLE_IMAGE"],
      images: [{ hash: imageHash }],
      bodies: texts.map((t) => ({ text: t })),
      titles: titles.map((t) => ({ text: t })),
      link_urls: [{ website_url: link }],
      call_to_action_types: [ctaType],
    };
    if (descs.length) afs.descriptions = descs.map((t) => ({ text: t }));
    spec = { page_id: pageId, asset_feed_spec: afs };
  } else {
    // 1 de cada (sem imagem não dá pra usar o flexível)
    const linkData = { message: texts[0] || "", link, name: titles[0] || "" };
    if (descs[0]) linkData.description = descs[0];
    if (ad.cta && META_CTA[ad.cta]) linkData.call_to_action = { type: ctaType, value: { link } };
    if (imageHash) linkData.image_hash = imageHash;
    spec = { page_id: pageId, link_data: linkData };
  }
  const cr = await httpJson(`${GRAPH}/${accountId}/adcreatives`, {
    method: "POST",
    body: new URLSearchParams({ name: `${ad.nome || "Criativo"} [RASCUNHO]`, object_story_spec: JSON.stringify(spec), access_token: tok }),
  });
  const adRes = await httpJson(`${GRAPH}/${accountId}/ads`, {
    method: "POST",
    body: new URLSearchParams({ name: `${ad.nome || "Anúncio"} [RASCUNHO]`, adset_id: adsetId, creative: JSON.stringify({ creative_id: cr.id }), status: "PAUSED", access_token: tok }),
  });
  return adRes.id;
}

ipcMain.handle("upload:meta", async (_e, { accountId, plataforma, clientName, beneficiary, payor, pageId }) => {
  const s = readStore().settings;
  if (!s.metaToken) throw new Error("Configure o token do Meta.");
  if (!accountId) throw new Error("Cliente sem conta de anúncio do Meta vinculada (act_...).");
  // beneficiário/pagador (exigência DSA do Meta p/ Brasil): precisa ser o nome VERIFICADO no Meta.
  // Usa o que ela configurou em "contas"; senão cai pro nome do cliente/conta (pode não passar se não verificado).
  let dsaBenef = (beneficiary || clientName || "").trim();
  if (!dsaBenef) { try { const acc = await httpJson(`${GRAPH}/${accountId}?fields=name&access_token=${encodeURIComponent(s.metaToken)}`); dsaBenef = acc && acc.name; } catch {} }
  dsaBenef = dsaBenef || "Anunciante";
  const dsaPayor = (payor || "").trim() || dsaBenef;
  const tok = s.metaToken;
  const log = [];
  const campaignsCreated = [];
  // objetivos de conversão (Vendas/Leads) exigem um "objeto promovido" no conjunto = Pixel + evento.
  // Busca o pixel da conta uma vez; se houver, anexamos automaticamente.
  let pixelId = null;
  try {
    const px = await httpJson(`${GRAPH}/${accountId}/adspixels?fields=id,name&access_token=${encodeURIComponent(tok)}`);
    pixelId = px && px.data && px.data[0] && px.data[0].id;
  } catch {}
  for (const camp of (plataforma.campanhas || [])) {
    const objective = META_OBJ[camp.objetivo] || "OUTCOME_LEADS";
    const cbo = String(camp.tipoVerba || "").startsWith("CBO");
    const monthly = Number(camp.monthly) || 0;
    const body = new URLSearchParams({
      name: `${camp.nome || "Campanha"} [RASCUNHO]`, objective, status: "PAUSED",
      special_ad_categories: "[]", access_token: tok,
    });
    if (cbo && monthly) { body.set("daily_budget", String(Math.max(1, Math.round(monthly / 30)) * 100)); body.set("bid_strategy", "LOWEST_COST_WITHOUT_CAP"); }
    // Meta exige declarar isto quando a verba NÃO está na campanha (modo ABO): conjuntos com verba própria, sem compartilhar.
    if (!(cbo && monthly)) body.set("is_adset_budget_sharing_enabled", "false");
    let cres;
    try {
      cres = await httpJson(`${GRAPH}/${accountId}/campaigns`, { method: "POST", body });
      campaignsCreated.push({ id: cres.id, name: camp.nome });
      log.push({ ok: true, txt: `✅ Campanha "${camp.nome}" criada pausada (id ${cres.id})${camp.objetivo ? ` · objetivo ${camp.objetivo}` : ""}` });
    } catch (e) { log.push({ ok: false, txt: `❌ Campanha "${camp.nome}": ${e.message}` }); continue; }
    // A otimização é DERIVADA DO OBJETIVO (garante compatibilidade) — não da escolha do conjunto,
    // que poderia conflitar (ex.: objetivo Tráfego com otimização de conversão).
    // SAFE_OPT: goal compatível com cada objetivo. Conversão usa OFFSITE_CONVERSIONS (precisa pixel).
    const SAFE_OPT = {
      OUTCOME_TRAFFIC: "LINK_CLICKS", OUTCOME_AWARENESS: "REACH", OUTCOME_ENGAGEMENT: "REACH",
      OUTCOME_LEADS: "OFFSITE_CONVERSIONS", OUTCOME_SALES: "OFFSITE_CONVERSIONS", OUTCOME_APP_PROMOTION: "LINK_CLICKS",
    };
    const isConv = objective === "OUTCOME_SALES" || objective === "OUTCOME_LEADS";
    const conjuntos = camp.conjuntos || [];
    for (const cj of conjuntos) {
      const daily = Number(cj.daily) || (monthly ? Math.max(6, Math.round(monthly / 30 / (conjuntos.length || 1))) : 10);
      let optGoal = SAFE_OPT[objective] || "LINK_CLICKS";
      let promoted = null, promoNote = "";
      if (isConv) {
        if (pixelId) {
          const ev = objective === "OUTCOME_SALES" ? "PURCHASE" : "LEAD";
          promoted = { pixel_id: pixelId, custom_event_type: ev };
          promoNote = ` · otimizando p/ ${ev}`;
        } else {
          optGoal = "REACH"; // sem pixel não dá conversão → rascunho por alcance
          promoNote = " · ⚠️ sem Pixel: criado por alcance, ajuste a conversão no Meta";
        }
      }
      const baseParams = () => {
        const p = new URLSearchParams({
          name: cj.nome || "Conjunto", campaign_id: cres.id, status: "PAUSED",
          billing_event: "IMPRESSIONS", bid_strategy: "LOWEST_COST_WITHOUT_CAP",
          targeting: JSON.stringify({ geo_locations: { countries: ["BR"] } }),
          dsa_beneficiary: dsaBenef, dsa_payor: dsaPayor, access_token: tok,
        });
        if (!cbo) p.set("daily_budget", String(daily * 100));
        return p;
      };
      const p = baseParams();
      p.set("optimization_goal", optGoal);
      if (promoted) p.set("promoted_object", JSON.stringify(promoted));
      let created = null;
      try {
        created = await httpJson(`${GRAPH}/${accountId}/adsets`, { method: "POST", body: p });
      } catch (e) {
        // rede de segurança: se reclamou de objeto promovido, refaz como ALCANCE (nunca exige objeto)
        if (/promovid|promoted/i.test(e.message)) {
          const p2 = baseParams(); p2.set("optimization_goal", "REACH");
          try { created = await httpJson(`${GRAPH}/${accountId}/adsets`, { method: "POST", body: p2 }); promoNote = " · (criado por alcance — ajuste a otimização no Meta)"; }
          catch (e2) { pushAdsetErr(cj, e2); }
        } else { pushAdsetErr(cj, e); }
      }
      if (created) log.push({ ok: true, txt: `　✅ Conjunto "${cj.nome}" criado pausado (id ${created.id})${promoNote}` });
      // anúncios: cria criativo + ad PAUSED dentro do conjunto (precisa de Página vinculada)
      const anuncios = cj.anuncios || [];
      if (anuncios.length && created) {
        if (!pageId) {
          log.push({ ok: true, soft: true, txt: `　⏭️ ${anuncios.length} anúncio(s): vincule a Página do cliente em "contas" pra subir o criativo.` });
        } else {
          for (const ad of anuncios) {
            try {
              const adId = await metaCreateAd(accountId, tok, pageId, created.id, ad);
              log.push({ ok: true, txt: `　　✅ Anúncio "${ad.nome || "sem nome"}" criado pausado (id ${adId})` });
            } catch (e) { log.push({ ok: false, txt: `　　❌ Anúncio "${ad.nome || "sem nome"}": ${e.message}` }); }
          }
        }
      }
    }
  }
  return { log, campaigns: campaignsCreated, accountId };

  // erro de conjunto: se for o muro DSA/verificação do Brasil, mostra como passo a finalizar no Meta (não erro)
  function pushAdsetErr(cj, e) {
    if (/anunciante verificado|verified advertiser|benefici|dsa/i.test(e.message || "")) {
      log.push({ ok: true, soft: true, txt: `　⏭️ Conjunto "${cj.nome}": finalize no Gerenciador — o Meta exige verificação de beneficiário (DSA Brasil) que só é feita lá.` });
    } else {
      log.push({ ok: false, txt: `　❌ Conjunto "${cj.nome}": ${e.message}` });
    }
  }
});

/* ---- Google Ads (estrutura pronta; precisa de developer token + OAuth) ---- */
async function googleAdsAccessToken(s) {
  const body = new URLSearchParams({
    client_id: s.googleAdsClientId, client_secret: s.googleAdsClientSecret,
    refresh_token: s.googleAdsRefreshToken, grant_type: "refresh_token",
  });
  const r = await httpJson("https://oauth2.googleapis.com/token", { method: "POST", body });
  return r.access_token;
}
// "Conectar com Google": abre o consentimento no navegador, captura o code num
// servidor local de redirect e troca pelo refresh_token. Salva tudo nas settings.
ipcMain.handle("googleads:connect", async (_e, { clientId, clientSecret }) => {
  if (!clientId || !clientSecret) throw new Error("Cole o Client ID e o Client Secret primeiro.");
  const http = require("http");
  const PORT = 42813;
  const redirectUri = `http://localhost:${PORT}`;
  const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code",
    scope: "https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/tagmanager.edit.containers https://www.googleapis.com/auth/tagmanager.publish", access_type: "offline", prompt: "consent",
  }).toString();

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, redirectUri);
      const c = u.searchParams.get("code");
      const err = u.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<html><body style="font-family:sans-serif;background:#0b1018;color:#cdd6e3;text-align:center;padding-top:80px"><h2>${c ? "✅ Conectado!" : "❌ " + (err || "cancelado")}</h2><p>Pode fechar esta aba e voltar pro Painel.</p></body></html>`);
      server.close();
      if (c) resolve(c); else reject(new Error(err || "autorização cancelada"));
    });
    server.on("error", reject);
    server.listen(PORT, () => shell.openExternal(authUrl));
    setTimeout(() => { try { server.close(); } catch {} reject(new Error("tempo esgotado — tente de novo")); }, 180000);
  });

  const tok = await httpJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  if (!tok.refresh_token) throw new Error("o Google não devolveu refresh_token — refaça a autorização (precisa de prompt=consent).");
  const st = readStore();
  st.settings.googleAdsClientId = clientId;
  st.settings.googleAdsClientSecret = clientSecret;
  st.settings.googleAdsRefreshToken = tok.refresh_token;
  writeStore(st);
  return { ok: true };
});

// versões candidatas da Google Ads API (a API descontinua versões antigas ~3x/ano).
// tenta a salva primeiro, depois as candidatas, e guarda a que funcionar.
const GADS_VERSIONS = ["v21", "v20", "v19", "v18", "v17"];
async function googleAdsApi(pathAfterVersion, opts) {
  const s = readStore().settings;
  const order = s.googleAdsApiVersion ? [s.googleAdsApiVersion, ...GADS_VERSIONS.filter((v) => v !== s.googleAdsApiVersion)] : GADS_VERSIONS;
  let lastErr;
  for (const v of order) {
    try {
      const r = await httpJson(`https://googleads.googleapis.com/${v}/${pathAfterVersion}`, opts);
      if (v !== s.googleAdsApiVersion) { const st = readStore(); st.settings.googleAdsApiVersion = v; writeStore(st); }
      return r;
    } catch (e) { lastErr = e; if (e.status !== 404) throw e; }
  }
  throw lastErr;
}

ipcMain.handle("googleads:test", async () => {
  const s = readStore().settings;
  for (const k of ["googleAdsDevToken", "googleAdsClientId", "googleAdsClientSecret", "googleAdsRefreshToken"]) {
    if (!s[k]) throw new Error("Faltam credenciais do Google Ads (developer token + OAuth). Veja as instruções em Configurações.");
  }
  const at = await googleAdsAccessToken(s);
  const headers = { Authorization: `Bearer ${at}`, "developer-token": s.googleAdsDevToken };
  if (s.googleAdsLoginCustomerId) headers["login-customer-id"] = s.googleAdsLoginCustomerId;
  const r = await googleAdsApi("customers:listAccessibleCustomers", { headers });
  return (r.resourceNames || []).map((x) => x.replace("customers/", ""));
});

// headers padrão das chamadas Google Ads (com a MCC como login-customer-id)
async function gadsHeaders() {
  const s = readStore().settings;
  if (!s.googleAdsDevToken || !s.googleAdsRefreshToken) throw new Error("Conecte o Google Ads em Configurações.");
  const at = await googleAdsAccessToken(s);
  const h = { Authorization: `Bearer ${at}`, "developer-token": s.googleAdsDevToken, "Content-Type": "application/json" };
  if (s.googleAdsLoginCustomerId) h["login-customer-id"] = s.googleAdsLoginCustomerId.replace(/-/g, "");
  return h;
}

// TERMOS DE BUSCA reais que dispararam anúncios (pra negativação)
ipcMain.handle("googleads:searchTerms", async (_e, { customerId, start, end }) => {
  const cid = String(customerId || "").replace(/-/g, "");
  if (!cid) throw new Error("Cliente sem conta Google vinculada.");
  const headers = await gadsHeaders();
  // search_term_view.status diz se o termo JÁ foi negativado (EXCLUDED) ou virou palavra-chave (ADDED)
  const query = `SELECT search_term_view.search_term, search_term_view.status, campaign.id, campaign.name, ad_group.id, ad_group.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM search_term_view WHERE segments.date BETWEEN '${start}' AND '${end}' ORDER BY metrics.cost_micros DESC LIMIT 300`;
  let pageToken = null; const out = [];
  do {
    const body = JSON.stringify(pageToken ? { query, pageToken } : { query });
    const r = await googleAdsApi(`customers/${cid}/googleAds:search`, { method: "POST", headers, body });
    (r.results || []).forEach((row) => {
      const m = row.metrics || {};
      out.push({
        term: row.searchTermView && row.searchTermView.searchTerm,
        status: (row.searchTermView && row.searchTermView.status) || "NONE",
        campaignId: row.campaign && String(row.campaign.id), campaignName: row.campaign && row.campaign.name,
        adGroupId: row.adGroup && String(row.adGroup.id), adGroupName: row.adGroup && row.adGroup.name,
        impressions: Number(m.impressions || 0), clicks: Number(m.clicks || 0),
        cost: Number(m.costMicros || 0) / 1e6, conversions: Number(m.conversions || 0),
      });
    });
    pageToken = r.nextPageToken;
  } while (pageToken && out.length < 300);
  return out;
});

// limpa o texto da palavra-chave pras regras do Google (sem pontuação/símbolos proibidos, ≤80 char, ≤10 palavras)
function cleanKeyword(t) {
  let s = String(t || "").toLowerCase().replace(/[!@%^*()=\[\]{}|\\:;"'<>?~,.+]/g, " ").replace(/\s+/g, " ").trim();
  const words = s.split(" ").slice(0, 10); s = words.join(" ");
  return s.slice(0, 80).trim();
}
// conta sucessos numa resposta com partial_failure (results vazios = falha)
function mutateSummary(r) {
  const results = r.results || [];
  const ok = results.filter((x) => x && x.resourceName).length;
  let failMsg = "";
  if (r.partialFailureError) {
    try { (r.partialFailureError.details || []).forEach((d) => (d.errors || []).forEach((x) => { if (x.message && !failMsg) failMsg = x.message; })); } catch {}
    if (!failMsg) failMsg = r.partialFailureError.message || "alguns falharam";
  }
  return { ok, failMsg };
}

// NEGATIVA termos como palavras-chave negativas (nível campanha, correspondência exata)
ipcMain.handle("googleads:negate", async (_e, { customerId, items }) => {
  const cid = String(customerId || "").replace(/-/g, "");
  if (!cid) throw new Error("Cliente sem conta Google vinculada.");
  const headers = await gadsHeaders();
  const byCamp = {};
  (items || []).forEach((it) => { const t = cleanKeyword(it.text); if (t) (byCamp[it.campaignId] = byCamp[it.campaignId] || []).push(t); });
  const log = [];
  for (const [campId, terms] of Object.entries(byCamp)) {
    const uniq = [...new Set(terms)];
    const operations = uniq.map((t) => ({ create: { campaign: `customers/${cid}/campaigns/${campId}`, negative: true, keyword: { text: t, matchType: "EXACT" } } }));
    try {
      const r = await googleAdsApi(`customers/${cid}/campaignCriteria:mutate`, { method: "POST", headers, body: JSON.stringify({ operations, partialFailure: true }) });
      const { ok, failMsg } = mutateSummary(r);
      log.push({ ok: ok > 0, txt: `${ok > 0 ? "✅" : "❌"} ${ok}/${uniq.length} negativado(s) na campanha ${campId}${failMsg ? ` · ⚠️ ${failMsg}` : ""}` });
    } catch (e) { log.push({ ok: false, txt: `❌ campanha ${campId}: ${e.message}` }); }
  }
  return log;
});

// ADICIONA termos como palavras-chave positivas no grupo de anúncios (frase/ampla/exata)
/* ---------------------------------------------------------- */
/* CENTRAL GOOGLE ADS — planejamento guiado a partir da URL,    */
/* seguindo as skills da analista + políticas do Google Ads.    */
/* ---------------------------------------------------------- */
const GADS_POLICY = `POLÍTICAS DO GOOGLE ADS (obrigatório respeitar — NÃO ferir nenhuma):
- Conteúdo proibido: falsificações, produtos/serviços perigosos, atos desonestos, conteúdo impróprio/ofensivo.
- Práticas proibidas: uso indevido da rede, coleta indevida de dados, deturpação (promessas enganosas, "garantia" sem base, falsos descontos, milagres).
- Conteúdo restrito: bebidas, jogos/apostas, saúde/medicamentos, conteúdo adulto, político — só com requisitos específicos.
- Editorial/qualidade: SEM CAPS LOCK em palavra inteira, SEM pontuação repetida (!!!), sem símbolos/emojis fora de padrão, sem texto genérico ("clique aqui"), gramática correta, sem repetição.
- Marcas: não usar marca de terceiros indevidamente no texto.
- Limites RSA: título ≤30 caracteres, descrição ≤90 caracteres, caminho de exibição ≤15.
- Saúde/superlativos: evitar "melhor/nº1/100%/cura" sem comprovação verificável.`;

const PERSONA_PROMPT = `Você é um profissional de marketing que cria um documento de PERSONA completo para um anunciante do Google Ads, a partir do que o negócio é (e não é) e do conteúdo do site. Pesquise e entregue, organizado por tópicos:
- Problemas resolvidos: qual(is) problema(s) o que o negócio vende resolve.
- Concorrentes diretos (1-5) em TABELA: nome | site | Google Meu Negócio | Instagram.
- Concorrentes indiretos (1-5) em TABELA (mesmo problema, solução diferente): nome | site | GMN | Instagram.
- Fatores de confiança (5-10): o que as pessoas buscam pra confiar e comprar.
- Fatores de desistência: o que mais faz desistir da compra.
- 10 dúvidas sobre o produto/serviço.
- 10 dúvidas sobre a empresa.
- 10 desejos/sonhos do público.
- 10 objeções de compra — e como responder cada uma.
Português, pronto pra embasar campanha, criativo e copy. Sem markdown de título com #.`;

const RISCO_PROMPT = `Você é estrategista de tráfego pago. Faça uma ANÁLISE DE RISCO DE MERCADO / VIABILIDADE pra anunciar este negócio no Google Ads. Entregue:
- Viabilidade no Google Ads (a demanda existe? as pessoas buscam por isso? alto/médio/baixo).
- Nível de concorrência e CPC provável (qualitativo).
- Riscos de política do Google (o segmento tem restrição? ex.: saúde, finanças, etc.).
- Sazonalidade e maturidade do mercado.
- Sinal de verde/amarelo/vermelho pra investir, com justificativa.
- Recomendação de verba inicial e o que validar antes de escalar.
Português, objetivo. Sem markdown de título com #.`;

const ANUNCIOS_PROMPT = `Você é especialista em Google Ads (Search) com foco em Quality Score, CTR e conversão. Crie anúncios responsivos (RSA) pro negócio. Entregue:
**Títulos (15 — máx 30 caracteres cada)**: 5 com a palavra-chave, 3 com benefício/resultado, 3 com oferta/preço, 2 com prova social/autoridade, 2 com CTA. Mostre o texto e a contagem de caracteres de cada um.
**Descrições (4 — máx 90 caracteres cada)**: 2 de benefícios/diferenciais, 1 de oferta, 1 de CTA com urgência. Com contagem de caracteres.
**Extensões**: 4 sitelinks (título + descrição), 6 callouts, 1 snippet estruturado.
Inclua a palavra-chave nos 3 primeiros títulos. Respeite os limites. Português. Sem markdown de título com #.`;

ipcMain.handle("gads:plan", async (_e, { modulo, url, service, oQueNaoFaz, clientName, persona }) => {
  const s = readStore().settings;
  let pageTxt = "";
  if (url) {
    try {
      const u = /^https?:\/\//.test(url) ? url : "https://" + url;
      const html = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.text());
      pageTxt = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim().slice(0, 7000);
    } catch {}
  }
  const personaCtx = persona ? `\n\n== PERSONA JÁ DEFINIDA (use como base principal) ==\n${String(persona).slice(0, 6000)}` : "";
  const ctx = `\n\n== CONTEXTO DO CLIENTE ==\nCliente: ${clientName || ""}\nO que faz: ${service || "(ver site)"}\n${oQueNaoFaz ? "O que NÃO faz: " + oQueNaoFaz : ""}\nConteúdo do site (${url || "sem URL"}):\n${pageTxt || "(não li o site — use o que foi descrito)"}${personaCtx}`;
  const map = { persona: PERSONA_PROMPT, risco: RISCO_PROMPT, anuncios: ANUNCIOS_PROMPT + "\n\n" + GADS_POLICY };
  const base = map[modulo];
  if (!base) throw new Error("Módulo desconhecido.");
  return await aiAnalyze(s, base + ctx);
});

// PLANEJADOR DE PALAVRAS-CHAVE — volume real do Google (generateKeywordIdeas, igual o Keyword Planner)
ipcMain.handle("googleads:keywordIdeas", async (_e, { customerId, keywords, url }) => {
  const s = readStore().settings;
  // usa a conta do cliente; se não tiver, a própria MCC (manager também pode gerar ideias)
  const cid = String(customerId || s.googleAdsLoginCustomerId || "").replace(/-/g, "");
  if (!cid) throw new Error("Vincule a conta Google do cliente (ou configure a MCC).");
  const headers = await gadsHeaders();
  const kws = (keywords || []).map((k) => String(k).trim()).filter(Boolean).slice(0, 20);
  const u = url && /\./.test(url) ? (/^https?:\/\//.test(url) ? url : "https://" + url) : "";
  const body = {
    geoTargetConstants: ["geoTargetConstants/2076"], // Brasil
    language: "languageConstants/1014",               // Português
    keywordPlanNetwork: "GOOGLE_SEARCH",
  };
  if (kws.length && u) body.keywordAndUrlSeed = { url: u, keywords: kws };
  else if (kws.length) body.keywordSeed = { keywords: kws };
  else if (u) body.urlSeed = { url: u };
  else throw new Error("Informe palavras-semente ou um site.");
  const r = await googleAdsApi(`customers/${cid}:generateKeywordIdeas`, { method: "POST", headers, body: JSON.stringify(body) });
  const compPt = { LOW: "Baixa", MEDIUM: "Média", HIGH: "Alta" };
  const out = (r.results || []).map((x) => {
    const m = x.keywordIdeaMetrics || {};
    return {
      termo: x.text,
      volume: Number(m.avgMonthlySearches || 0),
      concorrencia: compPt[m.competition] || "—",
      lanceMin: m.lowTopOfPageBidMicros ? Number(m.lowTopOfPageBidMicros) / 1e6 : null,
      lanceMax: m.highTopOfPageBidMicros ? Number(m.highTopOfPageBidMicros) / 1e6 : null,
    };
  }).sort((a, b) => b.volume - a.volume);
  return out.slice(0, 300);
});

// VOLUME EXATO das palavras-chave que a analista JÁ TEM (sem expandir em novas ideias)
ipcMain.handle("googleads:keywordVolume", async (_e, { customerId, keywords }) => {
  const s = readStore().settings;
  const cid = String(customerId || s.googleAdsLoginCustomerId || "").replace(/-/g, "");
  if (!cid) throw new Error("Vincule a conta Google do cliente (ou configure a MCC).");
  const headers = await gadsHeaders();
  const kws = (keywords || []).map((k) => String(k).trim()).filter(Boolean).slice(0, 500);
  if (!kws.length) throw new Error("Cole ao menos uma palavra-chave.");
  const body = {
    keywords: kws,
    geoTargetConstants: ["geoTargetConstants/2076"], // Brasil
    language: "languageConstants/1014",               // Português
    keywordPlanNetwork: "GOOGLE_SEARCH",
  };
  const r = await googleAdsApi(`customers/${cid}:generateKeywordHistoricalMetrics`, { method: "POST", headers, body: JSON.stringify(body) });
  const compPt = { LOW: "Baixa", MEDIUM: "Média", HIGH: "Alta" };
  const found = new Map();
  (r.results || []).forEach((x) => {
    const m = x.keywordMetrics || {};
    found.set(String(x.text || "").toLowerCase(), {
      termo: x.text,
      volume: Number(m.avgMonthlySearches || 0),
      concorrencia: compPt[m.competition] || "—",
      lanceMin: m.lowTopOfPageBidMicros ? Number(m.lowTopOfPageBidMicros) / 1e6 : null,
      lanceMax: m.highTopOfPageBidMicros ? Number(m.highTopOfPageBidMicros) / 1e6 : null,
    });
  });
  // mantém a ordem/lista original — se o Google não retornar métrica pra alguma, mostra volume 0
  return kws.map((k) => found.get(k.toLowerCase()) || { termo: k, volume: 0, concorrencia: "—", lanceMin: null, lanceMax: null });
});

ipcMain.handle("googleads:addKeywords", async (_e, { customerId, items }) => {
  const cid = String(customerId || "").replace(/-/g, "");
  if (!cid) throw new Error("Cliente sem conta Google vinculada.");
  const headers = await gadsHeaders();
  // agrupa por grupo de anúncios (a palavra-chave positiva mora no ad group)
  const byAg = {};
  (items || []).forEach((it) => { if (it.adGroupId) (byAg[it.adGroupId] = byAg[it.adGroupId] || []).push(it); });
  const log = [];
  for (const [agId, list] of Object.entries(byAg)) {
    const operations = list.map((it) => ({ create: { ad_group: `customers/${cid}/adGroups/${agId}`, status: "ENABLED", keyword: { text: cleanKeyword(it.text), matchType: it.matchType || "PHRASE" } } })).filter((o) => o.create.keyword.text);
    try {
      const r = await googleAdsApi(`customers/${cid}/adGroupCriteria:mutate`, { method: "POST", headers, body: JSON.stringify({ operations, partialFailure: true }) });
      const { ok, failMsg } = mutateSummary(r);
      log.push({ ok: ok > 0, txt: `${ok > 0 ? "✅" : "❌"} ${ok}/${operations.length} palavra(s)-chave no grupo ${agId}${failMsg ? ` · ⚠️ ${failMsg}` : ""}` });
    } catch (e) { log.push({ ok: false, txt: `❌ grupo ${agId}: ${e.message}` }); }
  }
  return log;
});

// lista as contas (com NOME) que a MCC gerencia — pra vincular ao cliente sem digitar número
ipcMain.handle("googleads:accounts", async () => {
  const s = readStore().settings;
  const mcc = (s.googleAdsLoginCustomerId || "").replace(/-/g, "");
  if (!mcc) throw new Error("Preencha o MCC (login customer id) primeiro.");
  if (!s.googleAdsRefreshToken) throw new Error("Conecte com o Google primeiro.");
  const at = await googleAdsAccessToken(s);
  const headers = { Authorization: `Bearer ${at}`, "developer-token": s.googleAdsDevToken, "login-customer-id": mcc, "Content-Type": "application/json" };
  const query = "SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager FROM customer_client WHERE customer_client.status = 'ENABLED'";
  let pageToken = null; const all = [];
  do {
    const body = JSON.stringify(pageToken ? { query, pageToken } : { query });
    const r = await googleAdsApi(`customers/${mcc}/googleAds:search`, { method: "POST", headers, body });
    (r.results || []).forEach((row) => {
      const cc = row.customerClient || {};
      if (!cc.manager) all.push({ id: String(cc.id), name: cc.descriptiveName || "(sem nome)" });
    });
    pageToken = r.nextPageToken;
  } while (pageToken);
  // ordena por nome
  return all.sort((a, b) => a.name.localeCompare(b.name));
});

/* ---------------------------------------------------------- */
/* Motor de IA: Claude (pelo seu plano, via Claude Code) → Gemini de backup */
/* ---------------------------------------------------------- */
const { spawn } = require("child_process");
let lastAIEngine = "—"; // pra dar visibilidade de qual motor respondeu

// acha o binário do Claude Code (usa o login/plano que já está logado nessa máquina)
function claudeBinary() {
  const s = readStore().settings;
  if (s.claudeCliPath) return s.claudeCliPath;
  const cands = [path.join(os.homedir(), ".local/bin/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"];
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch {} }
  return "claude"; // fallback no PATH
}
function claudeAvailable() {
  const b = claudeBinary();
  if (b.includes("/")) { try { return fs.existsSync(b); } catch { return false; } }
  return true;
}
// roda o Claude Code em modo silencioso (-p), prompt via stdin, modelo Sonnet por padrão (mais barato).
// IMPORTANTE: quando o app é aberto pelo Finder o ambiente é mínimo e faltam USER/LOGNAME/HOME —
// sem eles o Claude não acha o login no Keychain ("Not logged in"). Garantimos essas variáveis aqui.
function runClaudeCli(prompt, model) {
  return new Promise((resolve, reject) => {
    const bin = claudeBinary();
    const m = ["sonnet", "opus", "haiku"].includes(model) ? model : "sonnet";
    const uname = (() => { try { return os.userInfo().username; } catch { return ""; } })();
    const env = Object.assign({}, process.env, {
      HOME: process.env.HOME || os.homedir(),
      USER: process.env.USER || uname,
      LOGNAME: process.env.LOGNAME || uname,
      PATH: (process.env.PATH || "") + ":/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin:" + path.join(os.homedir(), ".local/bin"),
    });
    const workdir = path.join(os.tmpdir(), "pmp-ai"); try { fs.mkdirSync(workdir, { recursive: true }); } catch {}
    const child = spawn(bin, ["-p", "--model", m, "--output-format", "text"], { cwd: workdir, env });
    let out = "", err = "";
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} reject(new Error("Claude CLI demorou demais (timeout).")); }, 300000);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const txt = out.trim();
      if (/not logged in|please run \/login|invalid api key/i.test(txt + " " + err)) {
        return reject(new Error("Claude Code não está logado nesta máquina."));
      }
      if (txt) resolve(txt);
      else reject(new Error(err.trim() || `Claude CLI saiu com código ${code}.`));
    });
    try { child.stdin.write(prompt); child.stdin.end(); } catch (e) { clearTimeout(timer); reject(e); }
  });
}

// motor unificado. Preferência configurável (s.aiEngine): "gemini" (rápido, padrão) ou "claude" (seu plano, mais lento).
// Imagens → sempre Gemini (multimodal). O outro motor entra como fallback se o preferido falhar.
async function aiAnalyze(s, prompt, images, modelOverride) {
  const hasImages = (images || []).some((i) => i && /^data:/.test(i));
  const preferClaude = s.aiEngine === "claude";
  const useGemini = async () => { const t = await geminiAnalyze(s, prompt, images, modelOverride); lastAIEngine = "Gemini"; return t; };
  const useClaude = async () => { const t = await runClaudeCli(prompt, s.claudeModel || "sonnet"); lastAIEngine = "Claude (seu plano)"; return t; };

  // imagens só o Gemini lê de verdade
  if (hasImages && s.geminiKey) return useGemini();

  if (preferClaude && claudeAvailable()) {
    try { return await useClaude(); }
    catch (e) { console.log("[claude-cli] falhou, fallback Gemini:", e.message); if (s.geminiKey) return useGemini(); throw e; }
  }
  // padrão: Gemini (rápido)
  if (s.geminiKey) {
    try { return await useGemini(); }
    catch (e) { console.log("[gemini] falhou, fallback Claude:", e.message); if (claudeAvailable()) return useClaude(); throw e; }
  }
  // sem Gemini configurado: usa Claude
  if (claudeAvailable()) return useClaude();
  throw new Error("Nenhum motor de IA disponível. Configure a chave do Gemini ou conecte o Claude Code.");
}

ipcMain.handle("ai:engineInfo", () => {
  const s = readStore().settings;
  const claude = claudeAvailable();
  const prefer = s.aiEngine === "claude" ? (claude ? "Claude (seu plano)" : (s.geminiKey ? "Gemini" : "nenhum")) : (s.geminiKey ? "Gemini" : (claude ? "Claude (seu plano)" : "nenhum"));
  return { claude, gemini: !!s.geminiKey, engine: s.aiEngine || "gemini", prefer, last: lastAIEngine };
});

async function geminiAnalyze(s, prompt, images, modelOverride) {
  if (!s.geminiKey) throw new Error("Configure a chave do Gemini em Configurações.");
  const model = modelOverride || s.geminiModel || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(s.geminiKey)}`;
  const parts = [{ text: prompt }];
  // imagens (data URLs) — Gemini é multimodal, lê o print pra identificar o que ela apontou
  (images || []).forEach((img) => { if (img && /^data:/.test(img)) { const [meta, b64] = img.split(","); const mime = (meta.match(/data:([^;]+)/) || [])[1] || "image/png"; parts.push({ inline_data: { mime_type: mime, data: b64 } }); } });
  const payload = JSON.stringify({
    contents: [{ parts }],
    // desliga o "thinking" do 2.5-flash (que consumia a saída) e dá espaço suficiente
    generationConfig: { temperature: 0.7, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } },
  });
  let body;
  for (let attempt = 1; ; attempt++) {
    try {
      body = await httpJson(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
      break;
    } catch (e) {
      // 503/429/500 = Gemini sobrecarregado → tenta de novo (backoff maior)
      if ([429, 500, 503].includes(e.status) && attempt < 6) { console.log(`[gemini] ${e.status}, retry ${attempt}`); await sleep(attempt * 2500); continue; }
      console.log("[gemini] erro:", e.message);
      throw new Error(e.status === 503 ? "Gemini sobrecarregado no momento. Tente de novo em alguns segundos." : e.message);
    }
  }
  const cand = body && body.candidates && body.candidates[0];
  const text = ((cand && cand.content && cand.content.parts) || []).map((p) => p.text).filter(Boolean).join("\n").trim();
  if (!text) {
    const reason = (cand && cand.finishReason) || (body && body.promptFeedback && body.promptFeedback.blockReason) || "resposta vazia";
    console.log("[gemini] vazio. finishReason/erro:", reason, "·", JSON.stringify(body).slice(0, 400));
    throw new Error(`Gemini não retornou texto (${reason}).`);
  }
  return text;
}

/* ---------------------------------------------------------- */
/* Qualificação de leads (Google Sheets via CSV, fase 1: só lê) */
/* ---------------------------------------------------------- */
function sheetId(sheetUrl) {
  const m = String(sheetUrl).match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) throw new Error("Link do Google Sheets inválido.");
  return m[1];
}
function sheetCsvUrl(sheetUrl) {
  const gid = (String(sheetUrl).match(/[#&?]gid=(\d+)/) || [])[1];
  return `https://docs.google.com/spreadsheets/d/${sheetId(sheetUrl)}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
}
async function fetchTabCsv(id, gid) {
  const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid != null ? `&gid=${gid}` : ""}`;
  const res = await fetch(url);
  const t = await res.text();
  if (!res.ok || /^\s*<!DOCTYPE|<html/i.test(t)) return null;
  return t;
}
// lista os gids de todas as abas (via htmlview, sem precisar de chave)
async function listGids(id) {
  try {
    const h = await fetch(`https://docs.google.com/spreadsheets/d/${id}/htmlview`).then((r) => r.text());
    const gids = [...new Set((h.match(/gid=(\d+)/g) || []).map((s) => s.replace("gid=", "")))];
    return gids.length ? gids.slice(0, 25) : [null];
  } catch { return [null]; }
}
function parseCSV(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else { if (c === '"') q = true; else if (c === ",") { row.push(cur); cur = ""; } else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; } else if (c === "\r") { } else cur += c; }
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const leadNums = (s) => (String(s).match(/\d[\d.]*/g) || []).map((x) => parseInt(x.replace(/\./g, ""), 10)).filter((n) => n >= 1000);
const leadYmd = (s) => {
  s = String(s);
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;          // ISO 2026-05-01
  m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/); if (m) return `${m[3]}-${m[2]}-${m[1]}`;             // DD/MM/AAAA
  m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2})\b/); if (m) return `20${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`; // DD/MM/AA
  return null;
};
const isGreen = (bg) => {
  if (!bg) return false;
  const r = bg.red || 0, g = bg.green || 0, b = bg.blue || 0;
  if (r > 0.95 && g > 0.95 && b > 0.95) return false; // branco
  return g > 0.5 && g >= r + 0.08 && g >= b + 0.08;    // esverdeado
};
// avalia uma regra contra uma linha (values + colors podem ser null no modo CSV)
function ruleMatch(values, colors, head, rule) {
  if (!rule || !rule.type) return false;
  if (rule.type === "greenRow") return !!(colors && colors.some(isGreen));
  const ci = rule.column ? head.findIndex((h) => h.trim() === rule.column.trim()) : -1;
  if (rule.type === "greenCol") return ci >= 0 && !!colors && isGreen(colors[ci]);
  if (ci < 0) return false;
  const cell = values[ci] || "";
  if (rule.type === "invMin") { const ns = leadNums(cell); return ns.length > 0 && Math.min(...ns) >= Number(rule.min); }
  if (rule.type === "colValue") { return (rule.values || []).some((v) => v && cell.toLowerCase().includes(String(v).trim().toLowerCase())); }
  return false;
}
const isColored = (bg) => !!bg && !((bg.red || 0) > 0.95 && (bg.green || 0) > 0.95 && (bg.blue || 0) > 0.95);
// a linha foi AVALIADA pelo cliente? (pra saber se cai no critério de cargo ou não)
function isMarked(values, colors, head, marca) {
  if (!marca) return false;
  if (marca.type === "greenRow") return !!(colors && colors.some(isColored));
  const ci = head.findIndex((h) => h.trim() === (marca.column || "").trim());
  if (marca.type === "greenCol") return ci >= 0 && !!colors && isColored(colors[ci]);
  if (ci < 0) return false;
  return String(values[ci] || "").trim() !== "";
}
// lê todas as abas via Sheets API com valores + cor de fundo
async function gsGetAll(id, key) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}?key=${encodeURIComponent(key)}&includeGridData=true&fields=sheets(properties.title,data(rowData(values(formattedValue,effectiveFormat.backgroundColor))))`;
  const body = await fetch(url).then((r) => r.json());
  if (body.error) throw new Error("Google Sheets: " + (body.error.message || body.error.status));
  return (body.sheets || []).map((sh) => {
    const rd = (sh.data && sh.data[0] && sh.data[0].rowData) || [];
    const head = ((rd[0] && rd[0].values) || []).map((v) => (v.formattedValue || "").trim());
    const rows = rd.slice(1).map((row) => ({
      values: (row.values || []).map((c) => c.formattedValue || ""),
      colors: (row.values || []).map((c) => c.effectiveFormat && c.effectiveFormat.backgroundColor),
    }));
    return { title: sh.properties.title, head, rows };
  });
}
async function leadsSummary(cfg, start, end) {
  if (!cfg || !cfg.sheetUrl) return null;
  // marca = como o cliente marca o MQL (verde/coluna); cargo = critério usado quando NÃO está marcado
  const marca = cfg.mqlMarca || cfg.mql || cfg.rule;
  const cargo = cfg.mqlCargo;
  const custom = cfg.mqlCustom; // condição personalizada extra (OR)
  const sql = cfg.sql;
  const needsColor = [marca, cargo, custom, sql].some((r) => r && (r.type === "greenRow" || r.type === "greenCol"));
  const id = sheetId(cfg.sheetUrl);
  const key = (readStore().settings.googleSheetsKey || "").trim();

  // monta as abas no formato {head, rows:[{values, colors}]}
  let tabs = [];
  if (key) { try { tabs = await gsGetAll(id, key); } catch (e) { if (needsColor) throw e; } }
  if (!tabs.length) {
    if (needsColor) throw new Error("Pra ler cor verde preciso da Google Sheets API Key válida (Configurações).");
    const urlGid = (String(cfg.sheetUrl).match(/[#&?]gid=(\d+)/) || [])[1];
    const gids = urlGid ? [urlGid] : await listGids(id);
    const csvs = await Promise.all(gids.map((g) => fetchTabCsv(id, g).catch(() => null)));
    if (!csvs.some(Boolean)) throw new Error("Não consegui ler a planilha (verifique se está compartilhada por link).");
    tabs = csvs.filter(Boolean).map((csv) => { const rows = parseCSV(csv); return { head: (rows[0] || []).map((h) => String(h).trim()), rows: rows.slice(1).map((r) => ({ values: r, colors: null })) }; });
  }

  let total = 0, mqls = 0, sqls = 0, tabsRead = 0;
  const byTab = [];
  tabs.forEach((t) => {
    let di = t.head.findIndex((h) => h.trim() === (cfg.dateColumn || "Data").trim());
    if (di < 0) di = t.head.findIndex((h) => /data/i.test(h));
    if (di < 0) return; // aba sem data → ignora
    if (!t.head.some((h) => /e-?mail|nome|telefone|cargo|empresa|lead/i.test(h))) return; // ignora abas que não são de leads
    tabsRead++;
    let tt = 0, tm = 0, ts = 0;
    t.rows.forEach((r) => {
      const v = r.values; if (!v || v.length < 2) return;
      if (start && end) { const y = leadYmd(v[di]); if (!y || y < start || y > end) return; }
      else if (!leadYmd(v[di])) return;
      tt++;
      // MQL: marca bate OU condição personalizada bate → MQL. Se marcado e não bate → não é. Se NÃO marcado → critério de cargo.
      const mql = ruleMatch(v, r.colors, t.head, marca) ? true
        : ruleMatch(v, r.colors, t.head, custom) ? true
        : (isMarked(v, r.colors, t.head, marca) ? false : ruleMatch(v, r.colors, t.head, cargo));
      if (mql) tm++;
      if (ruleMatch(v, r.colors, t.head, sql)) ts++;
    });
    total += tt; mqls += tm; sqls += ts;
    if (tt) byTab.push({ title: t.title || "Aba", platform: classifyTab(t.title || ""), total: tt, mqls: tm, sqls: ts, mqlRate: tm / tt * 100, sqlRate: ts / tt * 100 });
  });
  const byPlatform = {};
  byTab.forEach((t) => { const p = byPlatform[t.platform] = byPlatform[t.platform] || { total: 0, mqls: 0, sqls: 0 }; p.total += t.total; p.mqls += t.mqls; p.sqls += t.sqls; });
  Object.values(byPlatform).forEach((p) => { p.mqlRate = p.total ? p.mqls / p.total * 100 : 0; p.sqlRate = p.total ? p.sqls / p.total * 100 : 0; });
  return { total, mqls, sqls, mqlRate: total ? mqls / total * 100 : 0, sqlRate: total ? sqls / total * 100 : 0, hasSql: !!sql, tabs: tabsRead, byTab, byPlatform };
}
// classifica a aba numa plataforma pelo nome
function classifyTab(title) {
  const t = String(title).toLowerCase();
  if (/google|adwords|gads/.test(t)) return "google";
  if (/linkedin|\blinked\b|\bli\b/.test(t)) return "linkedin";
  if (/meta|facebook|\bfb\b|instagram/.test(t)) return "meta";
  return "outros";
}
// devolve os cabeçalhos da planilha (pra a tela de config saber as colunas)
async function leadsHeaders(sheetUrl) {
  const res = await fetch(sheetCsvUrl(sheetUrl));
  const csv = await res.text();
  if (!res.ok || /^\s*<!DOCTYPE|<html/i.test(csv)) throw new Error("Planilha não acessível por link (pediu login).");
  return (parseCSV(csv)[0] || []).map((h) => h.trim()).filter(Boolean);
}

/* ---------------------------------------------------------- */
/* IPC                                                         */
/* ---------------------------------------------------------- */
ipcMain.handle("leads:summary", async (_e, { projectId, start, end }) => {
  const c = readStore().clients.find((x) => x.projectId === projectId);
  if (!c || !c.leads || !c.leads.sheetUrl) return null;
  return leadsSummary(c.leads, start, end);
});
ipcMain.handle("leads:headers", async (_e, sheetUrl) => leadsHeaders(sheetUrl));
ipcMain.handle("leads:test", async (_e, cfg) => leadsSummary(cfg, null, null));

ipcMain.handle("settings:get", () => readStore().settings);
ipcMain.handle("settings:set", (_e, settings) => { const st = readStore(); st.settings = Object.assign(st.settings, settings); writeStore(st); return st.settings; });

ipcMain.handle("clients:get", () => readStore().clients);
ipcMain.handle("clients:set", (_e, clients) => { const st = readStore(); st.clients = clients; writeStore(st); return st.clients; });

ipcMain.handle("reportei:projects", async (_e, q) => reporteiProjects(readStore().settings.reporteiToken, q));
ipcMain.handle("reportei:weekData", async (_e, { projectId, start, end, includeAds, directMeta, directGoogle, directGa4 }) => {
  const st = readStore();
  let res = { platforms: [], notes: [] };

  // Reportei: só usa se tem token E projectId configurados
  if (st.settings.reporteiToken && projectId) {
    try {
      res = await reporteiWeekData(st.settings.reporteiToken, projectId, start, end, includeAds);
    } catch (e) {
      res.notes.push("Reportei: " + (e.message || "erro ao puxar dados"));
    }
  }

  // client lookup: pelo projectId (se vier) ou pelos IDs diretos passados pelo caller
  const client = projectId ? (st.clients || []).find((c) => c.projectId === projectId) : null;
  const metaAcct = directMeta || (client && client.adAccounts && client.adAccounts.meta);
  const gAcct   = directGoogle || (client && client.adAccounts && client.adAccounts.google);
  const ga4Pid  = directGa4   || (client && client.adAccounts && client.adAccounts.ga4PropertyId);

  // Meta direto
  if (metaAcct && st.settings.metaToken) {
    try {
      const md = await metaWeekData(metaAcct, start, end);
      if (md) {
        const had = res.platforms.some((p) => p.platform === "meta");
        res.platforms = had ? res.platforms.map((p) => (p.platform === "meta" ? md : p)) : res.platforms.concat(md);
        if (!res.notes.some((n) => n.startsWith("Meta:")))
          res.notes.push("Meta: dados direto da conta de anúncio.");
      }
    } catch (e) { res.notes.push("Meta API: " + (e.message || "erro")); }
  }

  // Google direto
  if (gAcct && st.settings.googleAdsRefreshToken) {
    try {
      const gd = await googleWeekData(gAcct, start, end);
      if (gd) {
        const had = res.platforms.some((p) => p.platform === "google");
        res.platforms = had ? res.platforms.map((p) => (p.platform === "google" ? gd : p)) : res.platforms.concat(gd);
        if (!res.notes.some((n) => n.startsWith("Google:")))
          res.notes.push("Google: dados direto da conta.");
      }
    } catch (e) { res.notes.push("Google API: " + (e.message || "erro")); }
  }

  // GA4
  if (ga4Pid) {
    try { res.ga4 = await ga4Sessions(ga4Pid, start, end); }
    catch (e) { res.notes.push("GA4: " + (e.message || "erro ao puxar sessões")); }
  }

  return res;
});

ipcMain.handle("trello:boards", async (_e, q) => trelloBoards(readStore().settings, q));
ipcMain.handle("trello:sendWeek", async (_e, { boardId, week, items, analysisText, negated }) => trelloSendWeek(readStore().settings, boardId, week, items, analysisText, negated));

// envia só um card de "feitos" (ex.: termos negativados de uma ação do histórico)
ipcMain.handle("trello:doneCard", async (_e, { boardId, title, desc, items }) => {
  const s = readStore().settings;
  const lists = await trelloLists(s, boardId);
  const feitosId = findList(lists, "o que foi feito na semana", "feito na semana", "feitos");
  if (!feitosId) throw new Error('Lista "O que foi feito na semana" não encontrada no board.');
  // termos já feitos → lista na descrição (não checklist)
  const full = (desc || "") + (items && items.length ? "\n\n" + items.map((t) => `- ${t}`).join("\n") : "");
  const card = await trelloCreateCard(s, feitosId, title, full);
  return { url: card.shortUrl || card.url };
});

/* ---- Ekyte (tarefas internas do time) — REST api.ekyte.com, auth ?apiKey=Bearer <token>
   versões por endpoint: users/workspaces/task-types/projects = v1.0 · tasks = v1.2 ---- */
const EKYTE = "https://api.ekyte.com";
// auth correta (conta Matriz): ?apiKey=<token> sem "Bearer" + companyId quando configurado
async function ekyteApi(s, pathQ, opts = {}) {
  if (!s.ekyteKey) throw new Error("Configure a API Key do Ekyte.");
  const token = String(s.ekyteKey).replace(/^Bearer\s+/i, "").trim();
  const sep = pathQ.includes("?") ? "&" : "?";
  const cid = s.ekyteCompanyId ? `&companyId=${encodeURIComponent(s.ekyteCompanyId)}` : "";
  const url = `${EKYTE}/${pathQ}${sep}apiKey=${encodeURIComponent(token)}${cid}`;
  return httpJson(url, { headers: { "Content-Type": "application/json" }, ...opts });
}
// lista workspaces / tipos de tarefa / usuários (id + nome) da empresa pra configurar a criação de tarefas
const ekyteList = (r) => {
  const arr = Array.isArray(r) ? r : (r && (r.data || r.items || r.results || r.records)) || [];
  if (!Array.isArray(arr)) return r;
  return arr.slice(0, 80).map((x) => ({ id: x.id != null ? x.id : x.workspaceId, nome: x.name || x.title || x.description || x.email || x.fullName || "" }));
};
ipcMain.handle("ekyte:test", async () => {
  const s = readStore().settings;
  if (!s.ekyteKey) throw new Error("Cole a API Key do Ekyte primeiro.");
  if (!s.ekyteCompanyId) throw new Error("Informe o ID da empresa (Matriz) e salve.");
  const out = {};
  for (const [k, p] of [["WORKSPACES", "v1.0/workspaces"], ["TIPOS_DE_TAREFA", "v1.0/task-types"], ["usuarios", "v1.0/users"]]) {
    try { out[k] = ekyteList(await ekyteApi(s, `${p}?page=1`)); } catch (e) { out[k + "_erro"] = e.message; }
  }
  return out;
});
// lista os tipos de tarefa (pro seletor da config)
ipcMain.handle("ekyte:taskTypes", async () => ekyteList(await ekyteApi(readStore().settings, "v1.0/task-types?page=1")));

/* ---- Zapier MCP (Streamable HTTP, JSON-RPC 2.0) — chama a ação "Create Task" sem montar Zap ---- */
function parseMcpBody(text) {
  if (!text) return null;
  if (text.trimStart().startsWith("{")) { try { return JSON.parse(text); } catch {} }
  let found = null; // SSE: pega a última linha "data: {...}" que tenha result/error
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    try { const o = JSON.parse(t.slice(5).trim()); if (o.result || o.error || o.jsonrpc) found = o; } catch {}
  }
  return found;
}
async function mcpRpc(url, token, method, params, sessionId, isNotif) {
  const headers = { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" };
  if (token) headers.Authorization = "Bearer " + String(token).replace(/^Bearer\s+/i, "").trim();
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const body = { jsonrpc: "2.0", method, params: params || {} };
  if (!isNotif) body.id = Date.now();
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const sid = r.headers.get("mcp-session-id") || sessionId;
  const text = await r.text();
  if (isNotif) return { sessionId: sid };
  const json = parseMcpBody(text);
  if (!r.ok && !json) throw new Error(`MCP ${r.status}: ${text.slice(0, 200)}`);
  if (json && json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return { result: json && json.result, sessionId: sid };
}
// faz o handshake e devolve o sessionId (alguns servidores exigem; outros aceitam stateless)
async function mcpHandshake(url, token) {
  let sid;
  try {
    const init = await mcpRpc(url, token, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "painel-midia-paga", version: "1.0.0" } });
    sid = init.sessionId;
    try { await mcpRpc(url, token, "notifications/initialized", {}, sid, true); } catch {}
  } catch {}
  return sid;
}
// chama uma tool do MCP e devolve o texto do resultado (content[].text)
async function mcpCallTool(s, name, args, sid) {
  const res = await mcpRpc(s.ekyteMcpUrl, s.ekyteMcpToken, "tools/call", { name, arguments: args || {} }, sid);
  const content = res.result && res.result.content;
  if (Array.isArray(content)) return content.map((c) => c.text || (c.type === "text" ? c.text : "") || "").join("\n");
  if (res.result && typeof res.result.text === "string") return res.result.text;
  return JSON.stringify(res.result || {});
}
// acha o selected_api do app eKyte na resposta de list_enabled_zapier_actions
function ekyteSelectedApi(listJsonText) {
  try { const j = JSON.parse(listJsonText); const app = (j.apps || []).find((a) => /ekyte/i.test(a.app || "")); return app ? app.selected_api : null; } catch { return null; }
}
ipcMain.handle("ekyte:mcpTest", async () => {
  const s = readStore().settings;
  if (!s.ekyteMcpUrl) throw new Error("Cole a URL do Zapier MCP primeiro.");
  const sid = await mcpHandshake(s.ekyteMcpUrl, s.ekyteMcpToken);
  const apps = await mcpCallTool(s, "list_enabled_zapier_actions", {}, sid);
  const selApi = ekyteSelectedApi(apps);
  if (!selApi) return { enabled: String(apps).slice(0, 6000) };
  // drill-down: detalhes da(s) ação(ões) do eKyte (action key + params da Create Task)
  const actions = await mcpCallTool(s, "list_enabled_zapier_actions", { selected_api: selApi }, sid);
  return { selected_api: selApi, enabled: String(actions).slice(0, 6000) };
});

// casa cliente → workspace por palavras significativas (ignora genéricas tipo "grupo", "ltda")
const EKYTE_STOP = new Set(["grupo", "de", "do", "da", "e", "ltda", "me", "sa", "eireli", "sociedade", "individual", "advocacia", "consultoria", "unico", "br", "the"]);
const ekyteWords = (str) => String(str || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !EKYTE_STOP.has(w));
function ekyteMatchWorkspace(clientName, wsArr) {
  const cw = ekyteWords(clientName); let best = null, bestScore = 0;
  for (const w of wsArr) {
    const name = String(w.name || w.title || "");
    if (name.toLowerCase() === String(clientName).toLowerCase()) return w;
    const ww = new Set(ekyteWords(name));
    let score = 0; cw.forEach((x) => { if (ww.has(x)) score += 3; else if ([...ww].some((y) => y.includes(x) || x.includes(y))) score += 1; });
    if (score > bestScore) { bestScore = score; best = w; }
  }
  return bestScore > 0 ? best : null;
}
// cria as tarefas da semana no Ekyte: 1 pro executor (antes da call) + 1 pra P.O (recebe)
ipcMain.handle("ekyte:createTasks", async (_e, { clientName, workspaceId, items, weekLabel, dueExecutor, duePo, taskTypeId }) => {
  const s = readStore().settings;
  const useMcp = !!s.ekyteMcpUrl;
  const useWebhook = !useMcp && !!s.ekyteWebhookUrl;
  if (!useMcp && !useWebhook && (!s.ekyteKey || !s.ekyteCompanyId)) throw new Error("Configure o Zapier MCP (ou webhook / API Key) do Ekyte.");
  const typeId = taskTypeId || s.ekyteTaskTypeId;
  if (!typeId) throw new Error("Escolha o tipo de tarefa do Ekyte.");
  if (!s.ekyteAnalystEmail) throw new Error("Informe seu email do Ekyte em Configurações.");
  let wsId = workspaceId, wsName = clientName;
  if (!wsId && s.ekyteKey && s.ekyteCompanyId) { // sem id fixado → casa por nome (se a API estiver configurada)
    try {
      const wsRaw = await ekyteApi(s, "v1.0/workspaces?page=1");
      const wsArr = Array.isArray(wsRaw) ? wsRaw : (wsRaw.data || wsRaw.items || wsRaw.results || []);
      const ws = ekyteMatchWorkspace(clientName, wsArr);
      if (ws) { wsId = ws.id; wsName = ws.name || ws.title; }
    } catch {}
  }
  const checklist = (items || []).map((it) => "• " + (it.text || it)).join("\n") || "(sem itens)";
  const token = String(s.ekyteKey || "").replace(/^Bearer\s+/i, "").trim();
  // eKyte no MCP: selected_api/action fixos (evita uma chamada de list = economiza tasks do Zapier)
  let mcpSid; const mcpApi = "EKyteCLIAPI", mcpAction = "create_task";
  if (useMcp) mcpSid = await mcpHandshake(s.ekyteMcpUrl, s.ekyteMcpToken);
  // envia a tarefa: via Zapier MCP (execute_zapier_write_action) · ou webhook · ou API direta (só leitura → falha)
  const sendTask = async (etapa, body) => {
    if (useMcp) {
      const instr = "Crie a tarefa no eKyte IMEDIATAMENTE com os parâmetros fornecidos. Não há projeto associado. NÃO faça perguntas de follow-up, apenas execute a criação agora.";
      const out = await mcpCallTool(s, "execute_zapier_write_action", { selected_api: mcpApi, action: mcpAction, instructions: instr, params: body, output: "id e título da tarefa criada" }, mcpSid);
      if (/"results"|"execution"|"actionDisplayName"/i.test(out)) return out; // criou
      if (/"followUpQuestion"/i.test(out)) throw new Error("o Ekyte pediu confirmação — tente de novo");
      if (/"isError"\s*:\s*true|"error"/i.test(out)) throw new Error(String(out).slice(0, 180));
      return out;
    }
    if (useWebhook) return httpJson(s.ekyteWebhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ etapa, cliente: clientName, semana: weekLabel, ...body }) });
    return httpJson(`${EKYTE}/v1.2/tasks?apiKey=${encodeURIComponent(token)}&companyId=${encodeURIComponent(s.ekyteCompanyId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  };
  const todayIso = new Date().toISOString().slice(0, 10);
  const fallbackDue = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  // UMA tarefa do tipo "Otimização de campanha" (que já tem as 2 etapas: Execução=analista → Aprovação=P.O).
  // phaseStartDate = véspera da call (início do analista) · currentDueDate = dia da call (conclusão final).
  const start = dueExecutor || todayIso;
  const due = duePo || dueExecutor || fallbackDue;
  const desc = `Otimizações da semana de ${clientName}:\n\n${checklist}\n\n— Etapa 1 (Execução): ${s.ekyteAnalystEmail}${s.ekytePoEmail ? `\n— Etapa 2 (Aprovação/revisão): ${s.ekytePoEmail}` : ""}`;
  const body = { ctcTaskTypeId: Number(typeId), workspaceId: Number(wsId), planTask: 1, quantity: 1, estimatedTime: 60, priorityGroup: 30, phaseStartDate: start, currentDueDate: due, userEmail: s.ekyteAnalystEmail, title: `Otimizações — ${clientName} · ${weekLabel}`, description: desc };
  const log = [];
  try {
    await sendTask("tarefa", body);
    log.push({ ok: true, txt: `✅ Tarefa criada (resp.: ${s.ekyteAnalystEmail}) · início ${start} · concluir até ${due}` });
  } catch (e) { log.push({ ok: false, txt: "❌ " + e.message }); }
  return { workspace: wsName, via: useMcp ? "Zapier MCP" : useWebhook ? "webhook" : "API", log };
});

// lê o orçamento mensal por plataforma da coluna "Investimento Mensal" do board do cliente
ipcMain.handle("trello:budget", async (_e, { boardId }) => {
  const s = readStore().settings;
  if (!s.trelloKey || !s.trelloToken) throw new Error("Configure as chaves do Trello.");
  if (!boardId) throw new Error("Cliente sem board do Trello.");
  const lists = await trelloLists(s, boardId);
  const listId = findList(lists, "investimento mensal", "investimento", "orçamento", "orcamento", "verba");
  if (!listId) return null; // board sem coluna de investimento
  const cards = await httpJson(`${TRELLO}/lists/${listId}/cards?fields=name&${trelloAuth(s)}`);
  // "R$ 6950" → 6950 · "R$ 3k" → 3000 · "R$ 6,5k" → 6500 · "R$" (vazio) → null
  const parseVal = (str) => {
    const m = String(str).match(/r\$\s*([\d.,]+)\s*(k|mil)?/i);
    if (!m) return null;
    let n = parseFloat(m[1].replace(/\.(?=\d{3})/g, "").replace(",", "."));
    if (!isFinite(n)) return null;
    if (m[2]) n *= 1000;
    return n;
  };
  const budget = {};
  (cards || []).forEach((c) => {
    const name = c.name || "";
    if (/total|histchildren|histórico|hist[oó]rico/i.test(name)) return; // ignora "Total" e "Histórico"
    const v = parseVal(name); if (v == null) return;
    if (/meta|facebook|instagram/i.test(name)) budget.meta = v;
    else if (/google|adwords|gads/i.test(name)) budget.google = v;
    else if (/linkedin/i.test(name)) budget.linkedin = v;
  });
  return budget;
});

// envia criativos como cards separados na lista "Demandas da Semana"
// cards: [{ name, desc, imageUrl, filename }]
ipcMain.handle("trello:sendCreatives", async (_e, { boardId, cards }) => {
  const s = readStore().settings;
  if (!s.trelloKey || !s.trelloToken) throw new Error("Configure as chaves do Trello.");
  if (!boardId) throw new Error("Board do Trello não vinculado a este cliente.");
  if (!cards || !cards.length) throw new Error("Nenhum criativo selecionado.");
  const lists = await trelloLists(s, boardId);
  const demandasId = findList(lists, "demandas da semana", "demandas");
  if (!demandasId) throw new Error('Lista "Demandas da Semana" não encontrada no board.');
  const out = [];
  for (const c of cards) {
    const card = await trelloCreateCard(s, demandasId, c.name, c.desc || "");
    let attached = false;
    if (c.imageUrl) {
      try {
        const attId = await trelloAttachImageFromUrl(s, card.id, c.imageUrl, c.filename);
        attached = !!attId;
        if (attId) { try { await trelloSetCardCover(s, card.id, attId); } catch {} }
      } catch {}
    }
    out.push({ name: c.name, url: card.shortUrl || card.url, attached });
  }
  return { created: out.length, cards: out };
});

ipcMain.handle("gemini:analyze", async (_e, { clientName, week, platformResults, benchmarks, leads, cplIdeal, gargalos }) => {
  const s = readStore().settings;
  return aiAnalyze(s, buildAnalysisPrompt(clientName, week, platformResults, benchmarks, leads, cplIdeal, gargalos));
});

ipcMain.handle("gemini:report", async (_e, { clientName, monthLabel, platformResults, prevResults, benchmarks, leads, leadsPrev, cplIdeal }) => {
  const s = readStore().settings;
  return aiAnalyze(s, buildReportPrompt(clientName, monthLabel, platformResults, prevResults, s.reportTemplate, benchmarks, leads, leadsPrev, cplIdeal));
});

ipcMain.handle("history:list", (_e, projectId) =>
  readStore().history.filter((h) => !projectId || h.projectId === projectId)
    .map((h) => ({ id: h.id, weekLabel: h.weekLabel, start: h.start, end: h.end, savedAt: h.savedAt, clientName: h.clientName, itemsCount: (h.items || []).length, trello: h.trello })));
ipcMain.handle("history:get", (_e, id) => readStore().history.find((h) => h.id === id) || null);

// log de AÇÕES de otimização (negativação, palavras-chave...) por cliente
ipcMain.handle("action:log", (_e, a) => {
  const st = readStore();
  if (!st.actions) st.actions = [];
  st.actions.push({ id: `act-${Date.now()}`, at: new Date().toISOString(), ...a });
  writeStore(st);
  return true;
});
ipcMain.handle("action:list", (_e, projectId) => (readStore().actions || []).filter((a) => !projectId || a.projectId === projectId).sort((x, y) => (y.at || "").localeCompare(x.at || "")));
ipcMain.handle("history:save", (_e, record) => {
  const st = readStore();
  record.id = record.id || `${record.projectId}-${record.start}-${Date.now()}`;
  record.savedAt = new Date().toISOString();
  const ix = st.history.findIndex((h) => h.projectId === record.projectId && h.start === record.start);
  if (ix >= 0) st.history[ix] = record; else st.history.push(record);
  writeStore(st);
  return record.id;
});

ipcMain.handle("open:external", (_e, url) => shell.openExternal(url));

/* ---------------------------------------------------------- */
/* Atualização leve (patch) — baixa só os arquivos mudados      */
/* de um repositório GitHub e reinicia. Sem reinstalar tudo.    */
/* ---------------------------------------------------------- */
const APP_ROOT = path.join(__dirname, ".."); // pasta onde moram electron/ e src/
function appVersion() { try { return require(path.join(APP_ROOT, "package.json")).version; } catch { return "0.0.0"; } }
function patchVersionFile() { return path.join(app.getPath("userData"), "patch-version.txt"); }
function localVersion() { try { const v = fs.readFileSync(patchVersionFile(), "utf8").trim(); return v || appVersion(); } catch { return appVersion(); } }
function verNum(v) { return String(v || "0").split(".").map((n) => parseInt(n, 10) || 0); }
function isNewer(a, b) { const x = verNum(a), y = verNum(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; } return false; }

ipcMain.handle("update:check", async () => {
  const base = (readStore().settings.updateBaseUrl || "").replace(/\/+$/, "");
  const local = localVersion();
  if (!base) return { local, configured: false };
  const manifest = await httpJson(`${base}/update.json?t=${Date.now()}`);
  return { local, latest: manifest.version, notes: manifest.notes || "", files: manifest.files || [], hasUpdate: isNewer(manifest.version, local), configured: true, base };
});

ipcMain.handle("update:apply", async (_e, { base, files, version }) => {
  if (!base || !Array.isArray(files) || !files.length) throw new Error("Manifesto de atualização inválido.");
  let n = 0;
  for (const rel of files) {
    if (rel.includes("..")) continue; // segurança: nada de sair da pasta do app
    const res = await fetch(`${base.replace(/\/+$/, "")}/${rel}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`Falhou ao baixar ${rel} (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    const dest = path.join(APP_ROOT, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf); n++;
  }
  fs.writeFileSync(patchVersionFile(), String(version || ""));
  setTimeout(() => { app.relaunch(); app.quit(); }, 400);
  return { ok: true, count: n };
});

// lê uma imagem local e devolve como data URL (pra exibir miniatura e subir o criativo)
function readImageDataUrl(p) {
  const buf = fs.readFileSync(p);
  const ext = (path.extname(p).slice(1) || "png").toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}
ipcMain.handle("file:readImage", (_e, p) => { try { return readImageDataUrl(p); } catch { return null; } });
// abre um arquivo .json (pré-estrutura) e devolve o conteúdo parseado
ipcMain.handle("dialog:openJson", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "JSON", extensions: ["json"] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return JSON.parse(fs.readFileSync(r.filePaths[0], "utf8"));
});

/* ---------------------------------------------------------- */
/* GTM — OAuth separado (independente do Google Ads)          */
/* ---------------------------------------------------------- */
async function gtmAccessToken() {
  const s = readStore().settings;
  const refreshToken = s.gtmRefreshToken || s.googleAdsRefreshToken;
  const clientId     = s.gtmClientId    || s.googleAdsClientId;
  const clientSecret = s.gtmClientSecret|| s.googleAdsClientSecret;
  if (!refreshToken) throw new Error("GTM não conectado. Clique em 'Conectar GTM' em Configurações.");
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" });
  const r = await httpJson("https://oauth2.googleapis.com/token", { method: "POST", body });
  return r.access_token;
}
async function gtmDefaultWorkspace(containerPath, tok) {
  const r = await httpJson(`https://www.googleapis.com/tagmanager/v2/${containerPath}/workspaces`, { headers: { Authorization: `Bearer ${tok}` } });
  return (r.workspace || []).find((w) => w.name === "Default Workspace") || (r.workspace || [])[0] || null;
}
function gtmSafeName(s) { return s.replace(/[:<>]/g, "_"); }

ipcMain.handle("gtm:connect", async (_e, { clientId, clientSecret }) => {
  const http = require("http");
  const PORT = 42815;
  const redirectUri = `http://localhost:${PORT}`;
  if (!clientId || !clientSecret) {
    // reutiliza credenciais do Google Ads se já configuradas
    const s = readStore().settings;
    clientId = s.googleAdsClientId;
    clientSecret = s.googleAdsClientSecret;
    if (!clientId || !clientSecret) throw new Error("Configure o Client ID e Secret do Google Cloud primeiro (seção Google Ads).");
  }
  const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code",
    scope: "https://www.googleapis.com/auth/tagmanager.edit.containers https://www.googleapis.com/auth/tagmanager.publish https://www.googleapis.com/auth/tagmanager.readonly",
    access_type: "offline", prompt: "consent",
  }).toString();
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, redirectUri);
      const c = u.searchParams.get("code"); const err = u.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<html><body style="font-family:sans-serif;background:#0b1018;color:#cdd6e3;text-align:center;padding-top:80px"><h2>${c ? "✅ GTM Conectado!" : "❌ " + (err || "cancelado")}</h2><p>Pode fechar esta aba.</p></body></html>`);
      server.close(); if (c) resolve(c); else reject(new Error(err || "cancelado"));
    });
    server.on("error", reject);
    server.listen(PORT, () => shell.openExternal(authUrl));
    setTimeout(() => { try { server.close(); } catch {} reject(new Error("timeout")); }, 180000);
  });
  const tok = await httpJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  if (!tok.refresh_token) throw new Error("Refresh token não obtido — revogue o acesso no Google e reconecte.");
  const st = readStore();
  st.settings.gtmRefreshToken = tok.refresh_token;
  st.settings.gtmClientId = clientId;
  st.settings.gtmClientSecret = clientSecret;
  writeStore(st);
  return { ok: true };
});

ipcMain.handle("gtm:containers", async () => {
  const tok = await gtmAccessToken();
  const r = await httpJson("https://www.googleapis.com/tagmanager/v2/accounts", { headers: { Authorization: `Bearer ${tok}` } });
  const result = [];
  for (const acct of (r.account || [])) {
    const cr = await httpJson(`https://www.googleapis.com/tagmanager/v2/${acct.path}/containers`, { headers: { Authorization: `Bearer ${tok}` } });
    for (const cont of (cr.container || []))
      result.push({ accountId: acct.accountId, accountName: acct.name, containerId: cont.containerId, containerName: cont.name, path: cont.path });
  }
  return result;
});

ipcMain.handle("gtm:setup", async (_e, { containerPath, events }) => {
  const tok = await gtmAccessToken();
  const ws = await gtmDefaultWorkspace(containerPath, tok);
  if (!ws) throw new Error("Nenhum workspace encontrado no container.");
  const wsPath = ws.path;
  const results = [];
  for (const ev of events) {
    try {
      const trigName = gtmSafeName(`${ev.name} — Trigger`);
      const tagName  = gtmSafeName(`${ev.name} — GA4`);
      const filterConds = [];
      if (ev.selector) {
        // prioridade: ID > CSS class > URL > texto
        const s = ev.selector;
        if (s.startsWith("#"))
          filterConds.push({ type: "EQUALS", parameter: [{ type: "TEMPLATE", key: "arg0", value: "{{Click ID}}" }, { type: "TEMPLATE", key: "arg1", value: s.slice(1) }] });
        else if (s.startsWith("."))
          filterConds.push({ type: "CONTAINS", parameter: [{ type: "TEMPLATE", key: "arg0", value: "{{Click Classes}}" }, { type: "TEMPLATE", key: "arg1", value: s.slice(1) }] });
        else
          filterConds.push({ type: "EQUALS", parameter: [{ type: "TEMPLATE", key: "arg0", value: "{{Click Element}}" }, { type: "TEMPLATE", key: "arg1", value: s }] });
      }
      const trig = await httpJson(`https://www.googleapis.com/tagmanager/v2/${wsPath}/triggers`, {
        method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: trigName, type: "CLICK", filter: filterConds }),
      });
      await httpJson(`https://www.googleapis.com/tagmanager/v2/${wsPath}/tags`, {
        method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tagName, type: "gaawe",
          parameter: [{ type: "TEMPLATE", key: "eventName", value: ev.eventName || ev.name }, { type: "TEMPLATE", key: "measurementId", value: ev.measurementId || "{{GA4 Measurement ID}}" }],
          firingTriggerId: [trig.triggerId],
        }),
      });
      results.push({ name: ev.name, ok: true, triggerId: trig.triggerId });
    } catch (e) { results.push({ name: ev.name, ok: false, error: e.message }); }
  }
  return results;
});

// --- helpers do GTM smart setup ---
function gtmHtmlText(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
}
function gtmAttr(tag, name) {
  const m = tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', "i")) || tag.match(new RegExp(name + "\\s*=\\s*'([^']*)'", "i"));
  return m ? m[1].trim() : "";
}
// extrai os elementos clicáveis REAIS da página (links, botões, CTAs, formulários)
function gtmExtractClickables(html) {
  const out = [];
  const seen = new Set();
  const push = (tag, openTag, inner, hrefOverride) => {
    const id = gtmAttr(openTag, "id");
    const cls = gtmAttr(openTag, "class");
    const href = hrefOverride != null ? hrefOverride : gtmAttr(openTag, "href");
    let text = gtmHtmlText(inner).slice(0, 80);
    if (!text) text = gtmAttr(openTag, "aria-label") || gtmAttr(openTag, "value") || gtmAttr(openTag, "title") || "";
    if (!text && !id && !cls && !href) return;
    const key = tag + "|" + id + "|" + cls + "|" + text + "|" + href;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ tag, id, cls, text, href });
  };
  let m;
  const aRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  while ((m = aRe.exec(html))) push("a", m[1], m[2]);
  const bRe = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  while ((m = bRe.exec(html))) push("button", m[1], m[2]);
  const iRe = /<input\b([^>]*)>/gi;
  while ((m = iRe.exec(html))) { const t = gtmAttr(m[1], "type").toLowerCase(); if (t === "submit" || t === "button") push("input", m[1], "", ""); }
  const fRe = /<form\b([^>]*)>/gi;
  while ((m = fRe.exec(html))) push("form", m[1], "", "");
  return out;
}
// extrai um array JSON completo respeitando colchetes dentro de strings (ex.: selector "a[href]")
function gtmExtractJsonArray(text) {
  const t = String(text || "");
  const start = t.indexOf("[");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) return t.slice(start, i + 1); }
  }
  return null;
}
// recuperação se a IA cortar a resposta no meio (trunca): fecha no último objeto completo
function gtmSalvageJsonArray(text) {
  const t = String(text || "");
  const start = t.indexOf("[");
  const lastObj = t.lastIndexOf("}");
  if (start < 0 || lastObj < start) return null;
  return t.slice(start, lastObj + 1) + "]";
}

ipcMain.handle("gtm:smartSetup", async (_e, { url, html, screenshot, containerPath, measurementId }) => {
  const s = readStore().settings;
  // 1) busca o HTML REAL da página (não confia em HTML vindo do front)
  let pageHtml = html || "";
  if (url) {
    try {
      const u = /^https?:\/\//.test(url) ? url : "https://" + url;
      pageHtml = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" } }).then((r) => r.text());
    } catch (e) {
      if (!pageHtml) throw new Error("Não consegui abrir a página. Confira o link: " + url);
    }
  }
  if (!pageHtml && !screenshot) throw new Error("Informe a URL da página (ou anexe um print).");

  // 2) extrai os elementos clicáveis reais e monta um catálogo enxuto pra IA
  const clickables = gtmExtractClickables(pageHtml).slice(0, 60);
  const catalog = clickables.map((c, i) =>
    `${i + 1}. <${c.tag}>${c.id ? ` id="${c.id}"` : ""}${c.cls ? ` class="${c.cls}"` : ""}${c.href ? ` href="${c.href}"` : ""} → "${c.text}"`
  ).join("\n");

  const imgs = screenshot ? [{ data: screenshot.replace(/^data:[^;]+;base64,/, ""), mimeType: "image/png" }] : [];
  const prompt = `Você é especialista em Google Tag Manager e GA4. Abaixo está a LISTA REAL de elementos clicáveis (links, botões, CTAs, formulários) extraídos do HTML desta página. Escolha APENAS os que valem como conversão/evento: enviar formulário, clicar em WhatsApp, "Comprar/Orçamento/Falar com consultor/Agendar", clicar em telefone (tel:) ou e-mail (mailto:). IGNORE menu, navegação interna, rodapé e redes sociais genéricas.

Para "selector" use SOMENTE o que existe no elemento real: prefira #id (se tiver id), senão .classe (uma classe específica e única do elemento), senão o texto exato do botão. Para links use o próprio href quando for tel:/mailto:/wa.me.

Responda SOMENTE com um array JSON válido e COMPLETO, sem nada antes ou depois, sem markdown:
[{"name":"Nome legível","eventName":"nome_snake_case","selector":"#id ou .classe ou texto","description":"o que captura"}]

LISTA DE ELEMENTOS:
${catalog || "(nenhum elemento extraído do HTML — use o print anexado)"}`;

  const raw = await aiAnalyze(s, prompt, imgs);
  let arr = gtmExtractJsonArray(raw) || gtmSalvageJsonArray(raw);
  if (!arr) throw new Error("A IA não retornou eventos. Tente de novo (ou anexe um print da página).");
  let events;
  try { events = JSON.parse(arr); }
  catch (e) {
    const salv = gtmSalvageJsonArray(raw);
    try { events = JSON.parse(salv); } catch { throw new Error("Não consegui ler a resposta da IA. Tente novamente."); }
  }
  // não configura automaticamente — devolve a sugestão pro usuário confirmar
  return (Array.isArray(events) ? events : []).map((e) => ({ ...e, measurementId }));
});

/* ---------------------------------------------------------- */
/* Meta Ads — Sessão por cliente                              */
/* ---------------------------------------------------------- */

// lista TODAS as contas de anúncio que o token acessa (para o seletor de sessão)
ipcMain.handle("meta:adAccounts", async () => {
  const s = readStore().settings;
  if (!s.metaToken) throw new Error("Token Meta não configurado.");
  const r = await httpJson(`${GRAPH}/me/adaccounts?fields=id,name,account_id,account_status,currency,timezone_name&limit=200&access_token=${encodeURIComponent(s.metaToken)}`);
  return (r.data || []).map((a) => ({ id: a.id, accountId: a.account_id, name: a.name, status: a.account_status, currency: a.currency, timezone: a.timezone_name }));
});

// lista campanhas (todas, incluindo pausadas) com insights do período
async function metaCampaignList(accountId, tok, start, end) {
  const tr = JSON.stringify({ since: start, until: end });
  const fields = `id,name,status,objective,daily_budget,lifetime_budget,insights.time_range(${tr}).fields(spend,impressions,clicks,actions,reach)`;
  const r = await httpJson(`${GRAPH}/${accountId}/campaigns?fields=${encodeURIComponent(fields)}&limit=200&access_token=${encodeURIComponent(tok)}`);
  return (r.data || []).map((c) => {
    const ins = (c.insights && c.insights.data && c.insights.data[0]) || {};
    const acts = ins.actions || [];
    const act = (t) => { const a = acts.find((x) => x.action_type === t); return a ? Number(a.value) : 0; };
    const leads = act("lead") || act("offsite_conversion.fb_pixel_lead") || 0;
    const spend = Number(ins.spend || 0);
    return {
      id: c.id, name: c.name, status: c.status, objective: c.objective,
      dailyBudget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
      lifetimeBudget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
      spend, impressions: Number(ins.impressions || 0), clicks: Number(ins.clicks || 0),
      leads, cpl: (spend && leads) ? spend / leads : null,
    };
  });
}

ipcMain.handle("meta:campaigns", async (_e, { accountId, start, end }) => {
  const s = readStore().settings;
  if (!s.metaToken) throw new Error("Token Meta não configurado.");
  return metaCampaignList(accountId, s.metaToken, start, end);
});

ipcMain.handle("meta:toggleCampaign", async (_e, { campaignId, status }) => {
  const s = readStore().settings;
  if (!s.metaToken) throw new Error("Token Meta não configurado.");
  const r = await httpJson(`${GRAPH}/${campaignId}?status=${status}&access_token=${encodeURIComponent(s.metaToken)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  return r;
});

// lista conjuntos de anúncio de uma campanha com insights
ipcMain.handle("meta:adSets", async (_e, { accountId, campaignId, start, end }) => {
  const s = readStore().settings;
  if (!s.metaToken) throw new Error("Token Meta não configurado.");
  const tok = s.metaToken;
  const tr = JSON.stringify({ since: start, until: end });
  const fields = `id,name,status,daily_budget,lifetime_budget,targeting,insights.time_range(${tr}).fields(spend,impressions,clicks,actions)`;
  const filter = campaignId ? `&campaign_id=${campaignId}` : "";
  const r = await httpJson(`${GRAPH}/${accountId}/adsets?fields=${encodeURIComponent(fields)}&limit=200${filter}&access_token=${encodeURIComponent(tok)}`);
  return (r.data || []).map((a) => {
    const ins = (a.insights && a.insights.data && a.insights.data[0]) || {};
    const acts = ins.actions || [];
    const act = (t) => { const x = acts.find((v) => v.action_type === t); return x ? Number(x.value) : 0; };
    const leads = act("lead") || act("offsite_conversion.fb_pixel_lead") || 0;
    const spend = Number(ins.spend || 0);
    return {
      id: a.id, name: a.name, status: a.status, campaignId,
      dailyBudget: a.daily_budget ? Number(a.daily_budget) / 100 : null,
      spend, impressions: Number(ins.impressions || 0), clicks: Number(ins.clicks || 0),
      leads, cpl: (spend && leads) ? spend / leads : null,
    };
  });
});

ipcMain.handle("meta:toggleAdSet", async (_e, { adSetId, status }) => {
  const s = readStore().settings;
  if (!s.metaToken) throw new Error("Token Meta não configurado.");
  return httpJson(`${GRAPH}/${adSetId}?status=${status}&access_token=${encodeURIComponent(s.metaToken)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
});

// lista anúncios de um adset (ou campanha inteira) com insights
ipcMain.handle("meta:ads", async (_e, { accountId, adSetId, start, end }) => {
  const s = readStore().settings;
  if (!s.metaToken) throw new Error("Token Meta não configurado.");
  const tok = s.metaToken;
  const tr = JSON.stringify({ since: start, until: end });
  // image_url = imagem estática; thumbnail_url = miniatura de vídeo; video_id indica que é vídeo
  // thumbnail_width/height(1080) força o Meta a gerar a miniatura em alta resolução (padrão é ~130px, fica embaçado)
  const fields = `id,name,status,creative.thumbnail_width(1080).thumbnail_height(1080){id,name,thumbnail_url,image_url,video_id,effective_instagram_story_id},insights.time_range(${tr}).fields(spend,impressions,clicks,actions)`;
  // filtra DE VERDADE pelos anúncios do conjunto: o endpoint /{adset_id}/ads só traz os daquele público.
  // (o /{conta}/ads?adset_id= é ignorado pelo Meta e devolvia TODOS os anúncios da conta)
  const base = adSetId ? `${GRAPH}/${adSetId}/ads` : `${GRAPH}/${accountId}/ads`;
  const r = await httpJson(`${base}?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(tok)}`);
  return (r.data || []).map((ad) => {
    const ins = (ad.insights && ad.insights.data && ad.insights.data[0]) || {};
    const acts = ins.actions || [];
    const act = (t) => { const x = acts.find((v) => v.action_type === t); return x ? Number(x.value) : 0; };
    const leads = act("lead") || act("offsite_conversion.fb_pixel_lead") || 0;
    const spend = Number(ins.spend || 0);
    const cr = ad.creative || {};
    const clicks = Number(ins.clicks || 0);
    const impressions = Number(ins.impressions || 0);
    const isVideo = !!cr.video_id;
    // para vídeo usa thumbnail; para imagem usa image_url; fallback p/ thumbnail
    const thumbnail = isVideo ? (cr.thumbnail_url || null) : (cr.image_url || cr.thumbnail_url || null);
    return { id: ad.id, name: ad.name, status: ad.status, adSetId,
      thumbnail, isVideo,
      spend, impressions, clicks,
      ctr: impressions ? (clicks / impressions) * 100 : 0,
      leads, cpl: (spend && leads) ? spend / leads : null };
  });
});

ipcMain.handle("meta:toggleAd", async (_e, { adId, status }) => {
  const s = readStore().settings;
  if (!s.metaToken) throw new Error("Token Meta não configurado.");
  return httpJson(`${GRAPH}/${adId}?status=${status}&access_token=${encodeURIComponent(s.metaToken)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
});

/* ---------------------------------------------------------- */
/* Google Ads — Sessão por cliente                            */
/* ---------------------------------------------------------- */

ipcMain.handle("gads:campaigns", async (_e, { customerId, start, end }) => {
  const cid = String(customerId || "").replace(/-/g, "");
  if (!cid) throw new Error("ID de cliente Google Ads não informado.");
  const headers = await gadsHeaders();
  const METRICS = "metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros, metrics.average_cpc";
  const query = `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign.experiment_type, campaign_budget.amount_micros, ${METRICS} FROM campaign WHERE segments.date BETWEEN '${start}' AND '${end}' ORDER BY metrics.cost_micros DESC LIMIT 200`;
  const r = await googleAdsApi(`customers/${cid}/googleAds:search`, { method: "POST", headers, body: JSON.stringify({ query }) });
  return (r.results || []).map((row) => {
    const c = row.campaign || {}; const m = row.metrics || {}; const b = row.campaignBudget || {};
    return {
      id: c.id, name: c.name, status: c.status, channelType: c.advertisingChannelType,
      biddingStrategy: c.biddingStrategyType,
      // experimentType !== BASE → campanha de experimento/teste (não dá p/ pausar pela API)
      isTrial: c.experimentType && c.experimentType !== "BASE",
      budgetMicros: b.amountMicros,
      impressions: Number(m.impressions || 0), clicks: Number(m.clicks || 0),
      conversions: Number(m.conversions || 0), cost: Number(m.costMicros || 0) / 1e6,
      cpc: Number(m.averageCpc || 0) / 1e6,
    };
  });
});

ipcMain.handle("gads:toggleCampaign", async (_e, { customerId, campaignId, status }) => {
  const cid = String(customerId || "").replace(/-/g, "");
  const headers = await gadsHeaders();
  try {
    return await googleAdsApi(`customers/${cid}/campaigns:mutate`, {
      method: "POST", headers, body: JSON.stringify({ operations: [{ update: { resourceName: `customers/${cid}/campaigns/${campaignId}`, status }, updateMask: "status" }] }),
    });
  } catch (e) {
    if (/trial campaign/i.test(e.message || ""))
      throw new Error("Essa é uma campanha de experimento/teste do Google — o Google não deixa pausar pela API. Pause dentro do experimento no Google Ads.");
    throw e;
  }
});

ipcMain.handle("gads:adGroups", async (_e, { customerId, campaignId, start, end }) => {
  const cid = String(customerId || "").replace(/-/g, "");
  const headers = await gadsHeaders();
  const METRICS = "metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros, metrics.average_cpc";
  const where = campaignId ? ` AND campaign.id = ${campaignId}` : "";
  const query = `SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id, ${METRICS} FROM ad_group WHERE segments.date BETWEEN '${start}' AND '${end}'${where} ORDER BY metrics.cost_micros DESC LIMIT 300`;
  const r = await googleAdsApi(`customers/${cid}/googleAds:search`, { method: "POST", headers, body: JSON.stringify({ query }) });
  return (r.results || []).map((row) => {
    const a = row.adGroup || {}; const m = row.metrics || {}; const c = row.campaign || {};
    return { id: a.id, name: a.name, status: a.status, campaignId: c.id,
      impressions: Number(m.impressions || 0), clicks: Number(m.clicks || 0),
      conversions: Number(m.conversions || 0), cost: Number(m.costMicros || 0) / 1e6, cpc: Number(m.averageCpc || 0) / 1e6 };
  });
});

ipcMain.handle("gads:toggleAdGroup", async (_e, { customerId, adGroupId, status }) => {
  const cid = String(customerId || "").replace(/-/g, "");
  const headers = await gadsHeaders();
  return googleAdsApi(`customers/${cid}/adGroups:mutate`, {
    method: "POST", headers, body: JSON.stringify({ operations: [{ update: { resourceName: `customers/${cid}/adGroups/${adGroupId}`, status }, updateMask: "status" }] }),
  });
});

ipcMain.handle("gads:ads", async (_e, { customerId, adGroupId, start, end }) => {
  const cid = String(customerId || "").replace(/-/g, "");
  const headers = await gadsHeaders();
  const METRICS = "metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros";
  const where = adGroupId ? ` AND ad_group.id = ${adGroupId}` : "";
  const query = `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.status, ad_group.id, campaign.id, ${METRICS} FROM ad_group_ad WHERE segments.date BETWEEN '${start}' AND '${end}' AND ad_group_ad.status != 'REMOVED'${where} ORDER BY metrics.cost_micros DESC LIMIT 200`;
  const r = await googleAdsApi(`customers/${cid}/googleAds:search`, { method: "POST", headers, body: JSON.stringify({ query }) });
  return (r.results || []).map((row) => {
    const a = row.adGroupAd || {}; const ad = a.ad || {}; const m = row.metrics || {};
    return { id: ad.id, name: ad.name || `Anúncio ${ad.id}`, type: ad.type, status: a.status,
      adGroupId: (row.adGroup || {}).id, campaignId: (row.campaign || {}).id,
      impressions: Number(m.impressions || 0), clicks: Number(m.clicks || 0),
      conversions: Number(m.conversions || 0), cost: Number(m.costMicros || 0) / 1e6 };
  });
});

ipcMain.handle("gads:toggleAd", async (_e, { customerId, adGroupId, adId, status }) => {
  const cid = String(customerId || "").replace(/-/g, "");
  const headers = await gadsHeaders();
  return googleAdsApi(`customers/${cid}/adGroupAds:mutate`, {
    method: "POST", headers, body: JSON.stringify({ operations: [{ update: { resourceName: `customers/${cid}/adGroupAds/${adGroupId}~${adId}`, status }, updateMask: "status" }] }),
  });
});

// palavras-chave de um grupo, com custo/conversão/CTR — pra otimização
ipcMain.handle("gads:keywords", async (_e, { customerId, adGroupId, start, end }) => {
  const cid = String(customerId || "").replace(/-/g, "");
  const headers = await gadsHeaders();
  const METRICS = "metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros, metrics.average_cpc, metrics.ctr";
  const where = adGroupId ? ` AND ad_group.id = ${adGroupId}` : "";
  // só palavras-chave reais (positivas), não removidas
  const query = `SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.quality_info.quality_score, ad_group.id, campaign.id, ${METRICS} FROM keyword_view WHERE segments.date BETWEEN '${start}' AND '${end}' AND ad_group_criterion.status != 'REMOVED' AND ad_group_criterion.negative = false${where} ORDER BY metrics.cost_micros DESC LIMIT 300`;
  const r = await googleAdsApi(`customers/${cid}/googleAds:search`, { method: "POST", headers, body: JSON.stringify({ query }) });
  return (r.results || []).map((row) => {
    const cr = row.adGroupCriterion || {}; const kw = cr.keyword || {}; const m = row.metrics || {};
    const cost = Number(m.costMicros || 0) / 1e6;
    const conv = Number(m.conversions || 0);
    return {
      id: cr.criterionId, text: kw.text, matchType: kw.matchType, status: cr.status,
      qualityScore: cr.qualityInfo && cr.qualityInfo.qualityScore,
      adGroupId: (row.adGroup || {}).id,
      impressions: Number(m.impressions || 0), clicks: Number(m.clicks || 0),
      conversions: conv, cost, cpc: Number(m.averageCpc || 0) / 1e6,
      ctr: Number(m.ctr || 0), cpa: conv ? cost / conv : null,
    };
  });
});

ipcMain.handle("gads:toggleKeyword", async (_e, { customerId, adGroupId, criterionId, status }) => {
  const cid = String(customerId || "").replace(/-/g, "");
  const headers = await gadsHeaders();
  return googleAdsApi(`customers/${cid}/adGroupCriteria:mutate`, {
    method: "POST", headers, body: JSON.stringify({ operations: [{ update: { resourceName: `customers/${cid}/adGroupCriteria/${adGroupId}~${criterionId}`, status }, updateMask: "status" }] }),
  });
});

// criativos de campanhas Display — retorna imagem para IMAGE_AD e dados de RESPONSIVE_DISPLAY_AD
ipcMain.handle("gads:displayAds", async (_e, { customerId, campaignId, start, end }) => {
  const cid = String(customerId || "").replace(/-/g, "");
  const headers = await gadsHeaders();
  const METRICS = "metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros";
  const campWhere = campaignId ? ` AND campaign.id = ${campaignId}` : " AND campaign.advertising_channel_type = 'DISPLAY'";
  const query = `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.ad.image_ad.image_url, ad_group_ad.ad.image_ad.pixel_width, ad_group_ad.ad.image_ad.pixel_height, ad_group_ad.status, ad_group.id, ad_group.name, campaign.id, ${METRICS} FROM ad_group_ad WHERE segments.date BETWEEN '${start}' AND '${end}' AND ad_group_ad.status != 'REMOVED'${campWhere} ORDER BY metrics.cost_micros DESC LIMIT 200`;
  const r = await googleAdsApi(`customers/${cid}/googleAds:search`, { method: "POST", headers, body: JSON.stringify({ query }) });
  return (r.results || []).map((row) => {
    const a = row.adGroupAd || {}; const ad = a.ad || {}; const m = row.metrics || {};
    const imgAd = ad.imageAd || {};
    const type = ad.type || "";
    const isImageAd = type === "IMAGE_AD";
    const isResponsive = type === "RESPONSIVE_DISPLAY_AD";
    return {
      id: ad.id, name: ad.name || `Anúncio ${ad.id}`, type, status: a.status,
      adGroupId: (row.adGroup || {}).id, adGroupName: (row.adGroup || {}).name || "",
      campaignId: (row.campaign || {}).id,
      imageUrl: isImageAd ? (imgAd.imageUrl || null) : null,
      width: imgAd.pixelWidth || null, height: imgAd.pixelHeight || null,
      isImageAd, isResponsive,
      impressions: Number(m.impressions || 0), clicks: Number(m.clicks || 0),
      conversions: Number(m.conversions || 0), cost: Number(m.costMicros || 0) / 1e6,
    };
  });
});

/* ---------------------------------------------------------- */
/* Janela                                                      */
/* ---------------------------------------------------------- */
function createWindow() {
  const win = new BrowserWindow({
    width: 1320, height: 900, minWidth: 980, minHeight: 600, backgroundColor: "#070a10",
    resizable: true, maximizable: true, fullscreenable: true,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, "..", "src", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

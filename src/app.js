/* ============================================================
   app.js — lógica da interface (renderer)
   Conversa com o processo principal via window.api.*
   e usa o motor compartilhado window.Engine.
   ============================================================ */
const E = window.Engine;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const state = {
  settings: null,
  clients: [],          // favoritos [{projectId,name,trelloBoardId,trelloBoardName}]
  week: null,           // {start,end,label}
  results: null,        // platformResults com edições
  analysisText: "",
};

// onde o painel de análise é montado: null = aba "Painel da semana" (#painelBody);
// um elemento = análise embutida numa aba de sessão (Meta/Google).
let PANEL_MOUNT = null;
// container atual do painel — todas as buscas de elementos do painel são escopadas a ele,
// pra não colidir quando há o Painel da semana E uma análise inline montados ao mesmo tempo.
function panelRoot() { return PANEL_MOUNT || $("#painelBody"); }
// ao interagir com um painel, fixa o alvo de render no container daquele elemento (inline ou o Painel)
function reanchor(el) { PANEL_MOUNT = (el && el.closest && el.closest(".inline-panel")) || null; }

/* ---------------- util de datas (semana seg–dom) ---------------- */
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function mondayOf(d) { const x = new Date(d); const diff = (x.getDay() + 6) % 7; x.setDate(x.getDate() - diff); x.setHours(0, 0, 0, 0); return x; }
function weekFrom(monday) {
  const start = new Date(monday); const end = new Date(monday); end.setDate(end.getDate() + 6);
  const label = `${pad(start.getDate())}/${pad(start.getMonth() + 1)} a ${pad(end.getDate())}/${pad(end.getMonth() + 1)}/${end.getFullYear()}`;
  return { start: iso(start), end: iso(end), label, monday };
}
function defaultWeek() { const t = new Date(); t.setDate(t.getDate() - 7); return weekFrom(mondayOf(t)); }

/* ---------------- markdown → HTML (deixa a análise legível, sem * e # crus) ---------------- */
function mdToHtml(src) {
  if (!src) return "";
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // formatação inline: **negrito**, *itálico*, `código`
  const inline = (s) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  const lines = src.replace(/\r/g, "").split("\n");
  let html = "", i = 0;
  const flushTable = (rows) => {
    // remove linha separadora |---|---|
    const body = rows.filter((r) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(r));
    const cells = (r) => r.replace(/^\s*\||\|\s*$/g, "").split("|").map((c) => c.trim());
    const head = cells(body[0] || "");
    let t = '<table class="md-table"><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>";
    for (const r of body.slice(1)) t += "<tr>" + cells(r).map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
    return t + "</tbody></table>";
  };
  while (i < lines.length) {
    let ln = lines[i];
    if (/^\s*$/.test(ln)) { i++; continue; }
    // tabela (linha com | e a próxima sendo separadora)
    if (/\|/.test(ln) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const rows = []; while (i < lines.length && /\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      html += flushTable(rows); continue;
    }
    // títulos
    const h = ln.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const lv = Math.min(h[1].length + 1, 4); html += `<h${lv}>${inline(h[2])}</h${lv}>`; i++; continue; }
    // divisória ---
    if (/^\s*([-*_])\1{2,}\s*$/.test(ln)) { html += "<hr>"; i++; continue; }
    // lista numerada
    if (/^\s*\d+[.)]\s+/.test(ln)) {
      html += "<ol>";
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { html += `<li>${inline(lines[i].replace(/^\s*\d+[.)]\s+/, ""))}</li>`; i++; }
      html += "</ol>"; continue;
    }
    // lista com marcador
    if (/^\s*[-*•]\s+/.test(ln)) {
      html += "<ul>";
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) { html += `<li>${inline(lines[i].replace(/^\s*[-*•]\s+/, ""))}</li>`; i++; }
      html += "</ul>"; continue;
    }
    // parágrafo (junta linhas seguidas)
    const para = [ln]; i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^\s*([#>|]|\d+[.)]\s|[-*•]\s)/.test(lines[i])) { para.push(lines[i]); i++; }
    html += `<p>${inline(para.join(" "))}</p>`;
  }
  return html;
}

/* ---------------- toast ---------------- */
let toastTimer;
function toast(msg, isErr) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
  t.className = "toast" + (isErr ? " err" : "");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 4200);
}

/* ---------------- navegação ---------------- */
const ALL_VIEWS = ["semana", "painel", "urgencia", "funil", "subida", "termos", "kw", "meta", "gads", "gtm", "perfil", "relatorios", "historico", "config"];
$$(".nav .tab").forEach((b) => b.addEventListener("click", () => {
  $$(".nav .tab").forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
  ALL_VIEWS.forEach((v) => $("#view-" + v).classList.toggle("hidden", v !== b.dataset.view));
  if (b.dataset.view === "semana") renderSemana();
  if (b.dataset.view === "kw") loadKw();
  if (b.dataset.view === "historico") renderHistory();
  if (b.dataset.view === "perfil") loadPerfil();
  if (b.dataset.view === "meta") initMetaSession();
  if (b.dataset.view === "gads") initGadsSession();
  if (b.dataset.view === "gtm") initGtmSession();
}));

// links externos (ex.: "onde pegar a chave") abrem no navegador, não dentro do app
document.addEventListener("click", (e) => {
  const a = e.target.closest("a.ext");
  if (a && a.href) { e.preventDefault(); window.api.openExternal(a.href); }
});

/* ---------------- init ---------------- */
(async function init() {
  state.settings = await window.api.getSettings();
  state.clients = await window.api.getClients();
  fillConfig();
  fillClientSelectors();
  state.week = defaultWeek();
  $("#weekLabel").value = state.week.label;
  const lm = new Date(); lm.setDate(1); lm.setMonth(lm.getMonth() - 1);
  state.repMonth = { y: lm.getFullYear(), m: lm.getMonth() + 1 };
  renderRepMonth();
  updateNavHint();
  renderSemana(); // aba inicial
  try { const u = await window.api.updateCheck(); $("#appVersion").textContent = "v" + (u.local || "?"); } catch {}
})();

/* ---------------- atualização do app (patch leve) ---------------- */
$("#updateCheckBtn").addEventListener("click", async () => {
  const m = $("#updateMsg"); m.textContent = "verificando…";
  try {
    // garante que a URL atual está salva antes de verificar
    await window.api.setSettings({ updateBaseUrl: $("#cfgUpdateUrl").value.trim().replace(/\/+$/, "") });
    const u = await window.api.updateCheck();
    $("#appVersion").textContent = "v" + (u.local || "?");
    if (!u.configured) { m.textContent = "❌ cole o link do repositório de atualização."; return; }
    if (!u.hasUpdate) { m.textContent = `✅ já está na versão mais recente (v${u.local}).`; return; }
    m.innerHTML = `🆕 nova versão <b>v${u.latest}</b> disponível${u.notes ? " — " + u.notes : ""}. `;
    const btn = document.createElement("button"); btn.className = "btn btn-primary"; btn.style.marginLeft = "8px"; btn.style.padding = "6px 12px"; btn.textContent = `Atualizar pra v${u.latest}`;
    btn.addEventListener("click", async () => {
      if (!window.confirm(`Atualizar pra v${u.latest}? O app vai baixar ${u.files.length} arquivo(s) e reiniciar.`)) return;
      btn.disabled = true; btn.textContent = "Baixando…";
      try { await window.api.updateApply({ base: u.base, files: u.files, version: u.latest }); }
      catch (e) { m.textContent = "❌ " + e.message; btn.disabled = false; }
    });
    m.appendChild(btn);
  } catch (e) { m.textContent = "❌ " + e.message; }
});

/* ---------------- seletor de mês (relatórios) ---------------- */
function monthLabelOf(y, m) { return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }); }
function renderRepMonth() { $("#repMonthLabel").value = monthLabelOf(state.repMonth.y, state.repMonth.m); }
function shiftMonth(delta) {
  const d = new Date(state.repMonth.y, state.repMonth.m - 1 + delta, 1);
  state.repMonth = { y: d.getFullYear(), m: d.getMonth() + 1 };
  renderRepMonth();
}
$("#monthPrev").addEventListener("click", () => shiftMonth(-1));
$("#monthNext").addEventListener("click", () => shiftMonth(1));

function updateNavHint() {
  const s = state.settings || {};
  const missing = [];
  if (!s.reporteiToken) missing.push("Reportei");
  if (!s.trelloKey || !s.trelloToken) missing.push("Trello");
  if (!s.geminiKey) missing.push("Gemini");
  $("#navHint").textContent = missing.length
    ? `Faltam chaves: ${missing.join(", ")}. Abra Configurações.`
    : `${state.clients.length} cliente(s) no painel.`;
}

/* ============================================================
   CONFIGURAÇÕES
   ============================================================ */
function fillConfig() {
  const s = state.settings || {};
  $("#cfgReportei").value = s.reporteiToken || "";
  $("#cfgTrelloKey").value = s.trelloKey || "";
  $("#cfgTrelloToken").value = s.trelloToken || "";
  $("#cfgGemini").value = s.geminiKey || "";
  $("#cfgGeminiModel").value = s.geminiModel || "gemini-2.5-flash";
  $("#cfgGoogleSheets").value = s.googleSheetsKey || "";
  $("#cfgPageSpeed").value = s.pageSpeedKey || "";
  $("#cfgUpdateUrl").value = s.updateBaseUrl || "";
  if ($("#cfgEkyteKey")) {
    $("#cfgEkyteKey").value = s.ekyteKey || ""; $("#cfgEkyteAnalyst").value = s.ekyteAnalystEmail || ""; $("#cfgEkytePo").value = s.ekytePoEmail || ""; $("#cfgEkyteCompany").value = s.ekyteCompanyId || ""; $("#cfgEkyteWebhook").value = s.ekyteWebhookUrl || ""; $("#cfgEkyteMcpUrl").value = s.ekyteMcpUrl || ""; $("#cfgEkyteMcpToken").value = s.ekyteMcpToken || "";
    if (s.ekyteTaskTypeId) $("#cfgEkyteTaskType").innerHTML = `<option value="${s.ekyteTaskTypeId}" selected>tipo #${s.ekyteTaskTypeId} (clique "carregar tipos" p/ ver o nome)</option>`;
  }
  $("#cfgMetaToken").value = s.metaToken || "";
  $("#cfgGadsDev").value = s.googleAdsDevToken || "";
  $("#cfgGadsCid").value = s.googleAdsClientId || "";
  $("#cfgGadsSec").value = s.googleAdsClientSecret || "";
  $("#cfgGadsRef").value = s.googleAdsRefreshToken || "";
  $("#cfgGadsMcc").value = s.googleAdsLoginCustomerId || "";
  $("#cfgReportTemplate").value = s.reportTemplate || "";
  if ($("#cfgAiEngine")) $("#cfgAiEngine").value = s.aiEngine || "gemini";
  renderMyClients();
}
$("#saveTemplateBtn").addEventListener("click", async () => {
  state.settings = await window.api.setSettings({ reportTemplate: $("#cfgReportTemplate").value });
  toast("Modelo de relatório salvo.");
});
$("#saveCfgBtn").addEventListener("click", async () => {
  state.settings = await window.api.setSettings({
    reporteiToken: $("#cfgReportei").value.trim(),
    trelloKey: $("#cfgTrelloKey").value.trim(),
    trelloToken: $("#cfgTrelloToken").value.trim(),
    geminiKey: $("#cfgGemini").value.trim(),
    geminiModel: $("#cfgGeminiModel").value.trim() || "gemini-2.5-flash",
    aiEngine: ($("#cfgAiEngine") && $("#cfgAiEngine").value) || "gemini",
    googleSheetsKey: $("#cfgGoogleSheets").value.trim(),
    pageSpeedKey: $("#cfgPageSpeed").value.trim(),
    updateBaseUrl: $("#cfgUpdateUrl").value.trim().replace(/\/+$/, ""),
    metaToken: $("#cfgMetaToken").value.trim(),
    googleAdsDevToken: $("#cfgGadsDev").value.trim(),
    googleAdsClientId: $("#cfgGadsCid").value.trim(),
    googleAdsClientSecret: $("#cfgGadsSec").value.trim(),
    googleAdsRefreshToken: $("#cfgGadsRef").value.trim(),
    googleAdsLoginCustomerId: $("#cfgGadsMcc").value.trim().replace(/-/g, ""),
  });
  updateNavHint();
  toast("Chaves salvas com segurança no seu PC.");
});

/* ---------------- Ekyte ---------------- */
function populateEkyteTypes(list) {
  const sel = $("#cfgEkyteTaskType"); if (!sel || !Array.isArray(list)) return;
  const cur = (state.settings && state.settings.ekyteTaskTypeId) || sel.value || "";
  sel.innerHTML = '<option value="">— selecione o tipo —</option>' + list.map((t) => `<option value="${t.id}">${t.nome || t.id} · #${t.id}</option>`).join("");
  if (cur) sel.value = String(cur);
}
$("#saveEkyteBtn").addEventListener("click", async () => {
  state.settings = await window.api.setSettings({
    ekyteKey: $("#cfgEkyteKey").value.trim(),
    ekyteAnalystEmail: $("#cfgEkyteAnalyst").value.trim(),
    ekytePoEmail: $("#cfgEkytePo").value.trim(),
    ekyteCompanyId: $("#cfgEkyteCompany").value.trim(),
    ekyteTaskTypeId: $("#cfgEkyteTaskType").value.trim(),
    ekyteWebhookUrl: $("#cfgEkyteWebhook").value.trim(),
    ekyteMcpUrl: $("#cfgEkyteMcpUrl").value.trim(),
    ekyteMcpToken: $("#cfgEkyteMcpToken").value.trim(),
  });
  $("#ekyteMsg").textContent = "✅ salvo";
  toast("Ekyte salvo.");
});
$("#ekyteMcpTestBtn").addEventListener("click", async () => {
  const msg = $("#ekyteMcpMsg"); const box = $("#ekyteMcpBox");
  msg.textContent = "testando…"; box.innerHTML = "";
  try {
    state.settings = await window.api.setSettings({ ekyteMcpUrl: $("#cfgEkyteMcpUrl").value.trim(), ekyteMcpToken: $("#cfgEkyteMcpToken").value.trim() });
    const r = await window.api.ekyteMcpTest();
    msg.textContent = "✅ conectou — veja as ações habilitadas abaixo";
    box.innerHTML = `<pre style="white-space:pre-wrap;font-size:11px;color:var(--muted);max-height:300px;overflow:auto;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:10px">${(r.enabled || "(vazio)").replace(/</g, "&lt;")}</pre>`;
  } catch (e) { msg.textContent = "❌ " + e.message; }
});
$("#ekyteLoadTypesBtn").addEventListener("click", async () => {
  const btn = $("#ekyteLoadTypesBtn"); btn.disabled = true; btn.textContent = "…";
  try { await window.api.setSettings({ ekyteKey: $("#cfgEkyteKey").value.trim(), ekyteCompanyId: $("#cfgEkyteCompany").value.trim() }); state.settings = await window.api.getSettings(); populateEkyteTypes(await window.api.ekyteTaskTypes()); toast("Tipos de tarefa carregados — escolha o de otimização."); }
  catch (e) { toast("Ekyte: " + e.message, true); }
  btn.disabled = false; btn.textContent = "↻ carregar tipos";
});
$("#ekyteTestBtn").addEventListener("click", async () => {
  const msg = $("#ekyteTestMsg"); const box = $("#ekyteInfoBox");
  msg.textContent = "testando…"; box.innerHTML = "";
  try {
    // garante que a chave digitada está salva antes de testar
    state.settings = await window.api.setSettings({ ekyteKey: $("#cfgEkyteKey").value.trim(), ekyteCompanyId: $("#cfgEkyteCompany").value.trim() });
    const r = await window.api.ekyteTest();
    const ok = Array.isArray(r.WORKSPACES);
    if (Array.isArray(r.TIPOS_DE_TAREFA)) populateEkyteTypes(r.TIPOS_DE_TAREFA);
    msg.textContent = ok ? `✅ conexão ok — ${r.WORKSPACES.length} workspaces, ${(r.TIPOS_DE_TAREFA || []).length} tipos de tarefa` : "⚠️ respondeu, confira abaixo";
    const fmt = (v) => `<pre style="white-space:pre-wrap;font-size:11px;color:var(--muted);max-height:220px;overflow:auto;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:8px">${JSON.stringify(v, null, 2).slice(0, 1500)}</pre>`;
    box.innerHTML = Object.entries(r).map(([k, v]) => `<div style="font-size:12px;margin-top:6px"><b>${k}</b> ${fmt(v)}</div>`).join("");
  } catch (e) { msg.textContent = "❌ " + e.message; }
});

/* testar qual motor de IA está ativo (Claude do plano / Gemini) */
const aiTestBtn = $("#aiTestBtn");
if (aiTestBtn) aiTestBtn.addEventListener("click", async () => {
  const m = $("#aiTestMsg"); m.textContent = "verificando…";
  try {
    const info = await window.api.aiEngineInfo();
    if (info.prefer === "nenhum") { m.innerHTML = `❌ Nenhum motor disponível. Configure a chave do Gemini ou conecte o Claude Code.`; return; }
    const backup = info.engine === "claude" ? (info.gemini ? "Gemini fica de backup." : "sem backup — configure o Gemini.") : (info.claude ? "Claude (seu plano) fica de backup." : "sem backup do Claude (Claude Code não detectado).");
    m.innerHTML = `✅ Principal: <b>${info.prefer}</b>. ${backup} <span style="color:var(--muted)">(salve as chaves se acabou de trocar)</span>`;
  } catch (e) { m.textContent = "❌ " + e.message; }
});

/* busca de projetos no Reportei */
$("#projSearch").addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const q = e.target.value.trim();
  const box = $("#projResults");
  box.innerHTML = '<div class="state">Buscando…</div>';
  try {
    const projs = await window.api.reporteiProjects(q);
    box.innerHTML = projs.length ? "" : '<div class="state">Nenhum projeto encontrado.</div>';
    projs.slice(0, 30).forEach((p) => {
      const row = document.createElement("div");
      row.className = "clientrow";
      const already = state.clients.some((c) => c.projectId === p.id);
      row.innerHTML = `<div class="cname">${p.name}</div>`;
      const btn = document.createElement("button");
      btn.className = "chip-btn"; btn.textContent = already ? "✓ adicionado" : "+ adicionar";
      btn.disabled = already;
      btn.addEventListener("click", () => addClient(p));
      row.appendChild(btn);
      box.appendChild(row);
    });
  } catch (err) { box.innerHTML = `<div class="state error">Erro: ${err.message}</div>`; }
});

async function addClient(proj) {
  // tenta casar o board do Trello pelo nome
  let board = null;
  try { const boards = await window.api.trelloBoards(proj.name); board = boards.find((b) => b.name.trim().toLowerCase() === proj.name.trim().toLowerCase()) || boards[0] || null; } catch {}
  state.clients.push({ projectId: proj.id, name: proj.name, trelloBoardId: board ? board.id : "", trelloBoardName: board ? board.name : "" });
  await window.api.setClients(state.clients);
  fillClientSelectors(); renderMyClients(); updateNavHint();
  $("#projResults").innerHTML = "";
  $("#projSearch").value = "";
  toast(`${proj.name} adicionado.`);
}

// id local estável e único pra cliente que entra pelo Trello (sem projeto no Reportei) — negativo p/ não colidir com IDs do Reportei
function trelloPid(boardId) { let h = 0; for (const ch of String(boardId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return -h; }
// id que vai pro Reportei: reporteiId vinculado > projectId clássico > null (cliente só do Trello)
function reporteiIdOf(cli) {
  if (!cli) return null;
  if (cli.reporteiId) return cli.reporteiId;   // entrou pelo Trello e foi vinculado a um projeto Reportei depois
  if (cli.noReportei) return null;             // só Trello, sem projeto no Reportei
  return cli.projectId;                        // cliente clássico (projectId = id do Reportei)
}

async function addClientFromBoard(board) {
  if (state.clients.some((c) => c.trelloBoardId === board.id)) { toast("Esse board já está no painel.", true); return; }
  state.clients.push({ projectId: trelloPid(board.id), name: board.name, trelloBoardId: board.id, trelloBoardName: board.name, noReportei: true });
  await window.api.setClients(state.clients);
  fillClientSelectors(); renderMyClients(); updateNavHint();
  $("#boardResults").innerHTML = ""; $("#boardSearch").value = "";
  toast(`${board.name} adicionado pelo Trello. Vincule a conta Meta/Google em "contas" para puxar os dados.`);
}

$("#boardSearch").addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const q = e.target.value.trim();
  const box = $("#boardResults");
  box.innerHTML = '<div class="state">Buscando boards…</div>';
  try {
    const boards = await window.api.trelloBoards(q);
    box.innerHTML = boards.length ? "" : '<div class="state">Nenhum board encontrado. Confira as chaves do Trello em cima.</div>';
    boards.slice(0, 30).forEach((b) => {
      const row = document.createElement("div");
      row.className = "clientrow";
      const already = state.clients.some((c) => c.trelloBoardId === b.id);
      row.innerHTML = `<div class="cname">${b.name}</div>`;
      const btn = document.createElement("button");
      btn.className = "chip-btn"; btn.textContent = already ? "✓ adicionado" : "+ adicionar";
      btn.disabled = already;
      btn.addEventListener("click", () => addClientFromBoard(b));
      row.appendChild(btn);
      box.appendChild(row);
    });
  } catch (err) { box.innerHTML = `<div class="state error">Erro: ${err.message}</div>`; }
});

function renderMyClients() {
  const box = $("#myClients");
  if (!state.clients.length) { box.innerHTML = '<div class="state">Nenhum cliente ainda. Busque acima.</div>'; return; }
  box.innerHTML = "";
  state.clients.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "clientrow";
    row.innerHTML = `<div class="cname">${c.name}</div>
      <div class="cboard">${c.trelloBoardName ? "🔗 " + c.trelloBoardName : "⚠️ board não vinculado"}</div>`;
    const link = document.createElement("button");
    link.className = "chip-btn"; link.textContent = c.trelloBoardId ? "trocar board" : "vincular board";
    link.addEventListener("click", () => startLinkBoard(i));
    const rm = document.createElement("button");
    rm.className = "chip-btn danger"; rm.textContent = "remover";
    rm.addEventListener("click", async () => { state.clients.splice(i, 1); await window.api.setClients(state.clients); fillClientSelectors(); renderMyClients(); updateNavHint(); });
    const bench = document.createElement("button");
    bench.className = "chip-btn"; bench.textContent = "benchmarks";
    bench.addEventListener("click", () => startBenchEdit(i));
    const leads = document.createElement("button");
    leads.className = "chip-btn"; leads.textContent = c.leads && c.leads.sheetUrl ? "leads ✓" : "leads (MQL)";
    leads.addEventListener("click", () => startLeadsEdit(i));
    const cpl = document.createElement("button");
    cpl.className = "chip-btn"; cpl.textContent = c.cplIdeal ? "CPL ✓" : "CPL ideal";
    cpl.addEventListener("click", () => startCplEdit(i));
    const acc = document.createElement("button");
    acc.className = "chip-btn"; acc.textContent = (c.adAccounts && (c.adAccounts.meta || c.adAccounts.google)) ? "contas ✓" : "contas";
    acc.addEventListener("click", () => startContasEdit(i));
    const bud = document.createElement("button");
    bud.className = "chip-btn"; bud.textContent = (c.budget && (c.budget.meta || c.budget.google || c.budget.linkedin)) ? "orçamento ✓" : "orçamento";
    bud.addEventListener("click", () => startBudgetEdit(i));
    // vincular projeto do Reportei — só p/ clientes que entraram pelo Trello (sem projeto no Reportei)
    let rep = null;
    if (c.noReportei || c.reporteiId) {
      rep = document.createElement("button");
      rep.className = "chip-btn"; rep.textContent = c.reporteiId ? "Reportei ✓" : "🔗 Reportei";
      rep.addEventListener("click", () => startLinkReportei(i));
    }
    row.appendChild(link); row.appendChild(bench); row.appendChild(leads); row.appendChild(cpl); row.appendChild(acc); row.appendChild(bud); if (rep) row.appendChild(rep); row.appendChild(rm);
    box.appendChild(row);
    const search = document.createElement("div"); search.id = "linkbox-" + i; box.appendChild(search);
    const rbox = document.createElement("div"); rbox.id = "repbox-" + i; box.appendChild(rbox);
    const bbox = document.createElement("div"); bbox.id = "benchbox-" + i; box.appendChild(bbox);
    const lbox = document.createElement("div"); lbox.id = "leadsbox-" + i; box.appendChild(lbox);
    const cbox = document.createElement("div"); cbox.id = "cplbox-" + i; box.appendChild(cbox);
    const abox = document.createElement("div"); abox.id = "accbox-" + i; box.appendChild(abox);
    const budbox = document.createElement("div"); budbox.id = "budgetbox-" + i; box.appendChild(budbox);
  });
}

// vincular um projeto do Reportei a um cliente que entrou pelo board do Trello
function startLinkReportei(i) {
  const c = state.clients[i]; const box = $("#repbox-" + i);
  if (box.innerHTML) { box.innerHTML = ""; return; } // toggle
  box.innerHTML = `<input type="text" id="rpq-${i}" placeholder="Buscar projeto no Reportei (Enter)" style="width:100%;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:8px 10px;color:var(--txt);margin:6px 0"><div class="search-results" id="rpr-${i}"></div>`;
  const inp = $("#rpq-" + i); inp.value = c.name; inp.focus();
  const run = async () => {
    const res = $("#rpr-" + i); res.innerHTML = '<div class="state">buscando…</div>';
    try {
      const projs = await window.api.reporteiProjects(inp.value.trim());
      res.innerHTML = projs.length ? "" : '<div class="state">Nenhum projeto com esse nome no Reportei.</div>';
      projs.slice(0, 25).forEach((p) => {
        const it = document.createElement("div"); it.className = "clientrow";
        it.innerHTML = `<div class="cname" style="font-weight:500">${p.name} <span class="hist-meta">${p.id}</span></div>`;
        const pick = document.createElement("button"); pick.className = "chip-btn"; pick.textContent = "vincular";
        pick.addEventListener("click", async () => { c.reporteiId = p.id; delete c.noReportei; await window.api.setClients(state.clients); box.innerHTML = ""; renderMyClients(); toast(`${c.name} → Reportei "${p.name}" vinculado.`); });
        it.appendChild(pick); res.appendChild(it);
      });
    } catch (e) { res.innerHTML = `<div class="state error">Erro: ${e.message}</div>`; }
  };
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  run();
}

// puxa o orçamento do Trello (coluna "Investimento Mensal") de TODOS os clientes com board
$("#pullBudgetsBtn").addEventListener("click", async () => {
  const btn = $("#pullBudgetsBtn"); const msg = $("#pullBudgetsMsg");
  const comBoard = state.clients.filter((c) => c.trelloBoardId);
  if (!comBoard.length) { toast("Nenhum cliente com board do Trello vinculado.", true); return; }
  btn.disabled = true; let ok = 0, vazios = 0;
  for (const c of comBoard) {
    msg.textContent = `lendo ${c.name}…`;
    try {
      const b = await window.api.trelloBudget({ boardId: c.trelloBoardId });
      if (b && (b.meta != null || b.google != null || b.linkedin != null)) {
        c.budget = { meta: b.meta || 0, google: b.google || 0, linkedin: b.linkedin || 0 };
        ok++;
      } else vazios++;
    } catch { vazios++; }
  }
  await window.api.setClients(state.clients);
  state.pacing = null; // invalida cache do pacing
  renderMyClients();
  btn.disabled = false;
  msg.textContent = `✅ ${ok} cliente(s) com orçamento puxado${vazios ? ` · ${vazios} sem coluna/valor` : ""}.`;
  toast(`Orçamentos puxados do Trello: ${ok} cliente(s).`);
});

// orçamento mensal de mídia por plataforma (usado no pacing da aba Minha Semana)
function startBudgetEdit(i) {
  const c = state.clients[i]; const box = $("#budgetbox-" + i);
  if (box.innerHTML) { box.innerHTML = ""; return; }
  const B = c.budget || {};
  const f = (id, v) => `<input id="${id}-${i}" value="${v || ""}" placeholder="0" style="width:100%;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:7px 9px;color:var(--txt);outline:none">`;
  box.innerHTML = `<div class="card" style="margin:8px 0;padding:14px 16px">
    <p class="sub" style="margin-bottom:10px">Orçamento <b>mensal</b> de mídia por plataforma (R$). Usado no <b>pacing</b> — acompanhar se o gasto do mês está no ritmo certo.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <div class="formrow" style="flex:1;min-width:130px"><label>Meta (R$/mês)</label>${f("budMeta", B.meta)}</div>
      <div class="formrow" style="flex:1;min-width:130px"><label>Google (R$/mês)</label>${f("budGoogle", B.google)}</div>
      <div class="formrow" style="flex:1;min-width:130px"><label>LinkedIn (R$/mês)</label>${f("budLinkedin", B.linkedin)}</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-primary" id="budSave-${i}" style="padding:8px 14px">Salvar</button>
      <button class="chip-btn" id="budTrello-${i}">📥 Puxar do Trello</button>
      <span id="budTotal-${i}" style="font-size:13px;color:var(--accent);font-weight:700"></span>
    </div></div>`;
  const num = (id) => parseFloat(String($("#" + id + "-" + i).value).replace(/[^\d.,]/g, "").replace(/\.(?=\d{3})/g, "").replace(",", ".")) || 0;
  const showTotal = () => { const t = num("budMeta") + num("budGoogle") + num("budLinkedin"); $("#budTotal-" + i).textContent = t ? `Total: R$ ${t.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mês` : ""; };
  box.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", showTotal)); showTotal();
  $("#budTrello-" + i).addEventListener("click", async () => {
    if (!c.trelloBoardId) { toast("Vincule o board do Trello deste cliente primeiro.", true); return; }
    const tb = $("#budTrello-" + i); tb.disabled = true; tb.textContent = "Puxando…";
    try {
      const b = await window.api.trelloBudget({ boardId: c.trelloBoardId });
      if (!b || (b.meta == null && b.google == null && b.linkedin == null)) { toast("Não achei a coluna 'Investimento Mensal' (ou está vazia) no board.", true); }
      else { if (b.meta != null) $("#budMeta-" + i).value = b.meta; if (b.google != null) $("#budGoogle-" + i).value = b.google; if (b.linkedin != null) $("#budLinkedin-" + i).value = b.linkedin; showTotal(); toast("Orçamento puxado do Trello — confira e Salve."); }
    } catch (e) { toast("Trello: " + e.message, true); }
    tb.disabled = false; tb.textContent = "📥 Puxar do Trello";
  });
  $("#budSave-" + i).addEventListener("click", async () => {
    c.budget = { meta: num("budMeta"), google: num("budGoogle"), linkedin: num("budLinkedin") };
    await window.api.setClients(state.clients);
    state.pacing = null; // invalida o cache do pacing
    box.innerHTML = ""; renderMyClients(); toast(`Orçamento de ${c.name} salvo.`);
  });
}

// contas de anúncio do cliente (pra subida de rascunhos)
function startContasEdit(i) {
  const c = state.clients[i]; const box = $("#accbox-" + i);
  if (box.innerHTML) { box.innerHTML = ""; return; }
  const A = c.adAccounts || {};
  box.innerHTML = `<div class="card" style="margin:8px 0;padding:14px 16px">
    <p class="sub" style="margin-bottom:10px">Contas de anúncio deste cliente — usadas pela aba 🚀 Subida pra criar os rascunhos no lugar certo.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <div class="formrow" style="flex:1;min-width:220px"><label>Meta — Ad Account (act_...)</label>
        <input id="accMeta-${i}" value="${A.meta || ""}" placeholder="act_1234567890" style="background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:8px 10px;color:var(--txt);outline:none"></div>
      <div class="formrow" style="flex:1;min-width:200px"><label>Google Ads — Customer ID</label>
        <input id="accGoogle-${i}" value="${A.google || ""}" placeholder="123-456-7890" style="background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:8px 10px;color:var(--txt);outline:none">
        <div style="display:flex;gap:6px;margin-top:6px;align-items:center"><button class="chip-btn" id="accGList-${i}">buscar contas do Google</button><span id="accGName-${i}" style="font-size:12px;color:var(--muted)">${A.googleName || ""}</span></div>
        <div class="search-results" id="accGRes-${i}"></div>
      </div>
    </div>
    <p class="sub" style="margin:12px 0 6px;border-top:1px solid var(--line);padding-top:12px">📋 <b>Beneficiário e pagador (Meta — obrigatório p/ Brasil)</b><br>Use o nome EXATO da empresa <b>já verificada</b> no Gerenciador de Anúncios desse cliente. Sem isso, o Meta recusa criar conjuntos que miram o Brasil.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <div class="formrow" style="flex:1;min-width:220px"><label>Beneficiário</label>
        <input id="accBenef-${i}" value="${A.metaBeneficiary || ""}" placeholder="Nome da empresa (verificada no Meta)" style="background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:8px 10px;color:var(--txt);outline:none"></div>
      <div class="formrow" style="flex:1;min-width:220px"><label>Pagador (geralmente o mesmo)</label>
        <input id="accPayor-${i}" value="${A.metaPayor || ""}" placeholder="Nome da empresa que paga" style="background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:8px 10px;color:var(--txt);outline:none"></div>
    </div>
    <p class="sub" style="margin:12px 0 6px;border-top:1px solid var(--line);padding-top:12px">📊 <b>Analytics & Site (Taxa de Conexão + velocidade)</b></p>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <div class="formrow" style="flex:1;min-width:200px"><label>GA4 — Property ID (sessões)</label>
        <input id="accGa4-${i}" value="${A.ga4PropertyId || ""}" placeholder="ex.: 312345678" style="background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:8px 10px;color:var(--txt);outline:none"></div>
      <div class="formrow" style="flex:1;min-width:220px"><label>Site (pra PageSpeed)</label>
        <input id="accSite-${i}" value="${A.site || ""}" placeholder="https://site-do-cliente.com" style="background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:8px 10px;color:var(--txt);outline:none"></div>
    </div>
    <p class="sub" style="margin:12px 0 6px;border-top:1px solid var(--line);padding-top:12px">📄 <b>Página do Facebook (Meta — p/ subir anúncio)</b><br>O anúncio é publicado em nome desta Página.</p>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input id="accPage-${i}" value="${A.metaPageId || ""}" placeholder="ID da Página" style="flex:1;min-width:200px;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:8px 10px;color:var(--txt);outline:none">
      <button class="chip-btn" id="accPageList-${i}">listar Páginas</button>
      <span id="accPageName-${i}" style="font-size:12px;color:var(--muted)">${A.metaPageName || ""}</span>
    </div>
    <div class="search-results" id="accPageRes-${i}"></div>
    <div style="display:flex;gap:8px;margin-top:12px;align-items:center">
      <button class="btn btn-primary" id="accSave-${i}" style="padding:8px 14px">Salvar</button>
      <button class="chip-btn" id="accList-${i}">listar contas do Meta</button>
      <span id="accMsg-${i}" style="font-size:12px;color:var(--muted)"></span>
    </div>
    <div class="search-results" id="accRes-${i}"></div>
  </div>`;
  $("#accGList-" + i).addEventListener("click", async () => {
    const res = $("#accGRes-" + i); res.innerHTML = "buscando contas da MCC…";
    try {
      const accs = await window.api.googleAdsAccounts();
      if (!accs.length) { res.innerHTML = '<span class="hist-meta">nenhuma conta encontrada na MCC</span>'; return; }
      const render = (filter) => {
        const f = (filter || "").toLowerCase();
        const list = accs.filter((a) => !f || a.name.toLowerCase().includes(f) || a.id.includes(f));
        res.innerHTML = `<input id="accGSearch-${i}" placeholder="filtrar por nome…" style="width:100%;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:7px 10px;color:var(--txt);outline:none;margin-bottom:6px">`;
        list.slice(0, 40).forEach((a) => {
          const rowEl = document.createElement("div"); rowEl.className = "clientrow";
          rowEl.innerHTML = `<div class="cname" style="font-weight:500">${a.name} <span class="hist-meta">${a.id}</span></div>`;
          const pick = document.createElement("button"); pick.className = "chip-btn"; pick.textContent = "usar";
          pick.addEventListener("click", () => { $("#accGoogle-" + i).value = a.id; $("#accGName-" + i).textContent = a.name; res.innerHTML = ""; });
          rowEl.appendChild(pick); res.appendChild(rowEl);
        });
        const si = $("#accGSearch-" + i); si.value = filter || ""; si.focus();
        si.addEventListener("input", (e) => render(e.target.value));
      };
      render("");
    } catch (e) { res.innerHTML = `<span style="color:var(--bad)">❌ ${e.message}</span>`; }
  });
  $("#accPageList-" + i).addEventListener("click", async () => {
    const res = $("#accPageRes-" + i); res.innerHTML = "buscando…";
    try {
      const pages = await window.api.metaPages();
      res.innerHTML = "";
      if (!pages.length) { res.innerHTML = '<span class="hist-meta">nenhuma Página acessível com este token</span>'; return; }
      pages.forEach((pg) => {
        const rowEl = document.createElement("div"); rowEl.className = "clientrow";
        rowEl.innerHTML = `<div class="cname" style="font-weight:500">${pg.name} <span class="hist-meta">${pg.id}</span></div>`;
        const pick = document.createElement("button"); pick.className = "chip-btn"; pick.textContent = "usar";
        pick.addEventListener("click", () => { $("#accPage-" + i).value = pg.id; $("#accPageName-" + i).textContent = pg.name; res.innerHTML = ""; });
        rowEl.appendChild(pick); res.appendChild(rowEl);
      });
    } catch (e) { res.innerHTML = `<span style="color:var(--bad)">❌ ${e.message}</span>`; }
  });
  $("#accSave-" + i).addEventListener("click", async () => {
    const metaRaw = $("#accMeta-" + i).value.trim().replace(/^act_/, "");
    c.adAccounts = { meta: metaRaw ? "act_" + metaRaw : "", google: $("#accGoogle-" + i).value.trim().replace(/-/g, ""), googleName: $("#accGName-" + i).textContent.trim(), metaBeneficiary: $("#accBenef-" + i).value.trim(), metaPayor: $("#accPayor-" + i).value.trim(), metaPageId: $("#accPage-" + i).value.trim(), metaPageName: $("#accPageName-" + i).textContent.trim(), ga4PropertyId: $("#accGa4-" + i).value.trim(), site: $("#accSite-" + i).value.trim() };
    await window.api.setClients(state.clients);
    box.innerHTML = ""; renderMyClients(); toast(`Contas de ${c.name} salvas.`);
  });
  $("#accList-" + i).addEventListener("click", async () => {
    const msg = $("#accMsg-" + i); msg.textContent = "buscando…";
    try {
      const accs = await window.api.metaTest();
      msg.textContent = `${accs.length} conta(s):`;
      const res = $("#accRes-" + i); res.innerHTML = "";
      accs.forEach((a) => {
        const rowEl = document.createElement("div"); rowEl.className = "clientrow";
        rowEl.innerHTML = `<div class="cname" style="font-weight:500">${a.name} <span class="hist-meta">${a.id}</span></div>`;
        const pick = document.createElement("button"); pick.className = "chip-btn"; pick.textContent = "usar";
        pick.addEventListener("click", () => { $("#accMeta-" + i).value = a.id; res.innerHTML = ""; msg.textContent = ""; });
        rowEl.appendChild(pick); res.appendChild(rowEl);
      });
    } catch (e) { msg.textContent = "❌ " + e.message; }
  });
}

function startCplEdit(i) {
  const c = state.clients[i]; const box = $("#cplbox-" + i);
  if (box.innerHTML) { box.innerHTML = ""; return; }
  const C = c.cplIdeal || { rateMqlSql: 15, rateSqlVenda: 10, ltvCac: 3 };
  const f = (id, val, ph) => `<input id="${id}-${i}" value="${val != null ? val : ""}" placeholder="${ph || ""}" style="width:100%;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:7px 9px;color:var(--txt);outline:none">`;
  const num = (id) => parseFloat(String($("#" + id + "-" + i).value).replace(",", ".")) || 0;
  const collect = () => ({ ticketMedio: parseInt(String($("#cti-" + i).value).replace(/\D/g, ""), 10) || 0, lt: num("clt"), ltvCac: num("cratio") || 3, rateLeadMql: num("crlead"), rateMqlSql: num("crmql") || 15, rateSqlVenda: num("crsql") || 10 });
  box.innerHTML = `<div class="card" style="margin:8px 0;padding:14px 16px">
    <p class="sub" style="margin-bottom:10px">CPL ideal = LTV (LT × ticket) ÷ (LTV/CAC) × taxas. O <b>LTV/CAC</b> é o ajustável (padrão 3; aumente se a relação for melhor que o mercado).</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <div class="formrow" style="flex:1;min-width:130px"><label>Ticket médio (R$)</label>${f("cti", C.ticketMedio, "15000")}</div>
      <div class="formrow" style="min-width:110px"><label>LT (compras/meses)</label>${f("clt", C.lt, "12")}</div>
      <div class="formrow" style="min-width:90px"><label>LTV/CAC</label>${f("cratio", C.ltvCac != null ? C.ltvCac : 3, "3")}</div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <div class="formrow" style="min-width:120px"><label>Lead→MQL (%)</label>${f("crlead", C.rateLeadMql, "50")}</div>
      <div class="formrow" style="min-width:120px"><label>MQL→SQL (%)</label>${f("crmql", C.rateMqlSql != null ? C.rateMqlSql : 15, "15")}</div>
      <div class="formrow" style="min-width:120px"><label>SQL→venda (%)</label>${f("crsql", C.rateSqlVenda != null ? C.rateSqlVenda : 10, "10")}</div>
    </div>
    <div style="display:flex;gap:10px;margin-top:6px;align-items:center">
      <button class="btn btn-primary" id="csave-${i}" style="padding:8px 14px">Salvar</button>
      <span id="cmsg-${i}" style="font-size:13px;color:var(--accent);font-weight:700"></span>
    </div></div>`;
  const show = () => { const v = collect(); const id = v.ticketMedio && v.lt && v.ltvCac ? v.lt * v.ticketMedio / v.ltvCac * (v.rateSqlVenda / 100) * (v.rateMqlSql / 100) * (v.rateLeadMql / 100) : null; $("#cmsg-" + i).textContent = id ? `→ CPL ideal = R$ ${id.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ""; };
  box.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", show)); show();
  $("#csave-" + i).addEventListener("click", async () => { c.cplIdeal = collect(); await window.api.setClients(state.clients); box.innerHTML = ""; renderMyClients(); toast(`CPL ideal de ${c.name} salvo.`); });
}

function startLeadsEdit(i) {
  const c = state.clients[i];
  const box = $("#leadsbox-" + i);
  if (box.innerHTML) { box.innerHTML = ""; return; } // toggle
  const L = c.leads || {};
  const marca = L.mqlMarca || L.mql || L.rule || { type: "greenRow" };
  const cargo = L.mqlCargo || { type: "colValue", column: "Cargo" };
  const custom = L.mqlCustom || { type: "none" };
  const sql = L.sql || { type: "colValue" };
  const field = (id, val, ph) => `<input id="${id}-${i}" value="${val != null ? String(val).replace(/"/g, "&quot;") : ""}" placeholder="${ph || ""}" style="width:100%;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:7px 9px;color:var(--txt);outline:none">`;
  const opt = (v, sel, txt) => `<option value="${v}" ${sel === v ? "selected" : ""}>${txt}</option>`;
  const block = (pfx, title, rule, types, colPh, valPh) => `
    <div style="border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-top:8px">
      <div style="font-weight:700;font-size:12.5px;margin-bottom:8px">${title}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div class="formrow" style="min-width:165px"><label>Como identifica</label>
          <select id="${pfx}type-${i}" style="background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:7px 9px;color:var(--txt)">${types.map((t) => opt(t[0], rule.type, t[1])).join("")}</select></div>
        <div class="formrow" style="flex:2;min-width:165px"><label>Coluna</label>${field(pfx + "col", rule.column, colPh)}</div>
        <div class="formrow" style="flex:1;min-width:140px"><label>${rule.type === "invMin" ? "Mínimo (R$)" : "Valores (vírgula)"}</label>${field(pfx + "val", rule.type === "invMin" ? rule.min : (rule.values || []).join(", "), valPh)}</div>
      </div>
    </div>`;
  box.innerHTML = `<div class="card" style="margin:8px 0;padding:14px 16px">
    <p class="sub" style="margin-bottom:10px">Lê todas as abas e filtra pelo período. Verde = MQL (usa a Google Sheets API Key). Se o lead não estiver marcado, conta pelo critério de cargo.</p>
    <div class="formrow"><label>Link da planilha</label>${field("lsheet", L.sheetUrl, "https://docs.google.com/spreadsheets/...")}</div>
    <div class="formrow" style="max-width:240px"><label>Coluna da data</label>${field("ldate", L.dateColumn || "Data", "Data de captação")}</div>
    ${block("lm", "🎯 MQL — como o cliente marca", marca, [["greenRow", "Linha verde"], ["greenCol", "Coluna verde"], ["colValue", "Coluna = valor (ex.: Dentro)"], ["invMin", "Investimento mínimo"], ["none", "— não usar —"]], "(coluna, se precisar)", "Dentro")}
    ${block("lc", "📋 MQL por cargo — quando NÃO está marcado", cargo, [["colValue", "Cargos que contam"], ["none", "— não usar —"]], "Cargo", "Diretor, Sócio, CEO, Gerente, Empresário...")}
    ${block("lx", "✨ MQL personalizado — outra condição que conta (opcional)", custom, [["colValue", "Coluna = valor"], ["greenCol", "Coluna verde"], ["greenRow", "Linha verde"], ["invMin", "Investimento mínimo"], ["none", "— não usar —"]], "Tamanho da empresa", "Mais de 50, Enterprise...")}
    ${block("ls", "🤝 SQL — virou reunião", sql, [["colValue", "Coluna = valor (ex.: Sim/TRUE)"], ["greenCol", "Coluna verde"], ["greenRow", "Linha verde"], ["none", "— não usar —"]], "Marcou Reunião", "Sim, TRUE")}
    <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
      <button class="btn btn-primary" id="lsave-${i}" style="padding:8px 14px">Salvar</button>
      <button class="chip-btn" id="ltest-${i}">testar leitura</button>
      <span id="lmsg-${i}" style="font-size:12px;color:var(--muted)"></span>
    </div></div>`;
  const collectRule = (pfx) => {
    const type = $("#" + pfx + "type-" + i).value;
    if (type === "none") return null;
    if (type === "greenRow") return { type };
    const col = $("#" + pfx + "col-" + i).value.trim(); if (!col) return null;
    if (type === "greenCol") return { type, column: col };
    const raw = $("#" + pfx + "val-" + i).value.trim();
    return type === "invMin"
      ? { type, column: col, min: parseFloat(raw.replace(/\D/g, "")) || 0 }
      : { type, column: col, values: raw.split(",").map((v) => v.trim()).filter(Boolean) };
  };
  const collect = () => {
    const m = collectRule("lm"), cg = collectRule("lc"), cx = collectRule("lx"), s = collectRule("ls");
    const lbl = m ? (m.type === "greenRow" ? "linha verde" : m.type === "greenCol" ? `verde em "${m.column}"` : m.type === "invMin" ? `invest. ≥ R$ ${Number(m.min).toLocaleString("pt-BR")}` : `"${m.column}"`) : (cg ? "por cargo" : (cx ? "personalizado" : ""));
    return { sheetUrl: $("#lsheet-" + i).value.trim(), dateColumn: $("#ldate-" + i).value.trim() || "Data", mqlMarca: m, mqlCargo: cg, mqlCustom: cx, sql: s, ruleLabel: lbl };
  };
  $("#lsave-" + i).addEventListener("click", async () => {
    c.leads = collect(); await window.api.setClients(state.clients);
    box.innerHTML = ""; renderMyClients(); toast(`Leads de ${c.name} configurado.`);
  });
  $("#ltest-" + i).addEventListener("click", async () => {
    const msg = $("#lmsg-" + i); msg.textContent = "lendo todas as abas…";
    try {
      const s = await window.api.leadsTest(collect());
      msg.textContent = `✅ ${s.total} leads (${s.tabs} abas) · ${s.mqls} MQL${s.hasSql ? ` · ${s.sqls} SQL` : ""}`;
    } catch (e) { msg.textContent = "❌ " + e.message; }
  });
}

function startBenchEdit(i) {
  const c = state.clients[i];
  const box = $("#benchbox-" + i);
  if (box.innerHTML) { box.innerHTML = ""; return; } // toggle
  let html = '<div class="card" style="margin:8px 0;padding:14px 16px">'
    + '<p class="sub" style="margin-bottom:10px">Benchmark deste cliente (em %). Deixe no padrão ou ajuste conforme o segmento — o padrão geral é o placeholder.</p>';
  ["linkedin", "google", "meta"].forEach((pk) => {
    const plat = E.PLATFORMS[pk];
    html += `<div style="margin-bottom:12px"><b>${plat.label}</b><div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:6px">`;
    plat.funnel.forEach((f) => {
      const ov = c.benchmarks && c.benchmarks[pk] && c.benchmarks[pk][f.name];
      html += `<label style="font-size:11.5px;color:var(--muted);display:flex;flex-direction:column;gap:3px">${f.name}
        <input type="number" step="0.1" data-pk="${pk}" data-mn="${f.name}" value="${ov != null ? ov : ""}" placeholder="${f.bench}" style="width:120px;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:6px 8px;color:var(--txt);outline:none"></label>`;
    });
    html += `</div></div>`;
  });
  html += `<div style="display:flex;gap:8px;margin-top:6px"><button class="btn btn-primary" id="saveBench-${i}" style="padding:8px 14px">Salvar</button><button class="chip-btn" id="resetBench-${i}">restaurar padrão geral</button></div></div>`;
  box.innerHTML = html;
  $("#saveBench-" + i).addEventListener("click", async () => {
    const bm = {};
    box.querySelectorAll("input[data-pk]").forEach((inp) => {
      const v = parseFloat(inp.value);
      if (Number.isFinite(v)) { (bm[inp.dataset.pk] = bm[inp.dataset.pk] || {})[inp.dataset.mn] = v; }
    });
    c.benchmarks = bm;
    await window.api.setClients(state.clients);
    box.innerHTML = ""; toast(`Benchmarks de ${c.name} salvos.`);
  });
  $("#resetBench-" + i).addEventListener("click", async () => {
    delete c.benchmarks; await window.api.setClients(state.clients);
    box.innerHTML = ""; toast(`${c.name} voltou ao benchmark padrão.`);
  });
}

async function startLinkBoard(i) {
  const c = state.clients[i];
  const search = $("#linkbox-" + i);
  if (search.innerHTML) { search.innerHTML = ""; return; } // toggle
  search.innerHTML = `<input type="text" id="lbq-${i}" placeholder="Buscar board no Trello (Enter)" style="width:100%;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:8px 10px;color:var(--txt);margin:6px 0"><div class="search-results" id="lbr-${i}"></div>`;
  const inp = $("#lbq-" + i); inp.value = c.name; inp.focus();
  const run = async () => {
    const res = $("#lbr-" + i); res.innerHTML = '<div class="state">buscando…</div>';
    try {
      const boards = await window.api.trelloBoards(inp.value.trim());
      res.innerHTML = boards.length ? "" : '<div class="state">Nenhum board. Confira as chaves do Trello em cima.</div>';
      boards.slice(0, 20).forEach((b) => {
        const it = document.createElement("div"); it.className = "clientrow";
        it.innerHTML = `<div class="cname" style="font-weight:500">${b.name}</div>`;
        const pick = document.createElement("button"); pick.className = "chip-btn"; pick.textContent = "vincular";
        pick.addEventListener("click", async () => { c.trelloBoardId = b.id; c.trelloBoardName = b.name; await window.api.setClients(state.clients); renderMyClients(); toast(`${c.name} → board "${b.name}" vinculado.`); });
        it.appendChild(pick); res.appendChild(it);
      });
    } catch (e) { res.innerHTML = `<div class="state error">Erro: ${e.message}</div>`; }
  };
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  run();
}

function fillClientSelectors() {
  ["#clientSel", "#histClientSel", "#repClientSel", "#subClientSel", "#termClientSel", "#perfClientSel", "#kwClientSel"].forEach((sel) => {
    const el = $(sel); const prev = el.value;
    el.innerHTML = state.clients.map((c) => `<option value="${c.projectId}">${c.name}</option>`).join("");
    if (prev) el.value = prev;
  });
}

// helpers para encontrar cliente pelo ID de conta
function clientByMeta(accountId) {
  const norm = (a) => String(a || "").replace("act_", "");
  const n = norm(accountId);
  return state.clients.find((c) => c.adAccounts && norm(c.adAccounts.meta) === n);
}
function clientByGoogle(customerId) {
  const norm = (a) => String(a || "").replace(/-/g, "");
  return state.clients.find((c) => c.adAccounts && norm(c.adAccounts.google) === norm(customerId));
}

// ao trocar de cliente no painel principal, limpa estado e reseta botão de envio
$("#clientSel").addEventListener("change", () => {
  state.results = null;
  state.analysisText = "";
  state.leads = null;
  state.ga4 = null;
  state.pagespeed = null;
  $("#painelBody").innerHTML = '<div class="state"><div class="big">📊</div>Selecione a semana e clique em Analisar.</div>';
  const btn = $("#enviarBtn");
  btn.disabled = false;
  btn.textContent = "📤 Enviar pro Trello";
  btn.classList.add("hidden");
});

/* ============================================================
   SEMANA
   ============================================================ */
$("#weekPrev").addEventListener("click", () => shiftWeek(-7));
$("#weekNext").addEventListener("click", () => shiftWeek(7));
function shiftWeek(days) {
  const m = new Date(state.week.monday); m.setDate(m.getDate() + days);
  state.week = weekFrom(mondayOf(m));
  $("#weekLabel").value = state.week.label;
}
// período custom: dias específicos (a semana continua o padrão)
$("#customToggle").addEventListener("click", () => {
  const cr = $("#customRange"); cr.classList.toggle("hidden");
  if (!cr.classList.contains("hidden") && !$("#perStart").value) { $("#perStart").value = state.week.start; $("#perEnd").value = state.week.end; }
});
$("#perApply").addEventListener("click", () => {
  const s = $("#perStart").value, e = $("#perEnd").value;
  if (!s || !e) { toast("Escolha as duas datas.", true); return; }
  if (s > e) { toast("A data inicial é depois da final.", true); return; }
  const fmtD = (d) => { const [y, mo, da] = d.split("-"); return `${da}/${mo}`; };
  state.week = { start: s, end: e, monday: new Date(s + "T00:00:00"), label: `${fmtD(s)} a ${fmtD(e)}/${e.split("-")[0]}`, custom: true };
  $("#weekLabel").value = state.week.label;
  toast("Período aplicado. Clique em Analisar.");
});

/* ============================================================
   ANALISAR
   ============================================================ */
$("#analisarBtn").addEventListener("click", () => analisar());
// opts.onlyPlatform ("meta"/"google"/"linkedin") → analisa só aquela plataforma (usado pelas abas de sessão)
async function analisar(opts = {}) {
  PANEL_MOUNT = null; // a aba "Painel da semana" sempre renderiza no #painelBody
  const localPid = Number($("#clientSel").value) || null;
  const cli = currentClient();
  if (!localPid && !cli) { toast("Selecione um cliente primeiro.", true); return; }
  const reporteiId = reporteiIdOf(cli); // null se o cliente veio só do Trello
  const ads = (cli && cli.adAccounts) || {};
  const hasDirectApi = (ads.meta && state.settings.metaToken) || (ads.google && state.settings.googleAdsRefreshToken);
  if (!reporteiId && !hasDirectApi) { toast(cli && cli.noReportei ? "Cliente sem Reportei — vincule a conta Meta/Google em \"contas\" (Configurações) para puxar os dados." : "Configure o token do Reportei ou conecte Meta/Google Ads com conta vinculada ao cliente.", true); return; }
  const body = $("#painelBody");
  const onlyLabel = opts.onlyPlatform ? ` (${(E.PLATFORMS[opts.onlyPlatform] || {}).label || opts.onlyPlatform})` : "";
  body.innerHTML = `<div class="state"><div class="big">⏳</div>Puxando dados${reporteiId ? " do Reportei" : " da API"}${onlyLabel}…</div>`;
  $("#enviarBtn").classList.add("hidden");
  try {
    const resp = await window.api.reporteiWeekData({
      projectId: reporteiId, start: state.week.start, end: state.week.end, includeAds: true,
      directMeta: ads.meta || null, directGoogle: ads.google || null, directGa4: ads.ga4PropertyId || null,
    });
    state.results = resp.platforms || [];
    // escopo de plataforma única (vindo das abas de sessão Meta/Google)
    if (opts.onlyPlatform) state.results = state.results.filter((p) => p.platform === opts.onlyPlatform);
    state.notes = resp.notes || [];
    state.ga4 = resp.ga4 || null;
    state.pagespeed = null;
    state.analysisText = "";
    state.leads = null;
    try { const c = currentClient(); if (c && c.leads && c.leads.sheetUrl) state.leads = await window.api.leadsSummary({ projectId: localPid, start: state.week.start, end: state.week.end }); } catch {}
    renderPainel();
    $("#enviarBtn").classList.remove("hidden");
    $("#enviarEkyteBtn").classList.toggle("hidden", !(state.settings.ekyteTaskTypeId && (state.settings.ekyteMcpUrl || state.settings.ekyteWebhookUrl || (state.settings.ekyteKey && state.settings.ekyteCompanyId))));
    // PageSpeed (lento ~15s) roda em segundo plano e re-renderiza quando volta
    const cli = currentClient();
    if (cli && cli.adAccounts && cli.adAccounts.site && state.settings.pageSpeedKey) {
      window.api.pageSpeedCheck({ url: cli.adAccounts.site, strategy: "MOBILE" })
        .then((ps) => { state.pagespeed = ps; state.results.forEach((pr) => { pr._leadGargalos = null; }); renderPainel(); })
        .catch(() => {});
    }
  } catch (err) {
    body.innerHTML = `<div class="state error"><div class="big">⚠️</div>Erro ao puxar do Reportei:<br>${err.message}</div>`;
  }
}

function currentClient() { return state.clients.find((c) => c.projectId === Number($("#clientSel").value)); }
function clientName() { const c = currentClient(); return c ? c.name : ""; }
function benchOf(platform) { const c = currentClient(); return (c && c.benchmarks && c.benchmarks[platform]) || {}; }

/* ---------------- render do painel ---------------- */
function renderPainel() {
  const results = state.results || [];
  const body = PANEL_MOUNT || $("#painelBody");
  const inline = !!PANEL_MOUNT; // análise embutida numa aba de sessão
  const notes = state.notes || [];
  const notesHtml = notes.map((n) => `<div class="warnbar">⚠️ ${n}</div>`).join("");
  if (!results.length) { body.innerHTML = notesHtml + '<div class="state">Nenhuma plataforma com dados nesta semana para este cliente.</div>'; return; }

  // diagnóstico nos níveis acionáveis: público E anúncio quando existirem (criativo tem gargalo próprio,
  // ex. CTR baixo = fadiga); só campanha quando não há público nem anúncio. Só vira card quem tem gargalo.
  results.forEach((pr) => {
    const hasAud = pr.rows.some((r) => r.level === "audience");
    const hasAd = pr.rows.some((r) => r.level === "ad");
    pr.rows.forEach((row) => {
      row._diag = (hasAud || hasAd) ? (row.level === "audience" || row.level === "ad") : row.level === "campaign";
      if (!row._diag) return;
      const { rates } = E.PLATFORMS[pr.platform].derive(row.metrics, benchOf(pr.platform));
      const garg = E.findGargalo(pr.platform, rates, benchOf(pr.platform));
      row._garg = garg;
      if (!row.otimItems) row.otimItems = garg ? [E.playbookFor(pr.platform, garg).otim] : [];
      if (row._hip == null) row._hip = garg ? E.playbookFor(pr.platform, garg).hip : "";
    });
  });

  // gargalos de qualificação (MQL/SQL) e de CPL ideal, por plataforma — entram nos mesmos cards de diagnóstico
  const cli = currentClient() || {};
  const mb = (cli.leads && cli.leads.mqlBench) || 30, sb = (cli.leads && cli.leads.sqlBench) || 10;
  const ideal = idealCplOf(cli.cplIdeal);
  results.forEach((pr) => {
    if (!pr._leadGargalos) pr._leadGargalos = [];
    else return; // já calculado (preserva edições/descartes ao re-renderizar)
    const mk = (garg, hip, otim) => ({ name: garg, _garg: garg, _hip: hip, otimItems: [otim], _diag: true, _dismissed: false });
    const lp = state.leads && state.leads.byPlatform && state.leads.byPlatform[pr.platform];
    if (lp && lp.total) {
      if (lp.mqlRate < mb) pr._leadGargalos.push(mk(`Taxa de MQL · ${lp.mqlRate.toFixed(0)}% (< ${mb}%)`, "Leads fora do perfil ideal", "Revisar segmentação e criativo para atrair o público certo"));
      if (state.leads.hasSql && lp.sqlRate < sb) pr._leadGargalos.push(mk(`Taxa de SQL · ${lp.sqlRate.toFixed(0)}% (< ${sb}%)`, "MQLs não estão virando reunião", "Revisar abordagem comercial e velocidade do primeiro contato"));
    }
    if (ideal) {
      const real = platformRealCpl(pr);
      if (real != null && real > ideal) pr._leadGargalos.push(mk(`CPL acima do ideal · R$ ${real.toFixed(2)} (ideal R$ ${ideal.toFixed(2)})`, "Custo por lead acima do que o LTV do cliente comporta", "Reduzir CPC / melhorar conversão / refinar público"));
    }
    // Taxa de Conexão (GA4 sessões ÷ cliques) — ideal ≥80%; abaixo = perda entre clique e visita
    const connBench = (cli.benchmarks && cli.benchmarks.connectRate) || 80;
    const sess = state.ga4 && (pr.platform === "google" ? state.ga4.google : pr.platform === "meta" ? state.ga4.meta : 0);
    const clicks = (pr.totals && pr.totals.clicks) || 0;
    if (sess && clicks) {
      const conn = (sess / clicks) * 100;
      if (conn < connBench) {
        const ps = state.pagespeed;
        const hip = ps && ps.score != null && ps.score < 50
          ? `Site lento (PageSpeed ${ps.score}/100${ps.lcp ? ", LCP " + ps.lcp : ""}) — cliques se perdem antes de carregar`
          : "Parte dos cliques não vira sessão (site lento, erro de redirecionamento ou cliques acidentais)";
        pr._leadGargalos.push(mk(`Taxa de Conexão · ${conn.toFixed(0)}% (${sess} sessões / ${clicks} cliques · < ${connBench}%)`, hip, "Verificar velocidade e carregamento da página de destino (PageSpeed)"));
      }
    }
  });
  // PageSpeed como gargalo próprio quando o site está lento (mesmo sem GA4)
  if (state.pagespeed && state.pagespeed.score != null && state.pagespeed.score < 50 && results[0]) {
    if (!(results[0]._leadGargalos || []).some((g) => /PageSpeed|velocidade/i.test(g.name))) {
      (results[0]._leadGargalos = results[0]._leadGargalos || []).push({ name: `Velocidade do site · PageSpeed ${state.pagespeed.score}/100 (mobile)`, _garg: `Velocidade do site · ${state.pagespeed.score}/100${state.pagespeed.lcp ? " · LCP " + state.pagespeed.lcp : ""}`, _hip: "Site lento prejudica a conversão e o Índice de Qualidade", otimItems: ["Otimizar velocidade da página de destino (imagens, scripts, servidor)"], _diag: true, _dismissed: false });
    }
  }

  body.innerHTML = notesHtml + '<div id="leadsCard"></div><div id="cplCard"></div>' + kpisHtml(results) + results.map(platformHtml).join("") +
    analysisSectionHtml() +
    `<div class="section-title">📤 O que vai pro Trello</div><div class="trello-preview" id="trelloPreview"></div>` +
    // na análise embutida (aba Meta/Google) o envio é por este botão próprio (no Painel o botão fica no topo)
    (inline ? `<button class="btn btn-primary" id="inlineEnviarBtn" style="margin-top:16px">📤 Enviar pro Trello</button> <span id="inlineEnviarMsg" style="font-size:12px;color:var(--muted)"></span>` : "");

  attachEditHandlers();
  renderTrelloPreview();
  renderLeadsCard();
  renderCplCard();
  if (inline) { const eb = $("#inlineEnviarBtn", body); if (eb) eb.addEventListener("click", () => { reanchor(eb); enviar(eb); }); }
}

function kpisHtml(results) {
  const get = (p) => results.find((r) => r.platform === p);
  const meta = get("meta"), google = get("google"), li = get("linkedin");
  const invest = (meta?.totals.spend || 0) + (google?.totals.cost || 0);
  const leads = (meta?.totals.leads || 0) + (google?.totals.conversions || 0) + (li?.totals.leads || 0);
  let gargalos = 0, items = 0;
  results.forEach((pr) => {
    pr.rows.forEach((row) => { if (row._diag && row._garg && !row._dismissed) { gargalos++; items += (row.otimItems || []).length; } });
    (pr._leadGargalos || []).forEach((g) => { if (!g._dismissed && g._garg) { gargalos++; items += (g.otimItems || []).length; } });
  });
  const k = [
    { l: "Investimento na semana", v: E.fmt.brl(invest), s: "Meta + Google" },
    { l: "Leads gerados", v: E.fmt.n(leads), s: "todas as plataformas" },
    { l: "Gargalos abertos", v: gargalos, s: "campanhas abaixo do benchmark", alert: gargalos > 0 },
    { l: "Itens de otimização", v: items, s: "pro checklist do Trello" },
  ];
  return `<div class="kpis">${k.map((x) => `<div class="kpi ${x.alert ? "alert" : ""}"><div class="k-label">${x.l}</div><div class="k-val">${x.v}</div><div class="k-sub">${x.s}</div></div>`).join("")}</div>`;
}

async function renderLeadsCard() {
  const el = $("#leadsCard", panelRoot()); if (!el) return;
  const c = currentClient();
  if (!c || !c.leads || !c.leads.sheetUrl) { el.innerHTML = ""; return; }
  try {
    const s = state.leads;
    if (!s) { el.innerHTML = ""; return; }
    const BENCH = (c.leads && c.leads.mqlBench) || 30; // taxa de MQL esperada (%)
    const cols = s.hasSql ? 4 : 3;
    el.innerHTML = `<div class="section-title" style="margin-top:0">🎯 Qualificação de Leads · semana ${state.week.label}</div>
      <div class="kpis" style="grid-template-columns:repeat(${cols},1fr)">
        <div class="kpi"><div class="k-label">Leads na semana</div><div class="k-val">${s.total}</div><div class="k-sub">${s.tabs} aba(s) da planilha</div></div>
        <div class="kpi"><div class="k-label">MQL · ${s.mqlRate.toFixed(0)}%</div><div class="k-val" style="color:var(--accent)">${s.mqls}</div><div class="k-sub">${c.leads.ruleLabel || "dentro do perfil"}</div></div>
        ${s.hasSql ? `<div class="kpi"><div class="k-label">SQL · ${s.sqlRate.toFixed(0)}%</div><div class="k-val" style="color:var(--accent-2)">${s.sqls}</div><div class="k-sub">virou reunião</div></div>` : ""}
        <div class="kpi ${s.mqlRate < BENCH ? "alert" : ""}"><div class="k-label">Taxa de MQL</div><div class="k-val">${s.mqlRate.toFixed(1)}%</div><div class="k-sub">${s.mqlRate < BENCH ? "abaixo do esperado (" + BENCH + "%)" : "MQL ÷ leads"}</div></div>
      </div>
      <p style="font-size:11.5px;color:var(--muted);margin:8px 2px 0">MQL/SQL e gargalos por plataforma aparecem nas tabelas de cada plataforma abaixo.</p>`;
  } catch (e) { el.innerHTML = `<div class="warnbar">🎯 Leads: ${e.message}</div>`; }
}

function idealCplOf(c) { if (!c || !c.ticketMedio || !c.lt || !c.ltvCac) return null; return c.lt * c.ticketMedio / c.ltvCac * ((c.rateSqlVenda || 10) / 100) * ((c.rateMqlSql || 15) / 100) * ((c.rateLeadMql || 0) / 100); }
function actualCplOf(prs) { let inv = 0, lds = 0; (prs || []).forEach((pr) => { const t = pr.totals || {}; inv += (t.spend || 0) + (t.cost || 0); lds += (t.leads || 0) + (t.conversions || 0); }); return lds ? inv / lds : null; }
function platformRealCpl(pr) { const t = pr.totals || {}; const sp = (t.spend || 0) + (t.cost || 0); const ld = (t.leads || 0) + (t.conversions || 0); return ld ? sp / ld : null; }
function renderCplCard() {
  const el = $("#cplCard", panelRoot()); if (!el) return;
  const c = currentClient(); const ci = c && c.cplIdeal;
  const ideal = idealCplOf(ci);
  if (!ideal) { el.innerHTML = ""; return; }
  const real = actualCplOf(state.results);
  const brl = (v) => v == null ? "—" : "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ok = real != null && real <= ideal;
  el.innerHTML = `<div class="section-title" style="margin-top:0">💰 Custo por Lead · ideal x real</div>
    <div class="kpis" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="k-label">CPL ideal</div><div class="k-val">${brl(ideal)}</div><div class="k-sub">LTV/CAC ${ci.ltvCac} · ticket R$ ${Number(ci.ticketMedio).toLocaleString("pt-BR")}</div></div>
      <div class="kpi ${real != null && !ok ? "alert" : ""}"><div class="k-label">CPL real (semana)</div><div class="k-val" style="color:${real == null ? "var(--txt)" : (ok ? "var(--accent)" : "var(--bad)")}">${brl(real)}</div><div class="k-sub">investido ÷ leads</div></div>
      <div class="kpi"><div class="k-label">Situação</div><div class="k-val" style="font-size:19px;color:${real == null ? "var(--muted)" : (ok ? "var(--accent)" : "var(--bad)")}">${real == null ? "—" : (ok ? "🟢 barato" : "🔴 caro")}</div><div class="k-sub">${real == null ? "sem dados de leads/custo" : (ok ? "abaixo do ideal (bom)" : "acima do ideal")}</div></div>
    </div>`;
}

function cellHtml(c) {
  if (c.bench !== undefined) {
    if (c.rate == null) return `<td><span style="color:var(--muted)">—</span></td>`;
    const ok = c.rate >= c.bench;
    return `<td><span class="rate ${ok ? "ok" : "bad"}"><span class="dot"></span>${E.fmt.pct(c.rate)}</span></td>`;
  }
  return `<td>${c.v}</td>`;
}

function platformHtml(pr, pi) {
  const plat = E.PLATFORMS[pr.platform];
  // tabela: campanha + público (só métricas)
  const lp = state.leads && state.leads.byPlatform && state.leads.byPlatform[pr.platform];
  const mqlIdx = plat.cols.indexOf("MQL"), sqlIdx = plat.cols.indexOf("SQL");
  let firstDone = false;
  const rowsHtml = pr.rows.map((row) => {
    const { cells } = plat.derive(row.metrics, benchOf(pr.platform));
    if (!firstDone && lp) { // MQL/SQL da planilha entram na linha-topo da plataforma (sempre com número + taxa, mesmo 0)
      if (mqlIdx >= 0) cells[mqlIdx] = { v: `${lp.mqls} (${lp.mqlRate.toFixed(0)}%)` };
      if (sqlIdx >= 0) cells[sqlIdx] = { v: state.leads && state.leads.hasSql ? `${lp.sqls} (${lp.sqlRate.toFixed(0)}%)` : "—" };
      firstDone = true;
    }
    return `<tr class="${row.level}"><td>${row.name}</td>${cells.map(cellHtml).join("")}</tr>`;
  }).join("");

  // cards de diagnóstico abaixo da tabela (nível folha), fora da área que rola
  let diagsHtml = "";
  let dismissed = 0;
  pr.rows.forEach((row, ri) => {
    if (!row._diag || !row._garg) return;
    if (row._dismissed) { dismissed++; return; }
    const otimLis = row.otimItems.map((t) => `<li><span class="t" contenteditable="true" data-pi="${pi}" data-ri="${ri}">${t}</span></li>`).join("");
    diagsHtml += `<div class="diag-card">
      <div class="diag-name"><span class="dn-text">🔴 ${row.name}</span>
        <button class="diag-dismiss" data-pi="${pi}" data-ri="${ri}" title="Descartar — não entra no checklist do Trello">✕ descartar</button></div>
      <div class="diag-wrap">
        <div class="diag-block gargalo"><div class="dl">Gargalo</div><div class="dv" contenteditable="true" data-pi="${pi}" data-ri="${ri}" data-f="garg">${row._garg}</div></div>
        <div class="diag-block hip"><div class="dl">💡 Hipótese<span class="edithint">editável</span></div><div class="dv" contenteditable="true" data-pi="${pi}" data-ri="${ri}" data-f="hip">${row._hip}</div></div>
        <div class="diag-block otim"><div class="dl">🛠️ Otimização → checklist<span class="edithint">editável</span></div>
          <ul class="otim-list" data-pi="${pi}" data-ri="${ri}">${otimLis}</ul>
          <button class="add-pt" data-pi="${pi}" data-ri="${ri}">+ adicionar ponto</button>
        </div></div></div>`;
  });
  // gargalos de qualificação/CPL (nível plataforma)
  (pr._leadGargalos || []).forEach((g, gi) => {
    if (g._dismissed) { dismissed++; return; }
    const otimLis = g.otimItems.map((t) => `<li><span class="t" contenteditable="true" data-pi="${pi}" data-gi="${gi}">${t}</span></li>`).join("");
    const gargBlock = g._manual
      ? `<div class="diag-block gargalo"><div class="dl">Gargalo<span class="edithint">editável</span></div><div class="dv" contenteditable="true" data-pi="${pi}" data-gi="${gi}" data-f="garg">${g._garg}</div></div>`
      : "";
    diagsHtml += `<div class="diag-card">
      <div class="diag-name"><span class="dn-text">${g._manual ? "✏️ Gargalo manual" : "🔴 " + g.name}</span>
        <button class="diag-dismiss" data-pi="${pi}" data-gi="${gi}" title="Descartar">✕ ${g._manual ? "remover" : "descartar"}</button></div>
      <div class="diag-wrap">
        ${gargBlock}
        <div class="diag-block hip"><div class="dl">💡 Hipótese<span class="edithint">editável</span></div><div class="dv" contenteditable="true" data-pi="${pi}" data-gi="${gi}" data-f="hip">${g._hip}</div></div>
        <div class="diag-block otim"><div class="dl">🛠️ Otimização → checklist<span class="edithint">editável</span></div>
          <ul class="otim-list" data-pi="${pi}" data-gi="${gi}">${otimLis}</ul>
          <button class="add-pt" data-pi="${pi}" data-gi="${gi}">+ adicionar ponto</button>
        </div></div></div>`;
  });
  const anyDiag = pr.rows.some((r) => r._diag) || (pr._leadGargalos || []).length > 0;
  if (!diagsHtml) diagsHtml = `<div class="ok-tag" style="padding:14px 4px">✅ Nenhum gargalo ativo${anyDiag ? (dismissed ? " (todos descartados)" : " — taxas acima do benchmark") : ""}.</div>`;
  if (dismissed) diagsHtml += `<div class="restore-note">${dismissed} gargalo(s) descartado(s) · <a href="#" class="restore-link" data-pi="${pi}">restaurar</a></div>`;
  diagsHtml += `<button class="add-garg" data-pi="${pi}">＋ adicionar gargalo manual</button>`;

  return `<div class="platform">
    <div class="p-head"><div class="p-badge ${plat.key}">${plat.short.slice(0, 2).toUpperCase()}</div>
      <h3>${plat.label}</h3><span class="p-meta">· ${plat.tag}</span><div class="p-spacer"></div>
      <div class="p-total">${pr.rows.length} ${pr.rows.length > 1 ? "linhas" : "linha"}</div></div>
    <div class="table-wrap"><table><thead><tr><th>Campanha / Público</th>${plat.cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
    <tbody>${rowsHtml}</tbody></table></div>
    <div class="diags">${diagsHtml}</div></div>`;
}

function analysisSectionHtml() {
  return `<div class="section-title">🤖 Análise da semana</div>
    <div class="card">
      <button class="btn btn-ghost" id="gerarAnaliseBtn">Gerar análise</button>
      <span id="aiEngineTag" class="ai-tag" style="display:none"></span>
      <div id="analiseBox" class="analysis-box md" style="margin-top:14px;display:none"></div>
    </div>`;
}

/* ---------------- edição inline ---------------- */
function diagTarget(ds) { // ds = dataset; resolve linha (ri) OU gargalo de leads (gi)
  const pr = state.results[+ds.pi];
  return ds.gi != null ? pr._leadGargalos[+ds.gi] : pr.rows[+ds.ri];
}
function attachEditHandlers() {
  const root = panelRoot();
  $$('.dv[contenteditable], .otim-list .t', root).forEach((el) => {
    el.addEventListener("input", () => {
      reanchor(el);
      const obj = diagTarget(el.dataset);
      if (el.dataset.f === "garg") { obj._garg = el.textContent.trim(); }
      else if (el.dataset.f === "hip") { obj._hip = el.textContent.trim(); }
      else { const ul = el.closest(".otim-list"); obj.otimItems = $$(".t", ul).map((x) => x.textContent.trim()).filter(Boolean); }
      renderTrelloPreview();
    });
  });
  $$(".add-pt", root).forEach((b) => b.addEventListener("click", () => {
    reanchor(b);
    diagTarget(b.dataset).otimItems.push("Novo ponto…");
    renderPainel();
  }));
  $$(".diag-dismiss", root).forEach((b) => b.addEventListener("click", () => {
    reanchor(b);
    diagTarget(b.dataset)._dismissed = true;
    renderPainel();
  }));
  $$(".restore-link", root).forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    reanchor(a);
    const pr = state.results[+a.dataset.pi];
    pr.rows.forEach((r) => { r._dismissed = false; });
    (pr._leadGargalos || []).forEach((g) => { g._dismissed = false; });
    renderPainel();
  }));
  $$(".add-garg", root).forEach((b) => b.addEventListener("click", () => {
    reanchor(b);
    const pr = state.results[+b.dataset.pi];
    (pr._leadGargalos = pr._leadGargalos || []).push({ name: "Manual", _garg: "Novo gargalo", _hip: "", otimItems: ["Otimização…"], _diag: true, _dismissed: false, _manual: true });
    renderPainel();
  }));
  const g = $("#gerarAnaliseBtn", root); if (g) g.addEventListener("click", () => { reanchor(g); gerarAnalise(); });
  const box = $("#analiseBox", root);
  if (box && state.analysisText) { box.style.display = "block"; box.innerHTML = mdToHtml(state.analysisText); }
}

async function gerarAnalise() {
  const root = panelRoot();
  const btn = $("#gerarAnaliseBtn", root); btn.textContent = "Gerando…"; btn.disabled = true;
  try {
    let leads = null;
    try { const c = currentClient(); if (c && c.leads && c.leads.sheetUrl) leads = await window.api.leadsSummary({ projectId: c.projectId, start: state.week.start, end: state.week.end }); } catch {}
    const text = await window.api.geminiAnalyze({ clientName: clientName(), week: state.week, platformResults: stripResults(), benchmarks: (currentClient() || {}).benchmarks || null, leads, cplIdeal: (currentClient() || {}).cplIdeal || null, gargalos: keptGargalos() });
    state.analysisText = text;
    const box = $("#analiseBox", root); box.style.display = "block"; box.innerHTML = mdToHtml(text);
    showEngineTag("#aiEngineTag", root);
    btn.textContent = "Gerar novamente"; btn.disabled = false;
    renderTrelloPreview();
    toast("Análise gerada. O texto cru (com a formatação) vai pro Trello quando você enviar.");
  } catch (err) { btn.textContent = "Gerar análise"; btn.disabled = false; toast("IA: " + err.message, true); }
}

// mostra qual motor respondeu (Claude do seu plano / Gemini)
async function showEngineTag(sel, root) {
  try { const info = await window.api.aiEngineInfo(); const el = $(sel, root || document); if (el && info && info.last && info.last !== "—") { el.textContent = "⚡ " + info.last; el.style.display = "inline-block"; } } catch {}
}

// gargalos que a analista MANTEVE (não descartados) + hipóteses/otimizações editadas + manuais
// — a análise da semana é gerada SÓ a partir disso (respeita o que ela editou no painel)
function keptGargalos() {
  return (state.results || []).map((pr) => {
    const plat = E.PLATFORMS[pr.platform];
    const gs = [];
    pr.rows.forEach((row) => {
      if (!row._diag || !row._garg || row._dismissed) return;
      gs.push({ nome: row.name, gargalo: row._garg, hipotese: row._hip || "", otimizacoes: (row.otimItems || []).filter(Boolean) });
    });
    (pr._leadGargalos || []).forEach((g) => {
      if (g._dismissed || !g._garg) return;
      gs.push({ nome: g._manual ? "" : (g.name || ""), gargalo: g._garg, hipotese: g._hip || "", otimizacoes: (g.otimItems || []).filter(Boolean) });
    });
    return { platform: pr.platform, label: plat.label, gargalos: gs };
  });
}

// remove campos internos (_garg etc) antes de mandar ao main
function stripResults() {
  return state.results.map((pr) => ({ platform: pr.platform, totals: pr.totals, rows: pr.rows.map((r) => ({ level: r.level, name: r.name, metrics: r.metrics, otimOverride: (r.otimItems && r.otimItems[0]) || null })) }));
}

/* ---------------- preview Trello ---------------- */
function currentItems() {
  const items = [];
  (state.results || []).forEach((pr) => {
    const plat = E.PLATFORMS[pr.platform];
    pr.rows.forEach((row) => {
      if (!row._diag || !row._garg || row._dismissed) return;
      (row.otimItems || []).forEach((otim) => {
        if (!otim) return;
        items.push({ platform: pr.platform, short: plat.short, text: `[${plat.short}] ${row.name}: ${otim} (gargalo: ${row._garg})` });
      });
    });
    (pr._leadGargalos || []).forEach((g) => {
      if (g._dismissed || !g._garg) return;
      const gargNome = g._garg.split(" · ")[0]; // ex.: "Taxa de SQL"
      (g.otimItems || []).forEach((otim) => { if (otim) items.push({ platform: pr.platform, short: plat.short, text: `[${plat.short}] ${otim} (gargalo: ${gargNome})` }); });
    });
  });
  return items;
}

function renderTrelloPreview() {
  const box = $("#trelloPreview", panelRoot()); if (!box) return;
  const items = currentItems();
  const checklist = items.map((it) => `<div class="tp-item"><div><span class="tp-tag ${it.platform}">${it.short}</span>${it.text.replace(/^\[[^\]]+\]\s*/, "")}</div></div>`).join("") || '<div class="tp-item">Sem gargalos nesta semana 🎉</div>';
  box.innerHTML = `
    <div class="tp-col">
      <div class="tp-list"><span class="pill" style="background:#4267e8"></span>Demandas da Semana</div>
      <div class="tp-cardname">Otimizações da semana de ${state.week.label}</div>
      <div class="tp-desc">Próximos passos a executar nesta semana, com base na análise de ${state.week.label}.</div>
      <div class="tp-check">✅ Otimizações (0/${items.length})</div>${checklist}
    </div>
    <div class="tp-col">
      <div class="tp-list"><span class="pill" style="background:#9b6bff"></span>O que foi feito na semana</div>
      <div class="tp-cardname">Análise da semana de ${state.week.label}</div>
      <div class="tp-ai">🤖 ${state.analysisText ? "análise gerada — pronta para enviar" : "gere a análise no botão acima"}</div>
      <div class="tp-desc" style="white-space:pre-wrap;max-height:200px;overflow:auto">${state.analysisText ? state.analysisText.slice(0, 600) + (state.analysisText.length > 600 ? "…" : "") : "Panorama geral → Google → Meta → LinkedIn → Métricas → Otimizações"}</div>
    </div>`;
}

/* ---------------- enviar ---------------- */
$("#enviarBtn").addEventListener("click", () => enviar());
async function enviar(btnEl) {
  const c = state.clients.find((c) => c.projectId === Number($("#clientSel").value));
  if (!c) return;
  if (!c.trelloBoardId) { toast("Vincule o board do Trello deste cliente em Configurações.", true); return; }
  const items = currentItems();
  if (!items.length && !state.analysisText) { toast("Nada para enviar — sem gargalos e sem análise.", true); return; }
  const btn = btnEl || $("#enviarBtn"); btn.disabled = true; btn.textContent = "Enviando…";
  try {
    // termos negativados DENTRO do período (do log de ações) → vão pro card de "feitos"
    let negated = [];
    try {
      const acts = await window.api.listActions(c.projectId);
      negated = acts.filter((a) => a.type === "negativacao" && a.at >= state.week.start && a.at <= state.week.end + "T23:59:59")
        .flatMap((a) => String(a.detail || "").split(",").map((t) => t.trim()).filter(Boolean));
      negated = [...new Set(negated)];
    } catch {}
    const trello = await window.api.trelloSendWeek({ boardId: c.trelloBoardId, week: state.week, items, analysisText: state.analysisText, negated });
    await window.api.historySave({
      projectId: c.projectId, clientName: c.name, weekLabel: state.week.label,
      start: state.week.start, end: state.week.end,
      platformResults: stripResults(), items, analysisText: state.analysisText, trello,
    });
    toast("✅ Enviado pro Trello e salvo no histórico!");
    btn.textContent = "✓ Enviado";
    setTimeout(() => { btn.textContent = "📤 Enviar pro Trello"; btn.disabled = false; }, 3000);
    if (trello.optCardUrl) setTimeout(() => window.api.openExternal(trello.optCardUrl), 400);
  } catch (err) { btn.disabled = false; btn.textContent = "📤 Enviar pro Trello"; toast("Trello: " + err.message, true); }
}

/* ---------------- enviar pro Ekyte (tarefas: executor antes da call + P.O recebe) ---------------- */
const nextWeekdayDate = (weekday) => { const d = new Date(); d.setHours(0, 0, 0, 0); for (let i = 0; i <= 14; i++) { const x = new Date(d); x.setDate(d.getDate() + i); if (x.getDay() === weekday) return x; } return d; };
const prevBizDate = (date) => { const d = new Date(date); do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6); return d; };
// mostra um seletor de tipo de tarefa (padrão = o configurado) e devolve o id escolhido (ou null se cancelar)
async function pickEkyteType() {
  if (!state.ekyteTypes) { try { state.ekyteTypes = await window.api.ekyteTaskTypes(); } catch { state.ekyteTypes = []; } }
  const types = state.ekyteTypes || [];
  if (!types.length) return state.settings.ekyteTaskTypeId || null;
  const def = state.settings.ekyteTaskTypeId || "";
  return new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999";
    ov.innerHTML = `<div style="background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;width:440px;max-width:92%">
      <div style="font-weight:700;font-size:15px;margin-bottom:4px">📋 Enviar pro Ekyte</div>
      <div style="font-size:12.5px;color:var(--muted);margin-bottom:12px">Tipo de tarefa pra criar (padrão = otimização):</div>
      <select id="pickType" style="width:100%;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:9px 11px;color:var(--txt);outline:none">${types.map((t) => `<option value="${t.id}" ${String(t.id) === String(def) ? "selected" : ""}>${t.nome || t.id} · #${t.id}</option>`).join("")}</select>
      <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
        <button class="chip-btn" id="pickCancel">Cancelar</button>
        <button class="btn btn-primary" id="pickOk" style="padding:8px 16px">Criar tarefas</button>
      </div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => { if (e.target === ov) { ov.remove(); resolve(null); } });
    $("#pickCancel", ov).addEventListener("click", () => { ov.remove(); resolve(null); });
    $("#pickOk", ov).addEventListener("click", () => { const v = $("#pickType", ov).value; ov.remove(); resolve(v); });
  });
}
$("#enviarEkyteBtn").addEventListener("click", async () => {
  const c = currentClient();
  if (!c) { toast("Selecione um cliente.", true); return; }
  const items = currentItems();
  if (!items.length) { toast("Sem otimizações pra mandar ao Ekyte.", true); return; }
  const taskTypeId = await pickEkyteType();
  if (!taskTypeId) return; // cancelou
  const btn = $("#enviarEkyteBtn"); btn.disabled = true; btn.textContent = "Enviando…";
  // prazos a partir da call do cliente (da aba Minha Semana): executor = véspera útil · P.O = dia da call
  let dueExecutor, duePo;
  const wd = c.call && c.call.weekday;
  if (wd) { const cd = nextWeekdayDate(wd); duePo = iso(cd); dueExecutor = iso(prevBizDate(cd)); }
  try {
    const r = await window.api.ekyteCreateTasks({ clientName: c.name, workspaceId: c.ekyteWorkspaceId || null, items, weekLabel: state.week.label, dueExecutor, duePo, taskTypeId });
    const fails = (r.log || []).filter((l) => !l.ok).length;
    toast(fails ? `Ekyte: ${fails} tarefa(s) falharam — veja o detalhe.` : `✅ Tarefas criadas no Ekyte (workspace "${r.workspace}").`, !!fails);
    try { await window.api.logAction({ projectId: c.projectId, clientName: c.name, type: "ekyte", summary: `${(r.log || []).filter((l) => l.ok).length} tarefa(s) criada(s) no Ekyte · ${state.week.label}`, detail: (r.log || []).map((l) => l.txt).join(" | ") }); } catch {}
    if (fails) alert((r.log || []).map((l) => l.txt).join("\n"));
  } catch (e) { toast("Ekyte: " + e.message, true); }
  btn.disabled = false; btn.textContent = "📋 Enviar pro Ekyte";
});

/* ============================================================
   FUNIL STUDIO — IA pra montar estratégia por descrição
   (o iframe manda a descrição; o painel chama o Gemini e devolve
   o texto no formato estruturado que o Funil Studio sabe montar)
   ============================================================ */
window.addEventListener("message", async (e) => {
  const d = e.data;
  if (!d || d.type !== "funil-ai") return;
  const frame = $("#funilFrame");
  const reply = (payload) => frame && frame.contentWindow && frame.contentWindow.postMessage({ type: "funil-ai-result", id: d.id, ...payload }, "*");
  try {
    const prompt = d.isEmail
      ? [
        "Converta a descrição em um FLUXO DE E-MAIL no formato exato abaixo (uma etapa por linha, use | para o detalhe; em condições, indente Sim:/Não: com 2 espaços). Responda SÓ com o fluxo, sem explicações nem markdown.",
        "Formato:\nInício: <gatilho> | <detalhe>\nE-mail: <assunto> | <resumo>\nEspera: <tempo>\nCondição: <pergunta>\n  Sim: Tag <nome>\n  Não: E-mail <assunto> | <resumo>",
        `\nDescrição da analista:\n"""${d.text}"""`,
      ].join("\n")
      : [
        "Converta a descrição em um FUNIL DE MÍDIA PAGA no formato de texto exato abaixo. Responda SÓ com a estrutura, sem explicações nem markdown.",
        "Formato (por plataforma):\n<Nome da Plataforma>\nObjetivo: <objetivo> | <verba mensal em número, se citada>\nPúblicos: <público 1>, <público 2>\nCriativos: <criativo 1>, <criativo 2>",
        "Plataformas válidas: Meta Ads, Google Ads, LinkedIn Ads, TikTok Ads, YouTube Ads.",
        "Regras de coerência: Google Pesquisa → Públicos: Palavras-chave e Criativos: Copy; Meta → criativos Vídeo/Imagem/Carrossel; LinkedIn → públicos por Cargo/Setor.",
        "No fim, se a descrição citar o caminho do lead: Jornada: <Etapa A> > <Etapa B> > <Etapa C>",
        `\nDescrição da analista:\n"""${d.text}"""`,
      ].join("\n");
    const structured = await window.api.geminiRaw({ prompt });
    reply({ ok: true, structured });
  } catch (err) {
    reply({ ok: false, error: err.message || "Falha ao chamar a IA." });
  }
});

/* ============================================================
   SUBIDA — credenciais (testes) + contas por cliente + upload
   ============================================================ */
$("#metaTestBtn").addEventListener("click", async () => {
  const m = $("#metaTestMsg"); m.textContent = "testando…";
  try {
    await window.api.setSettings({ metaToken: $("#cfgMetaToken").value.trim() });
    state.settings = await window.api.getSettings();
    const accs = await window.api.metaTest();
    m.textContent = `✅ ${accs.length} conta(s) de anúncio acessíveis`;
    state.metaAccounts = accs;
  } catch (e) { m.textContent = "❌ " + e.message; }
});
$("#metaPermBtn").addEventListener("click", async () => {
  const box = $("#metaPermBox"); box.innerHTML = "verificando…";
  try {
    await window.api.setSettings({ metaToken: $("#cfgMetaToken").value.trim() });
    state.settings = await window.api.getSettings();
    const r = await window.api.metaPermissions();
    const rows = r.checks.map((c) =>
      `<div style="display:flex;gap:8px;align-items:center;font-size:12.5px;padding:2px 0">
        <span>${c.ok ? "✅" : (c.essencial ? "❌" : "⚪")}</span>
        <code style="color:${c.ok ? "#7be8c0" : "#e0857a"}">${c.perm}</code>
        <span style="color:var(--muted)">— ${c.label}</span>
      </div>`).join("");
    const pagesTxt = r.pages.length ? `${r.pages.length} Página(s): ${r.pages.slice(0, 3).join(", ")}${r.pages.length > 3 ? "…" : ""}` : "⚠️ nenhuma Página acessível (anúncio precisa de uma Página)";
    box.innerHTML = `<div class="card" style="padding:12px 14px;margin:0">
      ${rows}
      <div style="font-size:12px;color:var(--muted);margin-top:8px;border-top:1px solid var(--line);padding-top:8px">📄 ${pagesTxt}</div>
      <div style="font-size:12.5px;margin-top:8px">
        ${r.podeCampanha ? "✅ Pode criar <b>campanha + conjunto</b>" : "❌ Falta <code>ads_management</code> pra criar campanha"}<br>
        ${r.podeCriativo ? "✅ Pode subir <b>criativo + anúncio</b>" : "⏳ Pra <b>criativo/anúncio</b> faltam permissões de Página acima (e ter uma Página acessível)"}
      </div></div>`;
  } catch (e) { box.innerHTML = `<span style="color:var(--bad)">❌ ${e.message}</span>`; }
});
$("#gadsConnectBtn").addEventListener("click", async () => {
  const m = $("#gadsConnMsg");
  const clientId = $("#cfgGadsCid").value.trim(), clientSecret = $("#cfgGadsSec").value.trim();
  if (!clientId || !clientSecret) { m.textContent = "❌ cole o Client ID e o Secret primeiro"; return; }
  m.textContent = "abrindo o navegador… autorize com sua conta Google";
  try {
    await window.api.googleAdsConnect({ clientId, clientSecret });
    state.settings = await window.api.getSettings();
    m.textContent = "✅ conectado! agora cola o Developer Token + MCC e clica em testar conexão";
  } catch (e) { m.textContent = "❌ " + e.message; }
});
$("#gadsTestBtn").addEventListener("click", async () => {
  const m = $("#gadsTestMsg"); m.textContent = "testando…";
  try {
    const upd = {
      googleAdsDevToken: $("#cfgGadsDev").value.trim(), googleAdsClientId: $("#cfgGadsCid").value.trim(),
      googleAdsClientSecret: $("#cfgGadsSec").value.trim(),
      googleAdsLoginCustomerId: $("#cfgGadsMcc").value.trim().replace(/-/g, ""),
    };
    // o refresh token vem do "Conectar com Google" (salvo no app) — só sobrescreve se digitarem algo
    const ref = $("#cfgGadsRef").value.trim(); if (ref) upd.googleAdsRefreshToken = ref;
    await window.api.setSettings(upd);
    state.settings = await window.api.getSettings();
    const ids = await window.api.googleAdsTest();
    m.textContent = `✅ acesso ok · ${ids.length} customer(s): ${ids.slice(0, 4).join(", ")}${ids.length > 4 ? "…" : ""}`;
  } catch (e) { m.textContent = "❌ " + e.message; }
});

// recebe a pré-estrutura do Funil Studio (Exportar → Enviar pro Painel)
window.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || d.type !== "funil-upload" || !d.estrutura) return;
  state.upload = d.estrutura;
  $$(".nav .tab").forEach((x) => x.classList.toggle("active", x.dataset.view === "subida"));
  ALL_VIEWS.forEach((v) => $("#view-" + v).classList.toggle("hidden", v !== "subida"));
  renderSubida();
  toast("Pré-estrutura recebida do Funil Studio.");
});

$("#subLoadBtn").addEventListener("click", () => {
  try {
    state.upload = JSON.parse($("#subPaste").value);
    renderSubida();
  } catch { toast("JSON inválido.", true); }
});
$("#subOpenBtn").addEventListener("click", async () => {
  try {
    const est = await window.api.openJsonFile();
    if (!est) return;
    state.upload = est; renderSubida();
    toast("Estratégia carregada do arquivo.");
  } catch (e) { toast("Não consegui abrir: " + e.message, true); }
});
async function openInFunil() {
  const est = state.upload;
  if (!est) { toast("Carregue uma estratégia primeiro.", true); return; }
  toast("Preparando criativos…");
  const clone = JSON.parse(JSON.stringify(est));
  for (const p of clone.plataformas || []) for (const c of p.campanhas || []) for (const cj of c.conjuntos || []) for (const ad of cj.anuncios || []) {
    if (!ad.imageUrl && ad.imagePath) { try { const d = await window.api.readImage(ad.imagePath); if (d) ad.imageUrl = d; } catch {} }
  }
  $$(".nav .tab").forEach((x) => x.classList.toggle("active", x.dataset.view === "funil"));
  ALL_VIEWS.forEach((v) => $("#view-" + v).classList.toggle("hidden", v !== "funil"));
  const frame = $("#funilFrame");
  setTimeout(() => { try { frame.contentWindow.postMessage({ type: "funil-import", estrutura: clone }, "*"); } catch {} }, 500);
}
document.addEventListener("click", (e) => { if (e.target && e.target.id === "subToFunilBtn") openInFunil(); });
$("#subClientSel").addEventListener("change", () => { if (state.upload) renderSubida(); });

function renderSubida() {
  const est = state.upload; const body = $("#subBody");
  if (!est || !est.plataformas) return;
  const c = state.clients.find((x) => x.projectId === Number($("#subClientSel").value)) || {};
  const ads = c.adAccounts || {};
  body.innerHTML = `<div class="warnbar" style="background:rgba(25,227,162,.07);border-color:rgba(25,227,162,.3);color:#7be8c0;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span style="flex:1">📦 Pré-estrutura${est.cliente ? ` de <b>${est.cliente}</b>` : ""} carregada · tudo é criado <b>PAUSADO</b> (rascunho) — nada roda sem você ativar na plataforma.</span>
      <button class="btn btn-ghost" id="subToFunilBtn" style="padding:7px 12px">🧠 Revisar no Funil Studio</button></div>`
    + est.plataformas.map((p, i) => {
      const nC = (p.campanhas || []).length;
      const nS = (p.campanhas || []).reduce((a, x) => a + (x.conjuntos || []).length, 0);
      const nA = (p.campanhas || []).reduce((a, x) => a + (x.conjuntos || []).reduce((b, y) => b + (y.anuncios || []).length, 0), 0);
      const isMeta = p.api === "Meta Ads";
      const isGoogle = p.api === "Google Ads";
      const acct = isMeta ? ads.meta : isGoogle ? ads.google : null;
      const ready = isMeta && state.settings.metaToken && acct;
      const gReady = isGoogle && state.settings.googleAdsRefreshToken && acct;
      let btn;
      if (isMeta) btn = `<button class="btn btn-primary sub-meta" data-i="${i}" ${ready ? "" : "disabled"}>Criar rascunho no Meta</button>
        ${!state.settings.metaToken ? '<span class="hist-meta">configure o token do Meta</span>' : !acct ? '<span class="hist-meta">vincule a conta act_ do cliente (botão "contas" em Configurações)</span>' : ""}`;
      else if (isGoogle) btn = `<button class="btn btn-primary sub-google" data-i="${i}" ${gReady ? "" : "disabled"}>Criar rascunho no Google</button>
        ${!state.settings.googleAdsRefreshToken ? '<span class="hist-meta">conecte o Google em Configurações</span>' : !acct ? '<span class="hist-meta">vincule a conta Google do cliente (botão "contas")</span>' : ""}`;
      else btn = `<button class="btn btn-ghost" disabled>${p.plataforma}: subida ainda não suportada</button>`;
      // famílias: campanha → conjunto → anúncios (com miniatura do criativo)
      const fam = (p.campanhas || []).map((camp) => {
        const grupos = (camp.conjuntos || []).map((cj) => {
          const ads = (cj.anuncios || []).map((ad, ai) => {
            const hasImg = ad.imagePath || ad.imageUrl;
            return `<div class="sub-ad">${hasImg ? `<img class="sub-thumb" data-src="${(ad.imagePath || ad.imageUrl).replace(/"/g, "&quot;")}" alt="">` : `<div class="sub-thumb sub-thumb--none">${ad.videoUrl ? "🎬" : "—"}</div>`}<span>${ad.nome || "anúncio"}</span></div>`;
          }).join("");
          return `<div class="sub-grp"><div class="sub-grp-name">└ ${cj.nome || "conjunto"}${cj.publicoDef ? ` <span class="hist-meta">· ${cj.publicoDef.slice(0, 80)}${cj.publicoDef.length > 80 ? "…" : ""}</span>` : ""}</div><div class="sub-ads">${ads}</div></div>`;
        }).join("");
        return `<div class="sub-camp"><div class="sub-camp-name">📁 ${camp.nome || "campanha"}${camp.tipoCampanha ? ` <span class="hist-meta">· ${camp.tipoCampanha}</span>` : ""}${camp.monthly ? ` <span class="hist-meta">· R$ ${camp.monthly}/mês</span>` : ""}</div>${grupos}</div>`;
      }).join("");
      return `<div class="platform" style="margin-bottom:14px">
        <div class="p-head"><h3>${p.plataforma}</h3><div class="p-spacer"></div>
          <div class="p-total">${nC} campanha(s) · ${nS} conjunto(s) · ${nA} anúncio(s)</div></div>
        <div style="padding:8px 18px">${fam}</div>
        <div style="padding:8px 18px 14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">${btn}</div>
        <div class="sub-log" id="subLog-${i}" style="padding:0 18px 14px;font-size:12.5px;line-height:1.7"></div>
      </div>`;
    }).join("");
  // carrega as miniaturas dos criativos (lê do disco via main)
  $$(".sub-thumb[data-src]").forEach(async (img) => {
    try { const d = await window.api.readImage(img.dataset.src); if (d) img.src = d; } catch {}
  });
  $$(".sub-meta").forEach((b) => b.addEventListener("click", async () => {
    const i = +b.dataset.i; const logEl = $(`#subLog-${i}`);
    const p = est.plataformas[i];
    const nC = (p.campanhas || []).length;
    const nS = (p.campanhas || []).reduce((a, x) => a + (x.conjuntos || []).length, 0);
    // trava de segurança: confirma a CONTA de destino antes de criar qualquer coisa
    const ok = window.confirm(
      `Confirmar criação de RASCUNHOS no Meta?\n\n` +
      `Cliente: ${c.name || "(sem nome)"}\n` +
      `Conta de anúncio: ${ads.meta}\n` +
      `Vai criar: ${nC} campanha(s) + ${nS} conjunto(s)\n\n` +
      `Tudo nasce PAUSADO com [RASCUNHO] no nome — nada é ativado e nada gasta verba.`
    );
    if (!ok) return;
    b.disabled = true; b.textContent = "Criando rascunhos…";
    logEl.innerHTML = "⏳ enviando…";
    try {
      const res = await window.api.uploadMeta({ accountId: ads.meta, plataforma: est.plataformas[i], clientName: c.name, beneficiary: ads.metaBeneficiary, payor: ads.metaPayor, pageId: ads.metaPageId });
      const log = res.log || res;
      logEl.innerHTML = log.map((l) => `<div style="color:${!l.ok ? "var(--bad)" : l.soft ? "#e0b85a" : "#cdd6e3"}">${l.txt}</div>`).join("");
      // botão pra abrir a campanha criada no Gerenciador de Anúncios (finalizar conjunto/beneficiário lá)
      if (res.campaigns && res.campaigns.length) {
        const acct = (res.accountId || ads.meta || "").replace("act_", "");
        const url = `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${acct}`;
        const open = document.createElement("button");
        open.className = "chip-btn"; open.style.marginTop = "10px"; open.textContent = "↗ Abrir no Gerenciador de Anúncios";
        open.addEventListener("click", () => window.api.openExternal(url));
        logEl.appendChild(open);
      }
      const fails = log.filter((l) => !l.ok).length;
      const softs = log.filter((l) => l.soft).length;
      if (fails) { b.disabled = false; b.textContent = "Tentar de novo"; toast(`${fails} item(ns) falharam — veja o motivo no log.`, true); }
      else if (softs) { b.textContent = "✓ Campanha criada"; toast("Campanha criada! Finalize o conjunto no Gerenciador (verificação do Meta)."); }
      else { b.textContent = "✓ Enviado (pausado)"; toast("Rascunhos criados no Meta — confira no Gerenciador de Anúncios."); }
    } catch (e) { logEl.innerHTML = `<div style="color:var(--bad)">❌ ${e.message}</div>`; b.disabled = false; b.textContent = "Criar rascunho no Meta"; }
  }));
  $$(".sub-google").forEach((b) => b.addEventListener("click", async () => {
    const i = +b.dataset.i; const logEl = $(`#subLog-${i}`);
    const p = est.plataformas[i];
    const nC = (p.campanhas || []).length;
    if (!window.confirm(`Criar ${nC} campanha(s) de Pesquisa PAUSADAS na conta Google de "${c.name}" (${ads.google})?\n\nTudo nasce pausado com [RASCUNHO] no nome — nada roda nem gasta verba.`)) return;
    b.disabled = true; b.textContent = "Criando rascunhos…"; logEl.innerHTML = "⏳ enviando (orçamento → campanha → grupos → palavras-chave → anúncios)…";
    try {
      const res = await window.api.uploadGoogle({ customerId: ads.google, plataforma: p });
      const log = res.log || res;
      logEl.innerHTML = log.map((l) => `<div style="color:${!l.ok ? "var(--bad)" : l.soft ? "#e0b85a" : "#cdd6e3"}">${l.txt}</div>`).join("");
      const url = `https://ads.google.com/aw/campaigns?ocid=&__c=${(res.accountId || ads.google)}`;
      const open = document.createElement("button");
      open.className = "chip-btn"; open.style.marginTop = "10px"; open.textContent = "↗ Abrir no Google Ads";
      open.addEventListener("click", () => window.api.openExternal("https://ads.google.com/aw/campaigns"));
      logEl.appendChild(open);
      const fails = log.filter((l) => !l.ok).length;
      if (fails) { b.disabled = false; b.textContent = "Tentar de novo"; toast(`${fails} item(ns) falharam — veja o log.`, true); }
      else { b.textContent = "✓ Enviado (pausado)"; toast("Rascunhos criados no Google — confira no Google Ads."); }
    } catch (e) { logEl.innerHTML = `<div style="color:var(--bad)">❌ ${e.message}</div>`; b.disabled = false; b.textContent = "Criar rascunho no Google"; }
  }));
}


/* ============================================================
   PERFIL DO CLIENTE (o que ele faz) — com auto-preenchimento do Obsidian
   ============================================================ */
function perfClient() { return state.clients.find((c) => c.projectId === Number($("#perfClientSel").value)) || null; }
function loadPerfil() {
  const c = perfClient(); const p = (c && c.profile) || {};
  $("#perfServico").value = p.servico || "";
  $("#perfFaz").value = p.oQueFaz || "";
  $("#perfNaoFaz").value = p.oQueNaoFaz || "";
  $("#perfPersona").value = p.persona || "";
  $("#perfObs").value = p.obs || "";
  $("#perfServicoFoco").value = p.servicoFoco || "";
  $("#perfKickoff").value = p.kickoff || "";
  $("#perfPersonaDoc").value = p.personaDoc || "";
  $("#perfMsg").textContent = "";
  $("#perfPersonaMsg").textContent = p.personaDoc ? "✅ persona salva — em uso nas ferramentas" : "";
  resetAskChat();
}
$("#perfClientSel").addEventListener("change", loadPerfil);

/* ---------------- conversar sobre o cliente (Obsidian) ---------------- */
let askHistory = [];
function resetAskChat() {
  askHistory = [];
  const chat = $("#askChat"); if (chat) chat.innerHTML = "";
  const info = $("#askVaultInfo"); if (info) info.textContent = "";
  const c = perfClient();
  if (c && info) window.api.obsidianVaultFiles({ projectId: c.projectId, clientName: c.name })
    .then((r) => { info.textContent = r.vault ? `📂 Cofre: ${r.vault} · ${r.files.length} nota(s)` : "⚠️ Cofre não encontrado em ~/Claude/Clientes"; })
    .catch(() => {});
}
function pushAsk(role, html) {
  const chat = $("#askChat"); if (!chat) return null;
  const div = document.createElement("div");
  div.className = "ask-msg ask-" + role;
  div.innerHTML = role === "user" ? `<div class="ask-bubble">${html}</div>` : `<div class="ask-bubble md">${html}</div>`;
  chat.appendChild(div); chat.scrollTop = chat.scrollHeight;
  return div.querySelector(".ask-bubble");
}
async function askObsidian(question) {
  const c = perfClient(); if (!c) { toast("Selecione um cliente.", true); return; }
  if (!question.trim()) return;
  $("#askSuggest").classList.add("hidden");
  pushAsk("user", question.replace(/</g, "&lt;"));
  askHistory.push({ role: "user", text: question });
  const bubble = pushAsk("ai", '<span class="md-load">⏳ lendo as notas do cofre…</span>');
  try {
    const r = await window.api.obsidianAsk({ projectId: c.projectId, clientName: c.name, question, history: askHistory });
    bubble.innerHTML = mdToHtml(r.text);
    askHistory.push({ role: "ai", text: r.text });
  } catch (e) { bubble.innerHTML = `<span class="md-err">❌ ${e.message}</span>`; }
}
$("#askSend").addEventListener("click", () => { const i = $("#askInput"); askObsidian(i.value); i.value = ""; });
$("#askInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { askObsidian(e.target.value); e.target.value = ""; } });
$$(".ask-q").forEach((b) => b.addEventListener("click", () => askObsidian(b.textContent)));
$("#perfFillBtn").addEventListener("click", async () => {
  const c = perfClient(); if (!c) return;
  const msg = $("#perfMsg"); msg.textContent = "lendo o cofre do Obsidian…";
  try {
    const p = await window.api.obsidianClientProfile({ projectId: c.projectId, clientName: c.name });
    $("#perfServico").value = p.servico || "";
    $("#perfFaz").value = p.oQueFaz || "";
    $("#perfNaoFaz").value = p.oQueNaoFaz || "";
    $("#perfPersona").value = p.persona || "";
    $("#perfObs").value = p.obs || "";
    msg.textContent = `✅ preenchido do cofre "${p._vault}" — revise e salve`;
  } catch (e) { msg.textContent = "❌ " + e.message; }
});
$("#perfSaveBtn").addEventListener("click", async () => {
  const c = perfClient(); if (!c) return;
  c.profile = {
    ...(c.profile || {}),
    servico: $("#perfServico").value.trim(), oQueFaz: $("#perfFaz").value.trim(),
    oQueNaoFaz: $("#perfNaoFaz").value.trim(), persona: $("#perfPersona").value.trim(), obs: $("#perfObs").value.trim(),
    kickoff: $("#perfKickoff").value.trim(), personaDoc: $("#perfPersonaDoc").value.trim(), servicoFoco: $("#perfServicoFoco").value.trim(),
  };
  await window.api.setClients(state.clients);
  $("#perfMsg").textContent = "✅ salvo";
  toast(`Perfil de ${c.name} salvo.`);
});

/* ---------------- Kickoff → Persona (9 pilares, estilo da skill criar-persona) ---------------- */
// abrir arquivo de texto e jogar no campo de kickoff
$("#perfKickoffFile").addEventListener("click", () => {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".txt,.md,.markdown,text/plain";
  inp.addEventListener("change", () => {
    const f = inp.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { $("#perfKickoff").value = String(r.result || ""); toast("Kickoff carregado do arquivo."); };
    r.readAsText(f);
  });
  inp.click();
});

function personaPromptFromKickoff(c) {
  const p = (c && c.profile) || {};
  const kickoff = $("#perfKickoff").value.trim();
  const foco = $("#perfServicoFoco").value.trim();
  return [
    "Você é um profissional de marketing que cria um DOCUMENTO DE PERSONA completo para um anunciante de Google/Meta Ads, a partir do documento de KICKOFF do cliente.",
    "Use o KICKOFF como fonte primária. Onde faltar informação, infira pelo segmento — mas priorize sempre o que está no kickoff.",
    foco ? `ATENÇÃO: a empresa tem mais de um serviço. FOQUE A PERSONA EXCLUSIVAMENTE NESTE SERVIÇO: "${foco}". Ignore os outros serviços — toda a persona (problemas, concorrentes, dúvidas, objeções, desejos) deve ser sobre quem compra ESSE serviço.` : "",
    "",
    "Entregue o documento organizado EXATAMENTE nestes 9 pilares, nesta ordem:",
    "1. Problemas resolvidos — qual(is) problema(s) o que o negócio vende resolve.",
    "2. Concorrentes diretos — de 1 a 5, em tabela: Nome | Site | Google Meu Negócio | Instagram.",
    "3. Concorrentes indiretos — de 1 a 5 soluções que resolvem o mesmo problema sem vender o mesmo produto, mesma tabela.",
    "4. Fatores de confiança — 5 a 10 fatores que fazem as pessoas confiarem e comprarem de empresas assim.",
    "5. Fatores de desistência — o que mais faz as pessoas desistirem de comprar de empresas assim.",
    "6. Dúvidas sobre o produto/serviço — as 10 principais.",
    "7. Dúvidas sobre a empresa — as 10 principais.",
    "8. Desejos e sonhos — os 10 maiores das pessoas que querem comprar.",
    "9. Objeções de compra — as 10 principais, cada uma COM a resposta de como contorná-la.",
    "",
    "Escreva em português, claro e direto, pronto pra embasar campanhas, criativos e copy. NÃO use markdown com ** para negrito; use títulos em linha simples.",
    "",
    "== CLIENTE ==",
    `Nome: ${c ? c.name : ""}`,
    `O que faz: ${p.servico || p.oQueFaz || "(ver kickoff)"}`,
    p.oQueNaoFaz ? `O que NÃO faz: ${p.oQueNaoFaz}` : "",
    "",
    "== DOCUMENTO DE KICKOFF ==",
    `"""${kickoff}"""`,
  ].filter((x) => x !== "").join("\n");
}

$("#perfPersonaGen").addEventListener("click", async () => {
  const c = perfClient(); if (!c) { toast("Selecione um cliente.", true); return; }
  if (!$("#perfKickoff").value.trim()) { toast("Cole o documento de kickoff primeiro.", true); return; }
  const btn = $("#perfPersonaGen"); const orig = btn.textContent; btn.disabled = true; btn.textContent = "Gerando…";
  $("#perfPersonaMsg").textContent = "🤖 a IA está montando a persona pelos 9 pilares…";
  try {
    const txt = await window.api.geminiRaw({ prompt: personaPromptFromKickoff(c) });
    $("#perfPersonaDoc").value = txt;
    $("#perfPersonaMsg").textContent = "✅ persona gerada — revise e clique em Salvar.";
  } catch (e) { $("#perfPersonaMsg").textContent = "❌ " + e.message; toast("IA: " + e.message, true); }
  btn.disabled = false; btn.textContent = orig;
});

$("#perfPersonaSave").addEventListener("click", async () => {
  const c = perfClient(); if (!c) { toast("Selecione um cliente.", true); return; }
  c.profile = { ...(c.profile || {}), kickoff: $("#perfKickoff").value.trim(), personaDoc: $("#perfPersonaDoc").value.trim(), servicoFoco: $("#perfServicoFoco").value.trim() };
  await window.api.setClients(state.clients);
  $("#perfPersonaMsg").textContent = "✅ persona salva — em uso nas ferramentas";
  toast(`Persona de ${c.name} salva.`);
});

// salva (cria o cofre se não existir) uma nota no Obsidian do cliente em ~/Claude/Clientes
async function saveObsidian(c, title, content, btn) {
  if (!c) { toast("Selecione um cliente.", true); return; }
  if (!content || !content.trim()) { toast("Nada para salvar — gere o conteúdo primeiro.", true); return; }
  const orig = btn && btn.textContent;
  if (btn) { btn.disabled = true; btn.textContent = "Salvando…"; }
  try {
    const r = await window.api.obsidianSaveNote({ projectId: reporteiIdOf(c) || "", clientName: c.name, title, content });
    toast(`${r.created ? "📂 Cofre criado e " : ""}"${title}" salvo no Obsidian (${r.vault}).`);
  } catch (e) { toast("Obsidian: " + e.message, true); }
  if (btn) { btn.disabled = false; btn.textContent = orig; }
}
$("#perfPersonaObs").addEventListener("click", () => saveObsidian(perfClient(), "Persona", $("#perfPersonaDoc").value, $("#perfPersonaObs")));

/* ============================================================
   PLANEJADOR DE PALAVRAS-CHAVE (volume real do Google)
   ============================================================ */
function kwClient() { return state.clients.find((c) => c.projectId === Number($("#kwClientSel").value)) || null; }
// preenche serviço foco + site do cliente e indica se a persona será usada.
// force=true substitui o que estiver nos campos (troca de cliente); senão só preenche se vazio (preserva edição).
function loadKw({ clear = false, force = false } = {}) {
  const c = kwClient() || {}; const prof = c.profile || {}; const ads = c.adAccounts || {};
  if (force || !$("#kwService").value.trim()) $("#kwService").value = prof.servicoFoco || prof.servico || prof.oQueFaz || "";
  if (force || !$("#kwUrl").value.trim()) $("#kwUrl").value = ads.site || "";
  const tag = $("#kwPersonaTag");
  if (tag) tag.textContent = prof.personaDoc
    ? (prof.servicoFoco ? `· 🎯 foco: ${prof.servicoFoco} · ✅ persona em uso` : "· ✅ persona do kickoff em uso")
    : "· ⚠️ sem persona (gere em 👤 Perfil do cliente)";
  if (clear) ["persona", "risco", "anuncios"].forEach((m) => { const o = $("#out-" + m); if (o) { o.innerHTML = ""; o.dataset.raw = ""; o.classList.add("hidden"); } const b = $("#badge-" + m); if (b) { b.textContent = ""; b.className = "gads-mod__badge"; } });
}
$("#kwClientSel").addEventListener("change", () => loadKw({ clear: true, force: true }));
// módulos de texto (Persona, Risco, Ideias de Anúncios) — seguem as skills + políticas, lendo o site
$$(".gads-run").forEach((b) => b.addEventListener("click", async () => {
  const mod = b.dataset.mod; const c = kwClient(); const prof = (c && c.profile) || {};
  const out = $("#out-" + mod), badge = $("#badge-" + mod);
  const orig = b.textContent; b.disabled = true; b.textContent = "Gerando…";
  out.classList.remove("hidden"); out.innerHTML = '<p class="md-load">⏳ a IA está lendo o site e montando…</p>';
  try {
    const txt = await window.api.gadsPlan({ modulo: mod, url: $("#kwUrl").value.trim(), service: $("#kwService").value.trim() || prof.servico || prof.oQueFaz || "", oQueNaoFaz: prof.oQueNaoFaz || "", clientName: c ? c.name : "", persona: prof.personaDoc || "" });
    const titles = { persona: "Persona", risco: "Risco de Mercado", anuncios: "Ideias de Anúncios" };
    out.dataset.raw = txt;
    out.innerHTML = `<div style="display:flex;justify-content:flex-end;margin-bottom:8px"><button class="chip-btn gads-obs-btn">💾 Salvar no Obsidian</button></div>` + mdToHtml(txt);
    const ob = $(".gads-obs-btn", out); if (ob) ob.addEventListener("click", () => saveObsidian(kwClient(), titles[mod] || mod, out.dataset.raw, ob));
    badge.textContent = "Feito"; badge.className = "gads-mod__badge done";
  } catch (e) { out.innerHTML = `<p class="md-err">❌ ${e.message}</p>`; }
  b.disabled = false; b.textContent = orig;
}));
/* --- volume das palavras-chave que a analista já tem (sem gerar ideias novas) --- */
function kwVolFmt(termo, matchSel) {
  const m = ((matchSel || {}).value) || "phrase";
  if (m === "exact") return `[${termo}]`;
  if (m === "broad") return termo;
  return `"${termo}"`;
}
$("#kwVolBtn").addEventListener("click", async () => {
  const c = kwClient(); const body = $("#kwVolBody");
  const gid = c && c.adAccounts && c.adAccounts.google;
  if (!gid) { toast("Vincule a conta Google deste cliente em ⚙️ Configurações → \"contas\".", true); return; }
  const list = $("#kwVolInput").value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  if (!list.length) { toast("Cole ao menos uma palavra-chave.", true); return; }
  const btn = $("#kwVolBtn"); btn.disabled = true; btn.textContent = "Buscando volume…";
  body.innerHTML = '<div class="state">⏳ Consultando o Google Ads…</div>';
  try {
    const res = await window.api.googleAdsKeywordVolume({ customerId: gid, keywords: list });
    state.kwVolResults = res;
    renderKwVol(res);
  } catch (e) { body.innerHTML = `<div class="state error">❌ ${e.message}</div>`; }
  btn.disabled = false; btn.textContent = "Ver volume";
});
function renderKwVol(list) {
  const brl = (n) => (n == null ? "—" : "R$ " + n.toFixed(2));
  const rows = list.map((k, i) => `<tr><td style="text-align:center"><input type="checkbox" class="kwvol-ck" data-i="${i}" checked></td><td style="text-align:left">${k.termo}</td><td>${E.fmt.n(k.volume)}</td><td>${k.concorrencia}</td><td>${brl(k.lanceMin)} – ${brl(k.lanceMax)}</td></tr>`).join("");
  $("#kwVolBody").innerHTML = `
    <div class="table-wrap"><table><thead><tr><th style="width:40px">✓</th><th style="text-align:left">Palavra-chave</th><th>Buscas/mês</th><th>Concorrência</th><th>Lance topo (R$)</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
      <label style="font-size:12px;color:var(--muted)">Correspondência</label>
      <select id="kwVolMatch" style="background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:7px 10px;color:var(--txt);outline:none">
        <option value="phrase">"Frase"</option>
        <option value="exact">[Exata]</option>
        <option value="broad">Ampla</option>
      </select>
      <button class="btn btn-ghost" id="kwVolCopyBtn">📋 Copiar</button>
      <button class="btn btn-primary" id="kwVolAdsBtn">✍️ Gerar títulos e descrições</button>
    </div>
    <p class="sub" style="margin-top:8px">Marque as palavras-chave que quer usar e gere títulos e descrições (RSA) coerentes com elas e com a página de destino (campo "Site do cliente" acima).</p>
    <div id="kwVolAdsBody" style="margin-top:12px"></div>`;
  $("#kwVolCopyBtn").addEventListener("click", () => {
    const results = state.kwVolResults || [];
    const matchSel = $("#kwVolMatch");
    let sel = [...$$(".kwvol-ck")].filter((c) => c.checked).map((c) => results[+c.dataset.i].termo);
    if (!sel.length) sel = results.map((k) => k.termo);
    const fmt = sel.map((t) => kwVolFmt(t, matchSel));
    navigator.clipboard.writeText(fmt.join("\n"));
    const mLabel = { phrase: "frase", exact: "exata", broad: "ampla" }[(matchSel || {}).value || "phrase"];
    toast(`${fmt.length} palavra(s) copiada(s) em correspondência ${mLabel}.`);
  });
  $("#kwVolAdsBtn").addEventListener("click", async () => {
    const results = state.kwVolResults || [];
    let sel = [...$$(".kwvol-ck")].filter((c) => c.checked).map((c) => results[+c.dataset.i].termo);
    if (!sel.length) sel = results.map((k) => k.termo);
    if (!sel.length) { toast("Selecione ao menos uma palavra-chave.", true); return; }
    const c = kwClient(); const prof = (c && c.profile) || {};
    const btn = $("#kwVolAdsBtn"); const out = $("#kwVolAdsBody");
    btn.disabled = true; btn.textContent = "Gerando…";
    out.innerHTML = '<div class="state">⏳ Lendo a página de destino e escrevendo os anúncios coerentes com as palavras-chave…</div>';
    try {
      const res = await window.api.gadsAdsFromKeywords({
        keywords: sel, url: $("#kwUrl").value.trim(),
        service: $("#kwService").value.trim() || prof.servico || prof.oQueFaz || "",
        clientName: c ? c.name : "", persona: prof.personaDoc || "", oQueNaoFaz: prof.oQueNaoFaz || "",
      });
      const txt = (res && typeof res === "object") ? (res.text || "") : String(res || "");
      state.kwVolAdsData = (res && typeof res === "object") ? res.data : null;
      out.dataset.raw = txt;
      out.innerHTML = `<div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:8px"><button class="chip-btn" id="kwVolAdsCopy">📋 Copiar</button><button class="chip-btn" id="kwVolAdsObs">💾 Salvar no Obsidian</button></div>` + mdToHtml(txt) + uploadPanelHtml(c);
      $("#kwVolAdsCopy").addEventListener("click", () => { navigator.clipboard.writeText(out.dataset.raw); toast("Anúncios copiados."); });
      const ob = $("#kwVolAdsObs"); if (ob) ob.addEventListener("click", () => saveObsidian(kwClient(), "Anúncios Google (títulos e descrições)", out.dataset.raw, ob));
      wireUploadPanel();
    } catch (e) { out.innerHTML = `<div class="state error">❌ ${e.message}</div>`; }
    btn.disabled = false; btn.textContent = "✍️ Gerar títulos e descrições";
  });
}

// painel pra subir a campanha de Rede de Pesquisa como rascunho no Google Ads
function uploadPanelHtml(c) {
  const gid = c && c.adAccounts && c.adAccounts.google;
  const d = state.kwVolAdsData;
  if (!d || !(d.headlines || []).length) return `<p class="sub" style="margin-top:14px;color:#e0a97a">Pra subir direto no Google Ads, gere os anúncios de novo (a versão nova já monta a estrutura pronta pra subir).</p>`;
  if (!gid) return `<p class="sub" style="margin-top:14px;color:#e0a97a">Vincule a conta Google deste cliente em ⚙️ Configurações → "contas" pra subir a campanha por aqui.</p>`;
  const svc = ($("#kwService").value.trim().split(/[.,\n]/)[0] || "Pesquisa").slice(0, 40);
  const defName = `Pesquisa · ${(c && c.name) || svc}`;
  const m = ($("#kwVolMatch") || {}).value || "phrase";
  const opt = (v, l) => `<option value="${v}"${v === m ? " selected" : ""}>${l}</option>`;
  return `<div class="card" id="kwUpBox" style="margin-top:16px;border:1px solid rgba(25,227,162,.3)">
    <h2 style="font-size:15px">🚀 Subir no Google Ads como rascunho</h2>
    <p class="sub">Cria uma campanha de <b>Rede de Pesquisa</b> pausada com o grupo, as palavras-chave marcadas e este anúncio (títulos, descrições, caminhos + extensões). Você ajusta o resto no Google.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
      <div class="formrow" style="flex:1;min-width:220px;margin:0"><label>Nome da campanha</label><input type="text" id="kwUpName" value="${defName.replace(/"/g, "&quot;")}"></div>
      <div class="formrow" style="margin:0"><label>Orçamento diário (R$)</label><input type="number" id="kwUpBudget" value="30" min="1" style="width:130px"></div>
      <div class="formrow" style="margin:0"><label>Correspondência</label><select id="kwUpMatch" style="min-width:120px">${opt("phrase", '"Frase"')}${opt("exact", "[Exata]")}${opt("broad", "Ampla")}</select></div>
      <button class="btn btn-purple" id="kwUpBtn">🚀 Subir rascunho</button>
    </div>
    <div id="kwUpLog" style="margin-top:12px"></div>
  </div>`;
}
function wireUploadPanel() {
  const btn = $("#kwUpBtn"); if (!btn) return;
  btn.addEventListener("click", async () => {
    const c = kwClient(); const gid = c && c.adAccounts && c.adAccounts.google;
    const d = state.kwVolAdsData || {};
    const results = state.kwVolResults || [];
    let sel = [...$$(".kwvol-ck")].filter((x) => x.checked).map((x) => results[+x.dataset.i].termo);
    if (!sel.length) sel = results.map((k) => k.termo);
    const name = $("#kwUpName").value.trim() || "Pesquisa";
    const budget = parseFloat($("#kwUpBudget").value) || 30;
    const matchType = { phrase: "PHRASE", exact: "EXACT", broad: "BROAD" }[($("#kwUpMatch") || {}).value || "phrase"];
    const log = $("#kwUpLog");
    if (!window.confirm(`Criar a campanha de Pesquisa "${name}" PAUSADA (rascunho) com ${sel.length} palavra(s)-chave e este anúncio? Nada vai ao ar até você ativar no Google Ads.`)) return;
    btn.disabled = true; btn.textContent = "Subindo…";
    log.innerHTML = '<div class="state">⏳ Criando orçamento, campanha, grupo, palavras-chave, anúncio e extensões…</div>';
    try {
      const r = await window.api.gadsCreateSearchDraft({
        customerId: gid, campaignName: name, finalUrl: $("#kwUrl").value.trim(),
        keywords: sel, matchType, dailyBudget: budget,
        headlines: d.headlines, descriptions: d.descriptions,
        path1: (d.paths || [])[0], path2: (d.paths || [])[1],
        sitelinks: d.sitelinks, callouts: d.callouts, snippet: d.snippet,
      });
      const escLog = (l) => String(l).replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]));
      log.innerHTML = `<div class="warnbar" style="background:rgba(25,227,162,.07);border-color:rgba(25,227,162,.3);color:#7be8c0">✅ Rascunho criado na conta! <b>${escLog(r.campaignName)}</b> (id ${escLog(r.campId)}) — pausada, pronta pra você revisar no Google Ads.</div><div style="margin-top:8px;font-size:13px;line-height:1.9">${(r.log || []).map(escLog).join("<br>")}</div>`;
    } catch (e) { log.innerHTML = `<div class="state error">❌ ${e.message}</div>`; }
    btn.disabled = false; btn.textContent = "🚀 Subir rascunho";
  });
}

$("#kwBtn").addEventListener("click", async () => {
  const c = kwClient(); const body = $("#kwBody");
  const gid = c && c.adAccounts && c.adAccounts.google;
  const service = $("#kwService").value.trim();
  const seedsRaw = $("#kwSeeds").value.trim();
  const url = $("#kwUrl").value.trim();
  if (!service && !seedsRaw && !url) { toast("Descreva o negócio, ou dê sementes/site.", true); return; }
  const btn = $("#kwBtn"); btn.disabled = true; btn.textContent = "Gerando…";
  $("#kwCopyBtn").classList.add("hidden");
  body.innerHTML = '<div class="state"><div class="big">🤖</div>A IA está montando as palavras-semente…</div>';
  try {
    let seeds = seedsRaw ? seedsRaw.split(",").map((x) => x.trim()).filter(Boolean) : [];
    if (!seeds.length && service) {
      const prompt = `Você é especialista em Google Ads. Liste de 8 a 12 PALAVRAS-CHAVE semente (termos que pessoas buscariam no Google) para o negócio: "${service}". Responda SÓ um JSON array de strings, sem texto extra.`;
      try { const raw = await window.api.geminiRaw({ prompt }); const m = raw.match(/\[[\s\S]*\]/); if (m) seeds = JSON.parse(m[0]).map(String).slice(0, 15); } catch {}
    }
    body.innerHTML = '<div class="state"><div class="big">🔑</div>Buscando o volume real no Google…</div>';
    const ideas = await window.api.googleAdsKeywordIdeas({ customerId: gid, keywords: seeds, url });
    if (!ideas.length) { body.innerHTML = '<div class="state"><div class="big">🔑</div>Nenhuma ideia retornada — tente outras sementes ou um site.</div>'; return; }
    state.kwIdeas = ideas;
    state.kwSeedsUsed = seeds;
    body.innerHTML = '<div class="state"><div class="big">🤖</div>Separando iniciais, marcas de concorrentes e negativas…</div>';
    const cls = await classifyKwIdeas(ideas, c);
    renderKw(ideas, seeds, cls);
  } catch (e) { body.innerHTML = `<div class="state error"><div class="big">⚠️</div>${e.message}</div>`; }
  btn.disabled = false; btn.textContent = "Gerar palavras-chave";
});

// classifica as ideias: separa MARCAS DE CONCORRENTES e NEGATIVAS (fora do negócio); o resto é inicial relevante
async function classifyKwIdeas(ideas, c) {
  const prof = (c && c.profile) || {};
  const service = $("#kwService").value.trim() || prof.servicoFoco || prof.servico || prof.oQueFaz || "";
  const naoFaz = prof.oQueNaoFaz || "";
  const persona = prof.personaDoc || "";
  const out = { concorrente: {}, negativa: {} };
  try {
    const list = ideas.map((k, i) => `${i}: ${k.termo}`).join("\n");
    const prompt = [
      `Você é analista de Google Ads. Negócio do cliente: "${service}".`,
      naoFaz ? `O que o cliente NÃO faz: ${naoFaz}` : "",
      persona ? `Trecho da persona (use pra reconhecer marcas de CONCORRENTES citadas):\n${persona.slice(0, 2500)}` : "",
      `Abaixo, ideias de palavras-chave (índice: termo). Marque as que NÃO devem virar palavra-chave INICIAL da campanha:`,
      `• CONCORRENTE: termo que é nome/marca de um concorrente (não mirar como captação inicial).`,
      `• NEGATIVA: termo que NÃO tem a ver com o negócio (emprego/vaga, curso, "o que é"/significado, grátis, outro produto/serviço fora do que o cliente faz) — vira palavra-chave negativa.`,
      `O que não for nem concorrente nem negativa é inicial relevante (não precisa listar).`,
      `Responda SÓ um JSON: {"concorrente":[{"i":<idx>}],"negativa":[{"i":<idx>,"motivo":"<curto>"}]}. Cada termo em no máximo uma lista. Sem texto extra.`,
      list,
    ].filter(Boolean).join("\n\n");
    const raw = await window.api.geminiRaw({ prompt });
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { const o = JSON.parse(m[0]); (o.concorrente || []).forEach((x) => { if (x && x.i != null) out.concorrente[x.i] = true; }); (o.negativa || []).forEach((x) => { if (x && x.i != null) out.negativa[x.i] = x.motivo || "fora do negócio"; }); }
  } catch {}
  return out;
}
function renderKw(ideas, seeds, cls) {
  cls = cls || { concorrente: {}, negativa: {} };
  state.kwCls = cls;
  const body = $("#kwBody");
  const brl = (n) => (n == null ? "—" : "R$ " + n.toFixed(2));
  const idx = ideas.map((_, i) => i);
  const relI = idx.filter((i) => !cls.concorrente[i] && !cls.negativa[i]);
  const concI = idx.filter((i) => cls.concorrente[i]);
  const negI = idx.filter((i) => cls.negativa[i]);

  const relRows = relI.map((i) => { const k = ideas[i]; return `<tr><td style="text-align:center"><input type="checkbox" class="kw-ck" data-i="${i}"></td><td style="text-align:left">${k.termo}</td><td>${E.fmt.n(k.volume)}</td><td>${k.concorrencia}</td><td>${brl(k.lanceMin)} – ${brl(k.lanceMax)}</td></tr>`; }).join("") || '<tr><td colspan="5" style="color:var(--muted)">—</td></tr>';
  const negRows = negI.map((i) => { const k = ideas[i]; return `<tr><td style="text-align:center"><input type="checkbox" class="kw-neg-ck" data-i="${i}" checked></td><td style="text-align:left">${k.termo}<div style="font-size:11px;color:#e0857a">🚫 ${cls.negativa[i]}</div></td><td>${E.fmt.n(k.volume)}</td></tr>`; }).join("");
  const concRows = concI.map((i) => { const k = ideas[i]; return `<tr><td style="text-align:left">🏢 ${k.termo}</td><td>${E.fmt.n(k.volume)}</td><td>${k.concorrencia}</td></tr>`; }).join("");

  body.innerHTML = `<div class="warnbar" style="background:rgba(25,227,162,.07);border-color:rgba(25,227,162,.3);color:#7be8c0">🔑 <b>${relI.length}</b> palavras-chave iniciais (sem marcas de concorrentes)${concI.length ? ` · <b>${concI.length}</b> de concorrentes separadas` : ""}${negI.length ? ` · <b>${negI.length}</b> sugeridas como negativas` : ""}.</div>
    <div class="section-title">✅ Palavras-chave iniciais</div>
    <div class="table-wrap"><table><thead><tr><th style="width:40px">✓</th><th style="text-align:left">Palavra-chave</th><th>Buscas/mês</th><th>Concorrência</th><th>Lance topo (R$)</th></tr></thead><tbody>${relRows}</tbody></table></div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
      <label style="font-size:12px;color:var(--muted)">Correspondência</label>
      <select id="kwMatch" style="background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:7px 10px;color:var(--txt);outline:none">
        <option value="phrase">"Frase"</option>
        <option value="exact">[Exata]</option>
        <option value="broad">Ampla</option>
      </select>
      <button class="btn btn-ghost" id="kwCopyBtn2">📋 Copiar iniciais</button>
      <button class="btn btn-ghost" id="kwMoreBtn">➕ Buscar mais ideias</button>
    </div>
    ${negI.length ? `<div class="section-title" style="margin-top:22px">🚫 Sugestões de palavras-chave NEGATIVAS (fora do negócio)</div>
      <p class="sub" style="margin-bottom:8px">Termos que não têm a ver com o cliente — adicione como negativas pra não desperdiçar verba.</p>
      <div class="table-wrap"><table><thead><tr><th style="width:40px">✓</th><th style="text-align:left">Termo</th><th>Buscas/mês</th></tr></thead><tbody>${negRows}</tbody></table></div>
      <button class="btn btn-purple" id="kwNegCopyBtn" style="margin-top:8px">📋 Copiar negativas</button>` : ""}
    ${concI.length ? `<div class="section-title" style="margin-top:22px">🏢 Marcas de concorrentes (não usar como iniciais)</div>
      <p class="sub" style="margin-bottom:8px">Separadas pra você não mirar concorrente sem querer. Use só se for fazer campanha de marca concorrente de propósito.</p>
      <div class="table-wrap"><table><thead><tr><th style="text-align:left">Termo</th><th>Buscas/mês</th><th>Concorrência</th></tr></thead><tbody>${concRows}</tbody></table></div>` : ""}`;
  $("#kwCopyBtn").classList.add("hidden"); // usamos os botões inline por seção
  const cp = $("#kwCopyBtn2"); if (cp) cp.addEventListener("click", () => copyKw("rel"));
  const ncp = $("#kwNegCopyBtn"); if (ncp) ncp.addEventListener("click", () => copyKw("neg"));
  const mb = $("#kwMoreBtn"); if (mb) mb.addEventListener("click", buscarMaisKw);
  const bk = $("#badge-kw"); if (bk) { bk.textContent = "Feito"; bk.className = "gads-mod__badge done"; }
}

// gera sementes NOVAS (diferentes das já usadas) e agrega mais palavras-chave à lista, sem duplicar
async function buscarMaisKw() {
  const c = kwClient(); const gid = c && c.adAccounts && c.adAccounts.google;
  const btn = $("#kwMoreBtn"); if (!btn) return;
  const orig = btn.textContent; btn.disabled = true; btn.textContent = "Buscando…";
  try {
    const service = $("#kwService").value.trim() || "";
    const used = state.kwSeedsUsed || [];
    const prompt = `Você é especialista em Google Ads. Negócio: "${service}". Já usei estas sementes: ${used.join(", ") || "(nenhuma)"}. Liste de 10 a 15 NOVAS palavras-chave semente DIFERENTES das já usadas (sinônimos, variações regionais, termos relacionados, long-tail, dores do público) que tragam ideias novas. NÃO repita as já usadas. Responda SÓ um JSON array de strings.`;
    let seeds = [];
    try { const raw = await window.api.geminiRaw({ prompt }); const m = raw.match(/\[[\s\S]*\]/); if (m) seeds = JSON.parse(m[0]).map(String).slice(0, 15); } catch {}
    if (!seeds.length) { toast("Não consegui gerar mais sementes.", true); return; }
    state.kwSeedsUsed = [...new Set([...used, ...seeds])];
    const more = await window.api.googleAdsKeywordIdeas({ customerId: gid, keywords: seeds, url: $("#kwUrl").value.trim() });
    const seen = new Set((state.kwIdeas || []).map((k) => k.termo.toLowerCase()));
    const novos = (more || []).filter((k) => !seen.has(k.termo.toLowerCase()));
    if (!novos.length) { toast("Nenhuma palavra nova encontrada — tente um site ou outras sementes."); return; }
    state.kwIdeas = [...(state.kwIdeas || []), ...novos].sort((a, b) => b.volume - a.volume);
    btn.textContent = "Classificando…";
    const cls = await classifyKwIdeas(state.kwIdeas, c);
    renderKw(state.kwIdeas, state.kwSeedsUsed, cls);
    toast(`+${novos.length} palavra(s) nova(s).`);
  } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = orig; }
}
// formata o termo na correspondência escolhida do Google: [exata], "frase" ou ampla (sem marca)
function kwFmt(termo) {
  const m = (($("#kwMatch") || {}).value) || "phrase";
  if (m === "exact") return `[${termo}]`;
  if (m === "broad") return termo;
  return `"${termo}"`;
}
function copyKw(kind) {
  const ideas = state.kwIdeas || []; const cls = state.kwCls || { concorrente: {}, negativa: {} };
  const ckSel = kind === "neg" ? $$(".kw-neg-ck") : $$(".kw-ck");
  let list = [...ckSel].filter((c) => c.checked).map((c) => ideas[+c.dataset.i].termo);
  if (!list.length) list = ideas.filter((_, i) => kind === "neg" ? cls.negativa[i] : (!cls.concorrente[i] && !cls.negativa[i])).map((k) => k.termo);
  const fmt = list.map(kwFmt);
  navigator.clipboard.writeText(fmt.join("\n"));
  const mLabel = { phrase: "frase", exact: "exata", broad: "ampla" }[(($("#kwMatch") || {}).value) || "phrase"];
  toast(`${fmt.length} ${kind === "neg" ? "negativa(s)" : "palavra(s)"} copiada(s) em correspondência ${mLabel}.`);
}

/* ============================================================
   TERMOS DE BUSCA → negativação (Google Ads)
   ============================================================ */
function termClient() { return state.clients.find((c) => c.projectId === Number($("#termClientSel").value)) || null; }

// período personalizado: mostra/esconde os campos de data
$("#termPeriod").addEventListener("change", (e) => {
  const custom = e.target.value === "custom";
  $("#termCustomDates").classList.toggle("hidden", !custom);
  if (custom && !$("#termEnd").value) {
    const iso = (d) => d.toISOString().slice(0, 10);
    const end = new Date(); const start = new Date(); start.setDate(end.getDate() - 7);
    $("#termStart").value = iso(start); $("#termEnd").value = iso(end);
  }
});

$("#termBtn").addEventListener("click", async () => {
  const c = termClient(); const body = $("#termBody");
  const gid = c && c.adAccounts && c.adAccounts.google;
  if (!gid) { body.innerHTML = `<div class="state error"><div class="big">⚠️</div>Vincule a conta Google deste cliente em ⚙️ Configurações → "contas".</div>`; return; }
  const iso = (d) => d.toISOString().slice(0, 10);
  let startIso, endIso;
  if ($("#termPeriod").value === "custom") {
    startIso = $("#termStart").value; endIso = $("#termEnd").value;
    if (!startIso || !endIso) { body.innerHTML = `<div class="state error"><div class="big">📅</div>Escolha as duas datas (de e até).</div>`; return; }
    if (startIso > endIso) { const t = startIso; startIso = endIso; endIso = t; }
  } else {
    const days = Number($("#termPeriod").value);
    const end = new Date(); const start = new Date(); start.setDate(end.getDate() - days);
    startIso = iso(start); endIso = iso(end);
  }
  body.innerHTML = `<div class="state"><div class="big">⏳</div>Puxando os termos de busca do Google…</div>`;
  $("#termNegBtn").classList.add("hidden");
  try {
    const terms = await window.api.googleAdsSearchTerms({ customerId: gid, start: startIso, end: endIso });
    if (!terms.length) { body.innerHTML = `<div class="state"><div class="big">🔎</div>Nenhum termo de busca no período (só campanhas de Pesquisa geram esses dados).</div>`; return; }
    const service = termServico(c);
    body.innerHTML = `<div class="state"><div class="big">🤖</div>A IA está avaliando ${terms.length} termos com base no que o cliente faz…</div>`;
    const neg = {}, add = {};
    try {
      const list = terms.slice(0, 150).map((t, i) => `${i}: ${t.term}`).join("\n");
      const prompt = [
        `Você é analista de mídia paga. O cliente: "${service}".`,
        `Abaixo, termos de busca reais que dispararam anúncios (índice: termo). Classifique:`,
        `• NEGATIVAR: termos que NÃO fazem sentido pro negócio (busca por emprego/vaga, curso, grátis, concorrente irrelevante, fora do serviço) — desperdício.`,
        `• ADICIONAR: termos MUITO relevantes pro serviço, com boa intenção de compra, que valeria a pena ter como palavra-chave própria.`,
        `Responda SÓ um JSON: {"negativar":[{"i":<índice>,"motivo":"<curto>"}],"adicionar":[{"i":<índice>,"motivo":"<curto>"}]}. Um termo só pode estar numa lista. Sem texto extra.`,
        list,
      ].join("\n\n");
      const raw = await window.api.geminiRaw({ prompt });
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) { const o = JSON.parse(m[0]); (o.negativar || []).forEach((x) => { if (x && x.i != null) neg[x.i] = x.motivo || "irrelevante"; }); (o.adicionar || []).forEach((x) => { if (x && x.i != null) add[x.i] = x.motivo || "relevante"; }); }
    } catch {}
    state.terms = terms;
    renderTermos(neg, add);
  } catch (e) { body.innerHTML = `<div class="state error"><div class="big">⚠️</div>${e.message}</div>`; }
});

// serviço do cliente: campo digitado, senão o perfil do Obsidian
function termServico(c) {
  const prof = (c && c.profile) || {};
  return $("#termService").value.trim() || [prof.servico || prof.oQueFaz, prof.oQueNaoFaz ? "NÃO faz: " + prof.oQueNaoFaz : ""].filter(Boolean).join(". ") || (c && c.name) || "";
}
// preenche o campo serviço a partir do perfil quando troca de cliente
$("#termClientSel").addEventListener("change", () => {
  const c = termClient(); const prof = (c && c.profile) || {};
  $("#termService").value = [prof.servico || prof.oQueFaz, prof.oQueNaoFaz ? "NÃO faz: " + prof.oQueNaoFaz : ""].filter(Boolean).join(". ");
});

function renderTermos(neg, add) {
  const terms = state.terms || [];
  const body = $("#termBody");
  const brl = (n) => "R$ " + (n || 0).toFixed(2);
  const isExcluded = (t) => t && (t.status === "EXCLUDED" || t.status === "ADDED_EXCLUDED");
  const isAdded = (t) => t && (t.status === "ADDED" || t.status === "ADDED_EXCLUDED");
  // não puxa o que já está negativado / já é palavra-chave
  const negAll = Object.keys(neg).map(Number);
  const addAll = Object.keys(add).map(Number);
  const negIdx = negAll.filter((i) => !isExcluded(terms[i]));
  const addIdx = addAll.filter((i) => !isAdded(terms[i]));
  const jaNeg = negAll.length - negIdx.length, jaAdd = addAll.length - addIdx.length;

  const negRows = terms.map((t, i) => negIdx.includes(i) ? `<tr class="term-bad">
      <td style="text-align:center"><input type="checkbox" class="term-ck" data-i="${i}" checked></td>
      <td style="text-align:left">${t.term || ""}<div class="term-motivo">🚫 ${neg[i]}</div></td>
      <td>${t.campaignName || ""}</td><td>${E.fmt.n(t.clicks)}</td><td>${brl(t.cost)}</td><td>${t.conversions || 0}</td>
    </tr>` : "").join("");

  const addRows = addIdx.map((i) => { const t = terms[i]; return `<tr>
      <td style="text-align:center"><input type="checkbox" class="term-add-ck" data-i="${i}" checked></td>
      <td style="text-align:left">${t.term || ""}<div class="term-motivo" style="color:#7be8c0">➕ ${add[i]}</div></td>
      <td>${t.campaignName || ""}</td><td>${E.fmt.n(t.clicks)}</td><td>${t.conversions || 0}</td>
      <td><select class="term-mt" data-i="${i}" style="background:var(--panel-2);border:1px solid var(--line);border-radius:7px;padding:5px 7px;color:var(--txt)">
        <option value="PHRASE">Frase</option><option value="BROAD">Ampla</option><option value="EXACT">Exata</option></select></td>
    </tr>`; }).join("");

  const ocultos = (jaNeg + jaAdd) ? ` <span style="opacity:.8">(${jaNeg} já negativados e ${jaAdd} já adicionados foram ocultados)</span>` : "";
  body.innerHTML = `<div class="warnbar" style="background:rgba(25,227,162,.07);border-color:rgba(25,227,162,.3);color:#7be8c0">
      🤖 A IA analisou ${terms.length} termos: <b>${negIdx.length}</b> pra negativar (desperdício) e <b>${addIdx.length}</b> pra adicionar (relevantes).${ocultos} Revise e aplique no Google.</div>
    ${negIdx.length ? `<div class="section-title">🚫 Negativar (irrelevantes — desperdício)</div>
      <div class="table-wrap"><table><thead><tr><th style="width:40px">✓</th><th style="text-align:left">Termo</th><th>Campanha</th><th>Cliques</th><th>Custo</th><th>Conv.</th></tr></thead><tbody>${negRows}</tbody></table></div>
      <button class="btn btn-purple" id="termNegBtn2" style="margin:10px 0 24px">🚫 Negativar selecionados</button>` : ""}
    ${addIdx.length ? `<div class="section-title">➕ Adicionar como palavra-chave (relevantes)</div>
      <div class="table-wrap"><table><thead><tr><th style="width:40px">✓</th><th style="text-align:left">Termo</th><th>Campanha</th><th>Cliques</th><th>Conv.</th><th>Correspondência</th></tr></thead><tbody>${addRows}</tbody></table></div>
      <button class="btn btn-primary" id="termAddBtn2" style="margin-top:10px">➕ Adicionar selecionadas</button>` : ""}
    ${(() => {
      const exc = terms.filter(isExcluded);
      if (!exc.length) return "";
      const r = exc.map((t) => `<tr><td style="text-align:left">🔕 ${t.term || ""}</td><td>${t.campaignName || ""}</td><td>${E.fmt.n(t.clicks)}</td><td>${brl(t.cost)}</td></tr>`).join("");
      return `<div class="section-title" style="margin-top:28px">🔕 Já negativados (${exc.length})</div>
        <p class="sub" style="margin-bottom:8px">Termos que já estão como palavra-chave negativa nesta conta (não entram pra negativar de novo).</p>
        <div class="table-wrap"><table><thead><tr><th style="text-align:left">Termo</th><th>Campanha</th><th>Cliques</th><th>Custo</th></tr></thead><tbody>${r}</tbody></table></div>`;
    })()}`;
  $("#termNegBtn").classList.add("hidden"); // usamos os botões inline por seção
  const nb = $("#termNegBtn2"); if (nb) nb.addEventListener("click", doNegate);
  const ab = $("#termAddBtn2"); if (ab) ab.addEventListener("click", doAddKeywords);
}

async function doNegate() {
  const c = termClient(); const gid = c && c.adAccounts && c.adAccounts.google;
  const terms = state.terms || [];
  const items = [...$$(".term-ck")].filter((ck) => ck.checked).map((ck) => { const t = terms[+ck.dataset.i]; return { campaignId: t.campaignId, text: t.term }; }).filter((x) => x.campaignId && x.text);
  if (!items.length) { toast("Selecione ao menos um termo.", true); return; }
  if (!window.confirm(`Negativar ${items.length} termo(s) (correspondência exata) nas campanhas de "${c.name}"?\n\nNão exclui nada — só impede esses termos de disparar anúncio.`)) return;
  const btn = $("#termNegBtn2"); btn.disabled = true; btn.textContent = "Negativando…";
  try {
    const log = await window.api.googleAdsNegate({ customerId: gid, items });
    const fails = log.filter((l) => !l.ok).length;
    const okN = items.length; // estimado (negativados solicitados)
    try { await window.api.logAction({ projectId: c.projectId, clientName: c.name, type: "negativacao", summary: `${okN} termo(s) negativado(s) no Google Ads`, detail: items.map((x) => x.text).join(", ") }); } catch {}
    toast(fails ? `${fails} grupo(s) falharam.` : `${items.length} termo(s) negativado(s)! ✅`, !!fails);
    $("#termBody").insertAdjacentHTML("afterbegin", log.map((l) => `<div class="warnbar" style="${l.ok ? "background:rgba(25,227,162,.07);border-color:rgba(25,227,162,.3);color:#7be8c0" : ""}">${l.txt}</div>`).join(""));
  } catch (e) { toast(e.message, true); }
  btn.disabled = false; btn.textContent = "🚫 Negativar selecionados";
}

async function doAddKeywords() {
  const c = termClient(); const gid = c && c.adAccounts && c.adAccounts.google;
  const terms = state.terms || [];
  const items = [...$$(".term-add-ck")].filter((ck) => ck.checked).map((ck) => {
    const i = +ck.dataset.i; const t = terms[i]; const mt = ($(`.term-mt[data-i="${i}"]`) || {}).value || "PHRASE";
    return { adGroupId: t.adGroupId, text: t.term, matchType: mt };
  }).filter((x) => x.adGroupId && x.text);
  if (!items.length) { toast("Selecione ao menos um termo.", true); return; }
  if (!window.confirm(`Adicionar ${items.length} palavra(s)-chave nos grupos de anúncios de "${c.name}"?\n\nEntram ATIVAS — confira lances/conflitos depois no Google.`)) return;
  const btn = $("#termAddBtn2"); btn.disabled = true; btn.textContent = "Adicionando…";
  try {
    const log = await window.api.googleAdsAddKeywords({ customerId: gid, items });
    const fails = log.filter((l) => !l.ok).length;
    try { await window.api.logAction({ projectId: c.projectId, clientName: c.name, type: "keyword", summary: `${items.length} palavra(s)-chave adicionada(s) no Google Ads`, detail: items.map((x) => `${x.text} (${x.matchType})`).join(", ") }); } catch {}
    toast(fails ? `${fails} grupo(s) falharam.` : `${items.length} palavra(s)-chave adicionada(s)! ✅`, !!fails);
    $("#termBody").insertAdjacentHTML("afterbegin", log.map((l) => `<div class="warnbar" style="${l.ok ? "background:rgba(25,227,162,.07);border-color:rgba(25,227,162,.3);color:#7be8c0" : ""}">${l.txt}</div>`).join(""));
  } catch (e) { toast(e.message, true); }
  btn.disabled = false; btn.textContent = "➕ Adicionar selecionadas";
}

/* ============================================================
   URGÊNCIA (clientes fora do padrão nos últimos 2 dias)
   ============================================================ */
$("#urgenciaBtn").addEventListener("click", scanUrgencias);
async function scanUrgencias() {
  const body = $("#urgenciaBody"), btn = $("#urgenciaBtn");
  body.innerHTML = '<div class="state"><div class="big">⏳</div>Varrendo todos os clientes (últimos 2 dias vs padrão de 14 dias)… pode levar ~1 min.</div>';
  btn.disabled = true; btn.textContent = "Analisando…";
  try {
    const r = await window.api.urgencyScan();
    btn.disabled = false; btn.textContent = "Analisar urgências (últimos 2 dias)";
    if (!r.results.length) { body.innerHTML = `<div class="state"><div class="big">✅</div>Nenhum cliente fora do padrão nos últimos 2 dias.<br><span style="font-size:12px">${r.scanned} clientes verificados · período ${r.period}</span></div>`; return; }
    body.innerHTML = `<div class="warnbar" style="background:rgba(255,93,108,.08);border-color:rgba(255,93,108,.35);color:#ff8a94">🚨 ${r.results.length} cliente(s) em atenção · período ${r.period} · ${r.scanned} verificados</div>`
      + r.results.map((c) => `<div class="platform" style="margin-bottom:14px">
          <div class="p-head"><div class="p-badge" style="background:var(--bad)">!</div><h3>${c.clientName}</h3><div class="p-spacer"></div><div class="p-total">${c.alerts.length} alerta(s)</div></div>
          <div style="padding:12px 18px;display:flex;flex-direction:column;gap:9px">${c.alerts.map((a) => `<div style="font-size:13px;display:flex;gap:9px;align-items:flex-start;line-height:1.4"><span style="font-weight:800">${a.sev === "alta" ? "🔴" : "🟠"}</span><span>${a.txt}</span></div>`).join("")}</div>
        </div>`).join("");
  } catch (e) { btn.disabled = false; btn.textContent = "Analisar urgências (últimos 2 dias)"; body.innerHTML = `<div class="state error"><div class="big">⚠️</div>${e.message}</div>`; }
}

/* ============================================================
   RELATÓRIOS (mensal, segue o modelo do Obsidian)
   ============================================================ */
$("#gerarRelBtn").addEventListener("click", gerarRelatorio);
async function gerarRelatorio() {
  const projectId = Number($("#repClientSel").value);
  if (!projectId) { toast("Selecione um cliente.", true); return; }
  const { y, m } = state.repMonth;
  const start = `${y}-${pad(m)}-01`;
  const end = iso(new Date(y, m, 0)); // último dia do mês
  const pPrev = new Date(y, m - 2, 1); // mês anterior
  const py = pPrev.getFullYear(), pm = pPrev.getMonth() + 1;
  const prevStart = `${py}-${pad(pm)}-01`, prevEnd = iso(new Date(py, pm, 0));
  const monthLabel = monthLabelOf(y, m);
  const repCli = state.clients.find((c) => c.projectId === projectId) || {};
  const cName = repCli.name || "";
  const body = $("#repBody");
  body.innerHTML = '<div class="state"><div class="big">⏳</div>Puxando dado ao vivo (Meta/Google pela sua API) + LinkedIn pelo Reportei, com o mês anterior pra comparar…</div>';
  $("#copyRelBtn").classList.add("hidden"); $("#pdfRelBtn").classList.add("hidden");
  try {
    const resp = await window.api.reportBuild({ projectId, start, end, prevStart, prevEnd });
    if (!resp.sections || !resp.sections.length) {
      body.innerHTML = `<div class="state">Sem dados de mídia paga em ${monthLabel} para este cliente.${(resp.notes || []).length ? "<br><br>" + resp.notes.join("<br>") : "<br><br>Vincule a conta Meta/Google (Configurações) ou o projeto no Reportei."}</div>`;
      return;
    }
    ReportView.renderInto(body, resp.sections, { editable: true });
    state.repDoc = { cName, monthLabel, projectId, sections: resp.sections };
    $("#copyRelBtn").classList.remove("hidden"); $("#pdfRelBtn").classList.remove("hidden"); $("#saveHistRelBtn").classList.remove("hidden");
    if ((resp.notes || []).length) console.warn("[relatório]", resp.notes.join(" | "));
    // preenche a análise de cada seção (Gemini/Claude) — em paralelo
    resp.sections.forEach((sec) => fillReportAnalysis(sec, cName, monthLabel));
    return;
  } catch (e) {
    body.innerHTML = `<div class="state error"><div class="big">⚠️</div>${e.message}</div>`;
  }
}

// preenche o bloco de análise de UMA seção (Meta/Google/LinkedIn) com o texto da IA
async function fillReportAnalysis(sec, cName, monthLabel) {
  const sel = (b) => document.querySelector(`#repBody [data-analysis="${sec.platform}-${b}"]`);
  const geral = sel("geral"), publicos = sel("publicos"), anuncios = sel("anuncios"), proximos = sel("proximos");
  if (!geral && !publicos && !anuncios && !proximos) return;
  const dropBox = (el) => { if (el) (el.closest(".rr-nextsteps") || el).remove(); };
  try {
    const raw = sec.raw || {};
    const pick = (arr) => (arr || []).map((a) => ({ name: a.name, ctr: a.ctr, results: a.results, cpr: a.cpr, spend: a.spend }));
    const txt = await window.api.reportAnalyze({
      clientName: cName, monthLabel, label: sec.label,
      kpis: (sec.kpis || []).map((k) => ({ label: k.label, value: k.value, prev: k.prev, kind: k.kind })),
      adsets: pick(raw.adsets), ads: pick(raw.ads), quali: sec.quali || null,
    });
    const points = parseAnalysisPoints(txt);
    const B = { geral: [], publicos: [], anuncios: [], proximos: [] };
    points.forEach((pt) => { const t = pt.title.toLowerCase(); if (/pr[óo]xim/.test(t)) B.proximos.push(pt); else if (/p[úu]blico/.test(t)) B.publicos.push(pt); else if (/an[úu]ncio/.test(t)) B.anuncios.push(pt); else B.geral.push(pt); });
    // se não veio nenhum título de nível, joga tudo no geral
    const geralArr = (B.geral.length || B.publicos.length || B.anuncios.length || B.proximos.length) ? B.geral : points;
    const put = (el, arr) => { if (!el) return; if (arr.length) { el.innerHTML = pointsToHtml(arr); el.contentEditable = "true"; } else el.remove(); };
    put(geral, geralArr); put(publicos, B.publicos); put(anuncios, B.anuncios);
    // próximos passos: só o parágrafo (o título já vem do bloco), some a caixa se vazio
    if (proximos) { if (B.proximos.length) { proximos.innerHTML = pointsToHtml(B.proximos.map((p) => ({ title: "", body: p.body }))); proximos.contentEditable = "true"; } else dropBox(proximos); }
  } catch (e) {
    if (geral) {
      geral.innerHTML = `<span class="rr-ph">⚠️ ${e.message} — <a href="#" class="rep-retry-an">tentar de novo</a></span>`;
      const a = geral.querySelector(".rep-retry-an");
      if (a) a.addEventListener("click", (ev) => { ev.preventDefault(); geral.innerHTML = '<span class="rr-ph">⏳ gerando análise…</span>'; fillReportAnalysis(sec, cName, monthLabel); });
    }
    [publicos, anuncios].forEach((el) => el && el.remove());
    dropBox(proximos);
  }
}

// texto "## Título\nparágrafo" → lista de pontos {title, body}
function parseAnalysisPoints(txt) {
  const s = String(txt || "").replace(/\r/g, "").replace(/\*\*/g, "").trim();
  if (!s) return [];
  const out = [];
  s.split(/\n(?=\s*##\s)/).forEach((p) => {
    const m = p.match(/^\s*##\s*(.+?)\r?\n([\s\S]*)$/);
    if (m) out.push({ title: m[1].trim(), body: m[2].trim() });
    else { const t = p.replace(/^\s*##\s*/, "").trim(); if (t) out.push({ title: "", body: t }); }
  });
  return out;
}
function pointsToHtml(points) {
  const esc = (x) => String(x).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  return points.map((pt) => `${pt.title ? `<h4>${esc(pt.title)}</h4>` : ""}<p>${esc(pt.body).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, " ")}</p>`).join("");
}

// exportar o relatório visível em PDF nítido (A4)
$("#saveHistRelBtn").addEventListener("click", async () => {
  const doc = document.querySelector("#repBody .rr-page");
  const d = state.repDoc || {};
  if (!doc || !d.projectId) { toast("Gere o relatório primeiro.", true); return; }
  const btn = $("#saveHistRelBtn"), old = btn.textContent;
  btn.textContent = "💾 salvando…"; btn.disabled = true;
  try {
    // salva o HTML final (com análises e edições), mas SEM os controles de edição (ficariam inertes no histórico)
    const clone = doc.cloneNode(true);
    clone.querySelectorAll(".rr-kpi-x,.rr-addmetric-wrap,.rr-metricmenu,.rr-remove,.rr-clock").forEach((el) => el.remove());
    clone.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
    clone.querySelectorAll("[draggable]").forEach((el) => el.removeAttribute("draggable"));
    await window.api.historySave({
      projectId: d.projectId, clientName: d.cName, kind: "report",
      monthLabel: d.monthLabel, title: `Relatório ${d.monthLabel}`,
      html: `<div class="rr-page">${clone.innerHTML}</div>`,
    });
    toast(`Relatório de ${d.monthLabel} salvo no histórico do cliente.`);
  } catch (e) { toast("Erro ao salvar: " + e.message, true); }
  finally { btn.textContent = old; btn.disabled = false; }
});

$("#pdfRelBtn").addEventListener("click", async () => {
  const doc = document.querySelector("#repBody .rr-page");
  if (!doc) { toast("Gere o relatório primeiro.", true); return; }
  const d = state.repDoc || {};
  const btn = $("#pdfRelBtn"), old = btn.textContent;
  btn.textContent = "⏳ gerando PDF…"; btn.disabled = true;
  try {
    const r = await window.api.reportExportPdf({ html: `<div class="rr-page">${doc.innerHTML}</div>`, title: `${d.cName || "relatorio"} - ${d.monthLabel || ""}` });
    if (r && r.saved) toast("PDF salvo!");
  } catch (e) { toast("Erro ao gerar PDF: " + e.message, true); }
  finally { btn.textContent = old; btn.disabled = false; }
});

// ---- edição do relatório: remover plataforma, remover métrica, adicionar métrica ----
const geralOf = (sec) => sec.querySelector('[data-analysis$="-geral"]');
function stripMetricPoint(sec, label) {
  const g = geralOf(sec); if (!g) return;
  const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const L = norm(label);
  const h = [...g.children].find((el) => el.tagName === "H4" && (() => { const t = norm(el.textContent); return t === L || t.includes(L) || L.includes(t); })());
  if (!h) return;
  const rm = [h]; let n = h.nextElementSibling;
  while (n && n.tagName !== "H4") { rm.push(n); n = n.nextElementSibling; }
  rm.forEach((el) => el.remove());
}
function appendPoint(g, title, body) {
  const h = document.createElement("h4"); h.textContent = title;
  const p = document.createElement("p"); p.textContent = body;
  g.appendChild(h); g.appendChild(p);
}
async function addMetricAnalysis(sec, secData, m) {
  const g = geralOf(sec); const d = state.repDoc || {};
  const ph = document.createElement("p"); ph.className = "rr-ph"; ph.textContent = "⏳ analisando " + m.label + "…";
  if (g) g.appendChild(ph);
  try {
    const txt = await window.api.reportAnalyzeMetric({ clientName: d.cName, monthLabel: d.monthLabel, platformLabel: secData ? secData.label : "", label: m.label, kind: m.kind, value: m.value, prev: m.prev });
    const pts = parseAnalysisPoints(txt);
    if (ph.parentNode) ph.remove();
    if (g) { if (pts.length) pts.forEach((pt) => appendPoint(g, pt.title || m.label, pt.body)); else appendPoint(g, m.label, String(txt).replace(/^\s*##\s*.*\n?/, "").trim()); }
  } catch (e) { ph.textContent = "⚠️ " + e.message; }
}
// arrastar métricas pra mudar a posição (igual o Reportei) — reordena dentro da mesma plataforma
let repDragEl = null;
$("#repBody").addEventListener("dragstart", (e) => {
  if (e.target.closest(".rr-kpi-x")) { e.preventDefault(); return; }
  const card = e.target.closest('.rr-kpi[draggable="true"]');
  if (!card) return;
  repDragEl = card; card.classList.add("rr-dragging");
  e.dataTransfer.effectAllowed = "move";
  try { e.dataTransfer.setData("text/plain", ""); } catch {}
});
$("#repBody").addEventListener("dragend", () => {
  if (repDragEl) repDragEl.classList.remove("rr-dragging");
  repDragEl = null;
});
$("#repBody").addEventListener("dragover", (e) => {
  if (!repDragEl) return;
  const grid = e.target.closest(".rr-kpis");
  if (!grid || grid.closest(".rr-section") !== repDragEl.closest(".rr-section")) return;
  e.preventDefault();
  const cards = [...grid.querySelectorAll(".rr-kpi:not(.rr-dragging)")];
  let best = null, bestD = Infinity;
  for (const el of cards) {
    const b = el.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    const d = Math.hypot(e.clientX - cx, e.clientY - cy);
    if (d < bestD) { bestD = d; best = { el, before: e.clientX < cx }; }
  }
  if (!best) grid.appendChild(repDragEl);
  else grid.insertBefore(repDragEl, best.before ? best.el : best.el.nextSibling);
  // ao entrar na linha de destaque (duo) o card assume o tamanho daquela linha
  repDragEl.classList.toggle("big", grid.classList.contains("duo"));
});
$("#repBody").addEventListener("drop", (e) => { if (repDragEl) e.preventDefault(); });

$("#repBody").addEventListener("click", (e) => {
  // remover plataforma inteira
  const rb = e.target.closest(".rr-remove");
  if (rb) {
    const sec = rb.closest(".rr-section"); if (!sec) return;
    sec.remove();
    const rest = document.querySelectorAll("#repBody .rr-section");
    if (!rest.length) { $("#pdfRelBtn").classList.add("hidden"); $("#copyRelBtn").classList.add("hidden"); const sh = $("#repSaveHistBtn"); if (sh) sh.classList.add("hidden"); }
    return;
  }
  // remover uma métrica (KPI ✕)
  const xb = e.target.closest(".rr-kpi-x");
  if (xb) {
    const card = xb.closest(".rr-kpi"); if (!card) return;
    const label = card.dataset.metric, sec = card.closest(".rr-section");
    card.remove();
    if (sec && label) stripMetricPoint(sec, label);
    return;
  }
  // abrir/fechar menu de adicionar métrica
  const ab = e.target.closest(".rr-addmetric");
  if (ab) {
    const sec = ab.closest(".rr-section");
    const existing = sec.querySelector(".rr-metricmenu");
    if (existing) { existing.remove(); return; }
    const secData = ((state.repDoc || {}).sections || []).find((s) => s.platform === ab.dataset.platform);
    const extra = (secData && secData.extraMetrics) || [];
    const shown = new Set([...sec.querySelectorAll(".rr-kpi")].map((k) => k.dataset.metric));
    const avail = extra.filter((m) => !shown.has(m.label));
    if (!avail.length) { toast("Sem métricas extras disponíveis pra esta plataforma.", true); return; }
    const menu = document.createElement("div"); menu.className = "rr-metricmenu";
    menu.innerHTML = avail.map((m, i) => `<button type="button" data-mi="${i}">➕ ${m.label}</button>`).join("");
    menu._avail = avail;
    ab.parentElement.after(menu);
    return;
  }
  // escolher uma métrica do menu
  const mb = e.target.closest(".rr-metricmenu button");
  if (mb) {
    const menu = mb.closest(".rr-metricmenu"), sec = menu.closest(".rr-section");
    const platform = (sec.querySelector(".rr-addmetric") || {}).dataset ? sec.querySelector(".rr-addmetric").dataset.platform : null;
    const secData = ((state.repDoc || {}).sections || []).find((s) => s.platform === platform);
    const m = (menu._avail || [])[+mb.dataset.mi];
    menu.remove();
    if (!m) return;
    const grid = sec.querySelector(".rr-kpis");
    if (grid) { const tmp = document.createElement("div"); tmp.innerHTML = ReportView.kpiCardHtml(m, true); const card = tmp.firstElementChild; grid.appendChild(card); }
    addMetricAnalysis(sec, secData, m);
    return;
  }
});

// gera (ou regenera) a análise de UMA plataforma e preenche as 3 caixas
async function genRepPlatform(i) {
  const ctx = state.repCtx; if (!ctx) return;
  const pr = ctx.platforms[i];
  const boxes = ["camp", "aud", "ad"].map((lv) => $(`#repAn-${i}-${lv}`));
  boxes.forEach((el) => { if (el) el.textContent = "⏳ análise…"; });
  try {
    const txt = await window.api.geminiReportPlatform({ clientName: ctx.cName, monthLabel: ctx.monthLabel, pr: { platform: pr.platform, totals: pr.totals, rows: pr.rows.map((r) => ({ level: r.level, name: r.name, metrics: r.metrics })) }, prevTotals: ctx.prevMap[pr.platform] || {}, benchmarks: ctx.benchmarks });
    const sec = splitSections(txt, ["CAMPANHAS", "PUBLICOS", "ANUNCIOS"]);
    if (!sec[0] && !sec[1] && !sec[2]) sec[0] = txt.trim(); // veio sem marcadores → tudo na 1ª
    ["camp", "aud", "ad"].forEach((lv, k) => {
      const el = $(`#repAn-${i}-${lv}`); if (!el) return;
      if (sec[k]) { el.textContent = sec[k]; el.contentEditable = "true"; }
      else el.innerHTML = `<button class="chip-btn rep-retry" data-i="${i}">🔄 gerar esta análise novamente</button>`;
    });
  } catch (e) {
    boxes.forEach((el) => { if (el) el.innerHTML = `⚠️ ${e.message} <button class="chip-btn rep-retry" data-i="${i}" style="margin-left:8px">🔄 tentar de novo</button>`; });
  }
  bindRepRetry();
}

async function genRepFinal() {
  const ctx = state.repCtx; if (!ctx) return;
  const el = $("#repFinal"); if (!el) return;
  el.textContent = "⏳ gerando…";
  try {
    const fin = await window.api.geminiReportFinal({ clientName: ctx.cName, monthLabel: ctx.monthLabel, platformResults: ctx.platforms.map((p) => ({ platform: p.platform, totals: p.totals })), leads: ctx.leads, cplIdeal: ctx.cplIdeal });
    const fsec = splitSections(fin, ["QUALIFICACAO", "PROXIMOS"]);
    el.textContent = (fsec[0] || fsec[1]) ? `Qualificação de Leads\n${fsec[0] || ""}\n\nPróximos Passos\n${fsec[1] || ""}`.trim() : fin.trim();
    el.contentEditable = "true";
  } catch (e) {
    el.innerHTML = `⚠️ ${e.message} <button class="chip-btn rep-retry" data-i="final" style="margin-left:8px">🔄 tentar de novo</button>`;
    bindRepRetry();
  }
}

function bindRepRetry() {
  $$(".rep-retry").forEach((b) => {
    if (b._bound) return; b._bound = true;
    b.addEventListener("click", () => { b.dataset.i === "final" ? genRepFinal() : genRepPlatform(+b.dataset.i); });
  });
}

// divide o texto do Gemini pelos marcadores ===NOME===
function splitSections(text, names) {
  const idx = names.map((n) => { const m = text.match(new RegExp(`===\\s*${n}\\s*===`)); return m ? m.index : -1; });
  return names.map((n, i) => {
    if (idx[i] < 0) return "";
    const start = text.indexOf("\n", idx[i]) + 1 || idx[i];
    const nexts = idx.slice(i + 1).filter((x) => x >= 0);
    const end = nexts.length ? Math.min(...nexts) : text.length;
    return text.slice(start, end).trim();
  });
}

// bloco de plataforma do relatório: KPIs c/ delta + tabelas fiéis (campanha/público/anúncio) + análise embaixo de cada
function repPlatformHtml(pr, prev, repC, i) {
  const plat = E.PLATFORMS[pr.platform];
  const bench = (repC.benchmarks || {})[pr.platform] || {};
  const camp = pr.rows.filter((r) => r.level === "campaign"), aud = pr.rows.filter((r) => r.level === "audience"), ads = pr.rows.filter((r) => r.level === "ad");
  const mkRows = (rows) => rows.map((r) => { const { cells } = plat.derive(r.metrics, bench); return `<tr><td>${r.name}</td>${cells.map(cellHtml).join("")}</tr>`; }).join("");
  const table = (rows, label, anId) => rows.length
    ? `<div class="rep-lvl">${label}</div><div class="table-wrap"><table><thead><tr><th>${label}</th>${plat.cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${mkRows(rows)}</tbody></table></div><div class="analysis-box rep-an" id="${anId}">⏳ análise…</div>`
    : "";
  const adTable = ads.length
    ? `<div class="rep-lvl">Anúncios</div><div class="table-wrap"><table><thead><tr><th>Anúncio</th><th>Impressões</th><th>Cliques</th><th>CTR</th><th>Leads</th><th>Investido</th></tr></thead><tbody>${ads.map((r) => { const m = r.metrics; return `<tr><td>${r.name}</td><td>${E.fmt.n(m.impressions)}</td><td>${E.fmt.n(m.clicks)}</td><td>${m.ctr != null ? E.fmt.pct(m.ctr) : "—"}</td><td>${E.fmt.n(m.leads)}</td><td>${E.fmt.brl(m.spend)}</td></tr>`; }).join("")}</tbody></table></div><div class="analysis-box rep-an" id="repAn-${i}-ad">⏳ análise…</div>`
    : `<div class="rep-lvl">Anúncios</div><div class="analysis-box rep-an" id="repAn-${i}-ad">⏳ análise…</div>`;
  const t = pr.totals || {}, pv = prev || {};
  const dl = (c, p) => (c != null && p) ? (c - p) / p * 100 : null;
  const kb = (lbl, c, p, fmt) => { const d = dl(c, p); return `<div class="kpi"><div class="k-label">${lbl}</div><div class="k-val" style="font-size:20px">${fmt(c)}</div><div class="k-sub">${d == null ? "—" : (d >= 0 ? "+" : "") + d.toFixed(1) + "% vs mês ant."}</div></div>`; };
  const inv = (t.spend || 0) + (t.cost || 0) || null, pinv = (pv.spend || 0) + (pv.cost || 0) || null;
  const lds = (t.leads || 0) + (t.conversions || 0) || null, plds = (pv.leads || 0) + (pv.conversions || 0) || null;
  const kpis = `<div class="kpis" style="grid-template-columns:repeat(4,1fr)">
    ${kb("Investimento", inv, pinv, E.fmt.brl)}
    ${kb(t.sends != null ? "Envios" : "Impressões", t.sends != null ? t.sends : t.impressions, t.sends != null ? pv.sends : pv.impressions, E.fmt.n)}
    ${kb("Leads", lds, plds, E.fmt.n)}
    ${kb("CPL", inv && lds ? inv / lds : null, pinv && plds ? pinv / plds : null, E.fmt.brl)}
  </div>`;
  return `<div class="platform" style="margin-bottom:22px">
    <div class="p-head"><div class="p-badge ${plat.key}">${plat.short.slice(0, 2).toUpperCase()}</div><h3>${plat.label}</h3><span class="p-meta">· ${plat.tag}</span></div>
    <div style="padding:14px 18px">${kpis}
      ${table(camp, "Campanhas", `repAn-${i}-camp`)}
      ${table(aud, "Públicos", `repAn-${i}-aud`)}
      ${adTable}
    </div></div>`;
}
$("#copyRelBtn").addEventListener("click", async () => {
  const d = state.repDoc; const doc = document.querySelector("#repBody .rr-page");
  if (!doc) { toast("Gere o relatório primeiro.", true); return; }
  let out = d ? `${d.cName} · Relatório de ${d.monthLabel}\n` : "";
  doc.querySelectorAll(".rr-section").forEach((sec) => {
    const h = sec.querySelector(".rr-head-txt h2"); if (h) out += `\n========== ${h.textContent.trim()} ==========\n`;
    const an = sec.querySelector(".rr-analysis"); if (an && an.textContent.trim() && !an.querySelector(".rr-ph")) out += `\n${an.textContent.trim()}\n`;
  });
  try { await navigator.clipboard.writeText(out); toast("Análises copiadas!"); }
  catch { toast("Não consegui copiar — selecione e copie manualmente.", true); }
});

/* ============================================================
   HISTÓRICO
   ============================================================ */
$("#histClientSel").addEventListener("change", renderHistory);
async function renderHistory() {
  const body = $("#histBody");
  const projectId = Number($("#histClientSel").value);
  if (!projectId) { body.innerHTML = '<div class="state">Adicione clientes em Configurações.</div>'; return; }
  const list = await window.api.historyList(projectId);
  const actions = await window.api.listActions(projectId);
  if (!list.length && !actions.length) { body.innerHTML = '<div class="state"><div class="big">🗂️</div>Nenhuma semana salva nem ação registrada ainda para este cliente.</div>'; return; }
  const reports = list.filter((h) => h.kind === "report").sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  const weeks = list.filter((h) => h.kind !== "report").sort((a, b) => (a.start < b.start ? 1 : -1));
  const reportsHtml = reports.length ? `<div class="section-title">📄 Relatórios salvos</div><div class="hist-list">` + reports.map((h) => `
    <div class="hist-item" data-id="${h.id}" data-kind="report">
      <div style="flex:1"><div class="hist-week">${h.title || ("Relatório " + (h.monthLabel || ""))}</div>
        <div class="hist-meta">salvo em ${new Date(h.savedAt).toLocaleDateString("pt-BR")}</div></div>
      <button class="chip-btn hist-del" data-id="${h.id}" title="Excluir do histórico">🗑️</button>
    </div>`).join("") + "</div>" : "";
  const actHtml = actions.length ? `<div class="section-title">🛠️ Ações de otimização (na conta de anúncio)</div>`
    + actions.map((a, ai) => `<div class="hist-item" style="cursor:default">
        <div style="flex:1"><div class="hist-week">${a.type === "negativacao" ? "🚫" : a.type === "keyword" ? "➕" : a.type === "toggle" ? "⚙️" : a.type === "creative" ? "🎨" : a.type === "ekyte" ? "📋" : "•"} ${a.summary}</div>
          <div class="hist-meta">${new Date(a.at).toLocaleString("pt-BR")}${a.detail ? " · " + (a.detail.length > 120 ? a.detail.slice(0, 120) + "…" : a.detail) : ""}</div></div>
        ${(a.type === "negativacao" || a.type === "keyword") ? `<button class="chip-btn act-trello" data-ai="${ai}">📋 Enviar pro Trello</button>` : ""}
      </div>`).join("") : "";
  state._actions = actions;
  const weeksHtml = weeks.length ? `<div class="section-title">📅 Semanas analisadas</div><div class="hist-list">` + weeks.map((h) => `
    <div class="hist-item" data-id="${h.id}">
      <div style="flex:1"><div class="hist-week">Período ${h.weekLabel}</div>
        <div class="hist-meta">${h.itemsCount} otimizações · salvo em ${new Date(h.savedAt).toLocaleDateString("pt-BR")}</div></div>
      ${h.trello?.optCardUrl ? '<span class="hist-pill">Trello ✓</span>' : ""}
    </div>`).join("") + "</div>" : "";
  body.innerHTML = reportsHtml + actHtml + weeksHtml + "<div id=\"histDetail\"></div>";
  $$(".hist-item[data-id]").forEach((el) => el.addEventListener("click", (ev) => { if (ev.target.closest(".hist-del")) return; openHistory(el.dataset.id); }));
  $$(".hist-del").forEach((b) => b.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    if (!window.confirm("Excluir este relatório do histórico?")) return;
    await window.api.historyDelete(b.dataset.id);
    renderHistory();
  }));
  $$(".act-trello").forEach((b) => b.addEventListener("click", async () => {
    const a = (state._actions || [])[+b.dataset.ai]; if (!a) return;
    const c = state.clients.find((x) => x.projectId === a.projectId);
    if (!c || !c.trelloBoardId) { toast("Vincule o board do Trello deste cliente em Configurações.", true); return; }
    const terms = String(a.detail || "").split(",").map((t) => t.trim()).filter(Boolean);
    if (!terms.length) { toast("Sem termos nesta ação.", true); return; }
    b.disabled = true; b.textContent = "Enviando…";
    const dia = new Date(a.at).toLocaleDateString("pt-BR");
    const isKw = a.type === "keyword";
    try {
      const r = await window.api.trelloDoneCard({
        boardId: c.trelloBoardId,
        title: isKw ? `Palavras-chave adicionadas — ${dia}` : `Termos negativados — ${dia}`,
        desc: isKw ? `${terms.length} palavra(s)-chave adicionada(s) no Google Ads.` : `${terms.length} termo(s) negativado(s) no Google Ads.`,
        checklistName: isKw ? "Palavras-chave adicionadas" : "Termos negativados",
        items: terms,
      });
      b.textContent = "✓ no Trello";
      toast("Card criado em 'O que foi feito'!");
      if (r.url) setTimeout(() => window.api.openExternal(r.url), 400);
    } catch (e) { b.disabled = false; b.textContent = "📋 Enviar pro Trello"; toast("Trello: " + e.message, true); }
  }));
}

async function openHistory(id) {
  const h = await window.api.historyGet(id);
  if (!h) return;
  const det = $("#histDetail");
  if (h.kind === "report") {
    det.innerHTML = `<div class="section-title">${h.title || ("Relatório " + (h.monthLabel || ""))}</div>
      <div style="display:flex;gap:8px;margin-bottom:12px"><button class="chip-btn" id="histRepPdf">📄 Exportar PDF</button></div>
      <div class="rr-doc" style="border:1px solid var(--line);border-radius:12px;overflow:hidden">${h.html || "<i>sem conteúdo</i>"}</div>`;
    const pb = $("#histRepPdf");
    if (pb) pb.addEventListener("click", async () => {
      pb.disabled = true; const o = pb.textContent; pb.textContent = "⏳ gerando…";
      try { const r = await window.api.reportExportPdf({ html: h.html, title: `${h.clientName || "relatorio"} - ${h.monthLabel || ""}` }); if (r && r.saved) toast("PDF salvo!"); }
      catch (e) { toast("Erro no PDF: " + e.message, true); }
      finally { pb.disabled = false; pb.textContent = o; }
    });
    det.scrollIntoView({ behavior: "smooth" });
    return;
  }
  const checklist = (h.items || []).map((it) => `<div class="tp-item"><div>${it.text}</div></div>`).join("");
  det.innerHTML = `<div class="section-title">Semana de ${h.weekLabel}</div>
    <div class="card"><div class="tp-check">✅ Otimizações enviadas (${(h.items || []).length})</div>${checklist || "<i>sem itens</i>"}
      ${h.trello?.optCardUrl ? `<div style="margin-top:12px"><a href="#" id="lnkOpt" class="chip-btn">abrir card de otimizações no Trello</a></div>` : ""}
    </div>
    ${h.analysisText ? `<div class="section-title">🤖 Análise da semana</div><div class="analysis-box md">${mdToHtml(h.analysisText)}</div>` : ""}`;
  const lnk = $("#lnkOpt"); if (lnk) lnk.addEventListener("click", (e) => { e.preventDefault(); window.api.openExternal(h.trello.optCardUrl); });
  det.scrollIntoView({ behavior: "smooth" });
}

/* ============================================================
   GTM CONNECT — botão na config
   ============================================================ */
$("#gtmConnectBtn").addEventListener("click", async () => {
  const m = $("#gtmConnMsg"); m.textContent = "Aguardando autorização…";
  try {
    await window.api.gtmConnect({});
    m.textContent = "✅ GTM conectado!";
    toast("Google Tag Manager conectado com sucesso.");
  } catch (e) { m.textContent = "❌ " + e.message; }
});

/* ============================================================
   META ADS — SESSÃO
   ============================================================ */
let metaSessPeriod = 7;     // número de dias OU "custom"
let metaAccounts = [];
let metaOnlyActive = false; // filtro "só ativos"

async function initMetaSession() {
  if (metaAccounts.length) return; // já carregou
  await loadMetaAccounts();
}

async function loadMetaAccounts() {
  const sel = $("#metaAccSel");
  sel.innerHTML = '<option value="">Carregando…</option>';
  try {
    metaAccounts = await window.api.metaAdAccounts();
    sel.innerHTML = '<option value="">— selecione —</option>';
    // adiciona contas configuradas nos clientes primeiro
    state.clients.forEach((c) => {
      const aid = c.adAccounts && c.adAccounts.meta;
      if (!aid) return;
      const found = metaAccounts.find((a) => a.id === aid || a.accountId === aid || a.id === "act_" + aid);
      const label = found ? found.name : c.name;
      const opt = new Option(`${label} (${c.name})`, found ? found.id : "act_" + aid);
      sel.add(opt);
    });
    // depois as demais (da API, não vinculadas a cliente local)
    const linkedIds = new Set(state.clients.map((c) => c.adAccounts && ("act_" + (c.adAccounts.meta || ""))).filter(Boolean));
    metaAccounts.filter((a) => !linkedIds.has(a.id)).forEach((a) => sel.add(new Option(`${a.name} (${a.accountId})`, a.id)));
  } catch (e) {
    sel.innerHTML = '<option value="">— erro ao carregar —</option>';
    toast("Meta: " + e.message, true);
  }
}

$("#metaAccRefresh").addEventListener("click", async () => { metaAccounts = []; await loadMetaAccounts(); });

$$(".sess-period").forEach((b) => b.addEventListener("click", () => {
  $$(".sess-period, .sess-period-custom").forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
  metaSessPeriod = Number(b.dataset.days);
  $("#metaCustomRange").classList.add("hidden");
}));
$("#metaCustomToggle").addEventListener("click", () => {
  $$(".sess-period, .sess-period-custom").forEach((x) => x.classList.remove("active"));
  $("#metaCustomToggle").classList.add("active");
  metaSessPeriod = "custom";
  const box = $("#metaCustomRange");
  box.classList.remove("hidden");
  // pré-preenche com os últimos 7 dias se vazio
  if (!$("#metaStart").value) { const d = sessDates(7); $("#metaStart").value = d.start; $("#metaEnd").value = d.end; }
});

$("#metaOnlyActive").addEventListener("change", (e) => {
  metaOnlyActive = e.target.checked;
  if ($("#metaAccSel").value) loadMetaCampaigns();
});
$("#metaLoadBtn").addEventListener("click", loadMetaCampaigns);
async function loadMetaCampaigns() {
  const accountId = $("#metaAccSel").value;
  if (!accountId) { toast("Selecione uma conta Meta.", true); return; }
  let start, end;
  if (metaSessPeriod === "custom") {
    start = $("#metaStart").value; end = $("#metaEnd").value;
    if (!start || !end) { toast("Escolha as datas de início e fim.", true); return; }
    if (start > end) { toast("A data inicial não pode ser depois da final.", true); return; }
  } else {
    ({ start, end } = sessDates(metaSessPeriod));
  }
  const body = $("#metaCampBody");
  body.innerHTML = '<div class="state">⏳ Carregando campanhas…</div>';
  try {
    let camps = await window.api.metaCampaigns({ accountId, start, end });
    if (metaOnlyActive) camps = camps.filter((c) => c.status === "ACTIVE");
    renderMetaCampaigns(camps, accountId, start, end);
    // métricas totais
    const totals = camps.reduce((t, c) => { t.spend += c.spend; t.leads += c.leads; t.clicks += c.clicks; t.impressions += c.impressions; return t; }, { spend: 0, leads: 0, clicks: 0, impressions: 0 });
    $("#mGasto").textContent = "R$ " + totals.spend.toFixed(2);
    $("#mLeads").textContent = totals.leads;
    $("#mCpl").textContent = totals.leads ? "R$ " + (totals.spend / totals.leads).toFixed(2) : "—";
    $("#mClicks").textContent = totals.clicks.toLocaleString("pt-BR");
    $("#mImpr").textContent = totals.impressions.toLocaleString("pt-BR");
    $("#metaSessMetrics").classList.remove("hidden");
  } catch (e) { body.innerHTML = `<div class="state error">❌ ${e.message}</div>`; }
}

function sessDates(days) {
  const end = new Date(); end.setDate(end.getDate() - 1);
  const start = new Date(end); start.setDate(start.getDate() - (days - 1));
  return { start: iso(start), end: iso(end) };
}

function metaStatusBadge(status) {
  const map = { ACTIVE: ["✅", "Ativa"], PAUSED: ["⏸️", "Pausada"], ARCHIVED: ["🗄️", "Arquivada"], DELETED: ["🗑️", "Removida"] };
  const [ic, lb] = map[status] || ["❓", status];
  return `<span class="sess-badge ${status === "ACTIVE" ? "active" : "paused"}">${ic} ${lb}</span>`;
}

function renderMetaCampaigns(camps, accountId, start, end) {
  const body = $("#metaCampBody");
  if (!camps.length) { body.innerHTML = '<div class="state">Nenhuma campanha encontrada.</div>'; return; }
  const html = camps.map((c) => {
    const budget = c.dailyBudget ? `R$ ${c.dailyBudget.toFixed(2)}/dia` : c.lifetimeBudget ? `R$ ${c.lifetimeBudget.toFixed(2)} total` : "—";
    return `<div class="sess-row" data-id="${c.id}" data-status="${c.status}">
      <div class="sess-row-main">
        <div class="sess-row-name">${c.name}</div>
        <div class="sess-row-meta">${metaStatusBadge(c.status)} · ${budget} · ${c.objective || ""}</div>
      </div>
      <div class="sess-row-metrics">
        <span title="Gasto">💰 R$ ${c.spend.toFixed(2)}</span>
        <span title="Leads">🎯 ${c.leads} leads</span>
        <span title="CPL">${c.cpl ? "R$ " + c.cpl.toFixed(2) + " CPL" : "—"}</span>
        <span title="Cliques">🖱️ ${c.clicks.toLocaleString("pt-BR")}</span>
      </div>
      <div class="sess-row-actions">
        <button class="chip-btn meta-toggle" data-id="${c.id}" data-status="${c.status}" data-acc="${accountId}">
          ${c.status === "ACTIVE" ? "Pausar" : "Ativar"}
        </button>
        <button class="chip-btn meta-expand" data-id="${c.id}" data-acc="${accountId}" data-start="${start}" data-end="${end}">Ver públicos ▾</button>
      </div>
      <div class="sess-expand" id="adsets-${c.id}"></div>
    </div>`;
  }).join("");
  body.innerHTML = html;

  // toggle de status
  $$(".meta-toggle", body).forEach((btn) => btn.addEventListener("click", async () => {
    const id = btn.dataset.id; const cur = btn.dataset.status;
    const next = cur === "ACTIVE" ? "PAUSED" : "ACTIVE";
    btn.disabled = true; btn.textContent = "…";
    try {
      await window.api.metaToggleCampaign({ campaignId: id, status: next });
      btn.dataset.status = next;
      btn.closest(".sess-row").dataset.status = next;
      btn.closest(".sess-row").querySelector(".sess-row-meta").innerHTML = metaStatusBadge(next) + btn.closest(".sess-row").querySelector(".sess-row-meta").innerHTML.replace(/<span class="sess-badge[^<]*<\/span> · /, " · ");
      btn.textContent = next === "ACTIVE" ? "Pausar" : "Ativar";
      toast(`Campanha ${next === "ACTIVE" ? "ativada" : "pausada"}.`);
      const campName = btn.closest(".sess-row").querySelector(".sess-row-name").textContent.trim();
      const cli = clientByMeta(accountId);
      if (cli) try { await window.api.logAction({ projectId: cli.projectId, clientName: cli.name, type: "toggle", summary: `${next === "ACTIVE" ? "▶️ Ativou" : "⏸️ Pausou"} campanha "${campName}" no Meta Ads` }); } catch {}
    } catch (e) { toast("Erro: " + e.message, true); btn.disabled = false; btn.textContent = cur === "ACTIVE" ? "Pausar" : "Ativar"; }
  }));

  // expandir adsets
  $$(".meta-expand", body).forEach((btn) => btn.addEventListener("click", async () => {
    const id = btn.dataset.id; const box = $("#adsets-" + id);
    if (box.dataset.loaded) { box.classList.toggle("hidden"); btn.textContent = box.classList.contains("hidden") ? "Ver públicos ▾" : "Ocultar ▴"; return; }
    btn.disabled = true; btn.textContent = "Carregando…";
    try {
      let sets = await window.api.metaAdSets({ accountId: btn.dataset.acc, campaignId: id, start: btn.dataset.start, end: btn.dataset.end });
      if (metaOnlyActive) sets = sets.filter((a) => a.status === "ACTIVE");
      box.dataset.loaded = "1";
      box.innerHTML = sets.length ? sets.map((a) => `
        <div class="sess-sub-row">
          <div class="sess-row-name">${a.name}</div>
          <div class="sess-row-meta">${metaStatusBadge(a.status)} · ${a.dailyBudget ? "R$ " + a.dailyBudget.toFixed(2) + "/dia" : "—"}</div>
          <div class="sess-row-metrics">
            <span>💰 R$ ${a.spend.toFixed(2)}</span><span>🎯 ${a.leads}</span>${a.cpl ? `<span>R$ ${a.cpl.toFixed(2)} CPL</span>` : ""}
          </div>
          <div style="display:flex;gap:6px">
            <button class="chip-btn adset-creatives" data-id="${a.id}" data-acc="${btn.dataset.acc}" data-start="${btn.dataset.start}" data-end="${btn.dataset.end}">🖼️ Criativos</button>
            <button class="chip-btn adset-toggle" data-id="${a.id}" data-status="${a.status}">
              ${a.status === "ACTIVE" ? "Pausar" : "Ativar"}
            </button>
          </div>
          <div class="sess-expand" id="creatives-${a.id}"></div>
        </div>`).join("") : '<div class="sub">Nenhum conjunto neste período.</div>';
      $$(".adset-toggle", box).forEach((tb) => tb.addEventListener("click", async () => {
        const cur = tb.dataset.status; const next = cur === "ACTIVE" ? "PAUSED" : "ACTIVE";
        tb.disabled = true; tb.textContent = "…";
        try {
          await window.api.metaToggleAdSet({ adSetId: tb.dataset.id, status: next });
          tb.dataset.status = next; tb.textContent = next === "ACTIVE" ? "Pausar" : "Ativar";
          toast(`Conjunto ${next === "ACTIVE" ? "ativado" : "pausado"}.`);
          const setName = tb.closest(".sess-sub-row").querySelector(".sess-row-name").textContent.trim();
          const cli = clientByMeta(btn.dataset.acc);
          if (cli) try { await window.api.logAction({ projectId: cli.projectId, clientName: cli.name, type: "toggle", summary: `${next === "ACTIVE" ? "▶️ Ativou" : "⏸️ Pausou"} conjunto "${setName}" no Meta Ads` }); } catch {}
        } catch (e) { toast("Erro: " + e.message, true); tb.disabled = false; }
      }));
      $$(".adset-creatives", box).forEach((cb) => cb.addEventListener("click", () => loadMetaCreatives(cb)));
      btn.textContent = "Ocultar ▴";
    } catch (e) { toast(e.message, true); btn.textContent = "Ver públicos ▾"; }
    btn.disabled = false;
  }));
}

// carrega os criativos (anúncios) de um conjunto, com miniatura + pausar
async function loadMetaCreatives(cb) {
  const adSetId = cb.dataset.id; const box = $("#creatives-" + adSetId);
  if (box.dataset.loaded) { box.classList.toggle("hidden"); cb.textContent = box.classList.contains("hidden") ? "🖼️ Criativos" : "🖼️ Ocultar"; return; }
  cb.disabled = true; cb.textContent = "Carregando…";
  try {
    let ads = await window.api.metaAds({ accountId: cb.dataset.acc, adSetId, start: cb.dataset.start, end: cb.dataset.end });
    if (metaOnlyActive) ads = ads.filter((ad) => ad.status === "ACTIVE");
    box.dataset.loaded = "1";
    if (!ads.length) { box.innerHTML = '<div class="sub">Nenhum anúncio neste período.</div>'; }
    else {
      box.innerHTML = `<div class="creative-bar" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
          <label style="font-size:12px;display:flex;align-items:center;gap:5px;cursor:pointer"><input type="checkbox" class="creative-selectall"> Selecionar todos</label>
          <button class="btn btn-primary creative-send-trello" style="padding:6px 12px;font-size:12.5px">📤 Enviar selecionados pro Trello</button>
          <span class="creative-send-msg" style="font-size:12px;color:var(--muted)"></span>
        </div>
        <div class="creative-grid">${ads.map((ad) => `
        <div class="creative-card">
          <div class="creative-thumb">
            ${ad.thumbnail
              ? `<img class="meta-creative-img" src="${ad.thumbnail}" alt="" loading="lazy">`
              : `<span style="font-size:32px;display:block;text-align:center;line-height:90px">${ad.isVideo ? "🎬" : "🖼️"}</span>`}
          </div>
          <div class="creative-info">
            <div class="creative-top" style="display:flex;align-items:center;gap:8px">${metaStatusBadge(ad.status)}<label style="margin-left:auto;font-size:11px;display:flex;align-items:center;gap:4px;cursor:pointer" title="Selecionar pro Trello"><input type="checkbox" class="creative-ck" data-id="${ad.id}"> Trello</label></div>
            <div class="creative-name" title="${ad.name}">${ad.name}</div>
            ${ad.isVideo ? '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">🎬 Vídeo</div>' : ""}
            <div class="creative-metrics">
              <div class="cm"><span class="cm-v">R$ ${ad.spend.toFixed(2)}</span><span class="cm-l">gasto</span></div>
              <div class="cm"><span class="cm-v">${ad.leads}</span><span class="cm-l">leads</span></div>
              <div class="cm"><span class="cm-v">${ad.cpl ? "R$ " + ad.cpl.toFixed(2) : "—"}</span><span class="cm-l">CPL</span></div>
            </div>
            <button class="chip-btn ad-toggle ${ad.status === "ACTIVE" ? "" : "is-paused"}" data-id="${ad.id}" data-status="${ad.status}">${ad.status === "ACTIVE" ? "⏸ Pausar" : "▶ Ativar"}</button>
          </div>
        </div>`).join("")}</div>`;
      // fallback em caso de imagem quebrada
      $$(".meta-creative-img", box).forEach((img) => { img.addEventListener("error", () => { img.parentNode.innerHTML = '<span style="font-size:32px;display:block;text-align:center;line-height:90px">🖼️</span>'; }); });
      // seleção + envio dos criativos pro Trello
      const selAll = $(".creative-selectall", box);
      if (selAll) selAll.addEventListener("change", () => $$(".creative-ck", box).forEach((ck) => { ck.checked = selAll.checked; }));
      const sendBtn = $(".creative-send-trello", box);
      if (sendBtn) sendBtn.addEventListener("click", () => {
        const week = sessionWeekFromRange(cb.dataset.start, cb.dataset.end);
        const cli = clientByMeta(cb.dataset.acc);
        const sel = $$(".creative-ck:checked", box).map((ck) => ads.find((a) => String(a.id) === ck.dataset.id)).filter(Boolean);
        const cards = sel.map((ad) => ({
          name: `🎨 ${ad.name}`,
          desc: [
            `Criativo do Meta Ads${ad.isVideo ? " (vídeo)" : ""}${cli ? " — " + cli.name : ""}`,
            `Período: ${week.label} · Status: ${ad.status === "ACTIVE" ? "Ativo" : ad.status}`,
            ``,
            `💰 Gasto: R$ ${ad.spend.toFixed(2)}`,
            `🎯 Leads: ${ad.leads}`,
            `📉 CPL: ${ad.cpl ? "R$ " + ad.cpl.toFixed(2) : "—"}`,
            `🖱️ Cliques: ${ad.clicks.toLocaleString("pt-BR")}`,
            `👁️ Impressões: ${ad.impressions.toLocaleString("pt-BR")}`,
            `📊 CTR: ${ad.ctr.toFixed(2)}%`,
          ].join("\n"),
          imageUrl: ad.thumbnail || null,
          filename: `criativo-${ad.id}.jpg`,
        }));
        pushCreativesToTrello({ client: cli, cards, platformLabel: "Meta Ads", btn: sendBtn, msgEl: $(".creative-send-msg", box) });
      });
      $$(".ad-toggle", box).forEach((tb) => tb.addEventListener("click", async () => {
        const cur = tb.dataset.status; const next = cur === "ACTIVE" ? "PAUSED" : "ACTIVE";
        tb.disabled = true; tb.textContent = "…";
        try {
          await window.api.metaToggleAd({ adId: tb.dataset.id, status: next });
          tb.dataset.status = next;
          tb.textContent = next === "ACTIVE" ? "⏸ Pausar" : "▶ Ativar";
          tb.classList.toggle("is-paused", next !== "ACTIVE");
          toast(`Anúncio ${next === "ACTIVE" ? "ativado" : "pausado"}.`);
          const adName = tb.closest(".creative-card").querySelector(".creative-name").textContent.trim();
          const cli = clientByMeta(cb.dataset.acc);
          if (cli) try { await window.api.logAction({ projectId: cli.projectId, clientName: cli.name, type: "toggle", summary: `${next === "ACTIVE" ? "▶️ Ativou" : "⏸️ Pausou"} anúncio "${adName}" no Meta Ads` }); } catch {}
        } catch (e) { toast("Erro: " + e.message, true); tb.disabled = false; }
      }));
    }
    cb.textContent = "🖼️ Ocultar";
  } catch (e) { toast(e.message, true); cb.textContent = "🖼️ Criativos"; }
  cb.disabled = false;
}

$("#metaNewCampBtn").addEventListener("click", () => {
  // redireciona para Subida → usuário cria via Funil Studio
  $$(".nav .tab").forEach((x) => x.classList.toggle("active", x.dataset.view === "funil"));
  ALL_VIEWS.forEach((v) => $("#view-" + v).classList.toggle("hidden", v !== "funil"));
  toast("Use o Funil Studio para criar e depois envie pelo botão Subida.");
});

/* ---------------- analisar semana de UMA plataforma, embutido na própria aba (Meta/Google) ---------------- */
// monta um objeto "semana" a partir de um intervalo de datas da sessão
function sessionWeekFromRange(start, end) {
  const fmtD = (d) => { const [y, mo, da] = d.split("-"); return `${da}/${mo}`; };
  return { start, end, monday: new Date(start + "T00:00:00"), label: `${fmtD(start)} a ${fmtD(end)}/${end.split("-")[0]}`, custom: true };
}
// datas do período atual de cada sessão (respeita 7/14/30 ou custom)
function metaSessRange() { return metaSessPeriod === "custom" ? { start: $("#metaStart").value, end: $("#metaEnd").value } : sessDates(metaSessPeriod); }
function gadsSessRange() { return gadsSessPeriod === "custom" ? { start: $("#gadsStart").value, end: $("#gadsEnd").value } : sessDates(gadsSessPeriod); }

// platform: "meta" | "google" — roda a análise SÓ daquela plataforma e mostra TUDO (gargalos, análise IA, envio
// pro Trello) dentro da própria aba de sessão, sem sair pro Painel da semana.
async function analyzeSessionPlatform(platform) {
  const isMeta = platform === "meta";
  const accountId = $(isMeta ? "#metaAccSel" : "#gadsAccSel").value;
  const box = $(isMeta ? "#metaAnalysisBox" : "#gadsAnalysisBox");
  if (!accountId) { toast("Selecione uma conta primeiro.", true); return; }
  const cli = isMeta ? clientByMeta(accountId) : clientByGoogle(accountId);
  if (!cli) { toast("Essa conta não está vinculada a um cliente do painel. Vincule em ⚙️ Configurações → contas para poder analisar e enviar pro Trello.", true); return; }
  const range = isMeta ? metaSessRange() : gadsSessRange();
  if (!range.start || !range.end) { toast("Escolha o período (datas) antes de analisar.", true); return; }
  if (range.start > range.end) { toast("A data inicial não pode ser depois da final.", true); return; }
  if (!cli.trelloBoardId) toast("⚠️ Esse cliente ainda não tem board do Trello vinculado — a análise roda, mas pra enviar vincule o board em Configurações.", true);

  // aponta o estado (cliente + semana) e monta a análise DENTRO da aba.
  // O cabeçalho fica fixo no box; o painel renderiza num sub-elemento (.inline-panel = PANEL_MOUNT),
  // assim as re-renderizações (edição de gargalo, PageSpeed) não apagam o título.
  $("#clientSel").value = cli.projectId;
  state.week = sessionWeekFromRange(range.start, range.end);
  box.classList.remove("hidden");
  box.innerHTML = `<div class="section-title" style="margin-top:0">🤖 Análise de ${E.PLATFORMS[platform].label} · ${cli.name} · ${state.week.label}</div>
    <div class="inline-panel"><div class="state"><div class="big">⏳</div>Puxando dados e diagnosticando…</div></div>`;
  const panelEl = $(".inline-panel", box);
  PANEL_MOUNT = panelEl;
  try {
    const ads = cli.adAccounts || {};
    const resp = await window.api.reporteiWeekData({
      projectId: reporteiIdOf(cli), start: state.week.start, end: state.week.end, includeAds: true,
      directMeta: ads.meta || null, directGoogle: ads.google || null, directGa4: ads.ga4PropertyId || null,
    });
    state.results = (resp.platforms || []).filter((p) => p.platform === platform);
    state.notes = resp.notes || []; state.ga4 = resp.ga4 || null; state.pagespeed = null; state.analysisText = ""; state.leads = null;
    try { if (cli.leads && cli.leads.sheetUrl) state.leads = await window.api.leadsSummary({ projectId: cli.projectId, start: state.week.start, end: state.week.end }); } catch {}
    if (PANEL_MOUNT !== panelEl) return; // usuário disparou outra análise enquanto carregava
    if (!state.results.length) { panelEl.innerHTML = `<div class="state">Sem dados de ${E.PLATFORMS[platform].label} neste período para este cliente.${(state.notes || []).length ? "<br>" + state.notes.join("<br>") : ""}</div>`; return; }
    renderPainel();
    if (ads.site && state.settings.pageSpeedKey) {
      window.api.pageSpeedCheck({ url: ads.site, strategy: "MOBILE" })
        .then((ps) => { if (PANEL_MOUNT !== panelEl) return; state.pagespeed = ps; state.results.forEach((pr) => { pr._leadGargalos = null; }); renderPainel(); })
        .catch(() => {});
    }
  } catch (e) {
    if (PANEL_MOUNT === panelEl) panelEl.innerHTML = `<div class="state error"><div class="big">⚠️</div>${e.message}</div>`;
  }
}
$("#metaAnalyzeBtn").addEventListener("click", () => analyzeSessionPlatform("meta"));

// envia uma lista de criativos (já formatados) como cards na "Demandas da Semana" do board do cliente
async function pushCreativesToTrello({ client, cards, platformLabel, btn, msgEl }) {
  if (!client) { toast("Conta não vinculada a um cliente — vincule em ⚙️ Configurações → contas.", true); return; }
  if (!client.trelloBoardId) { toast("Vincule o board do Trello deste cliente em Configurações.", true); return; }
  if (!cards.length) { toast("Marque ao menos um criativo.", true); return; }
  if (!window.confirm(`Enviar ${cards.length} criativo(s) como card(s) separado(s) na lista "Demandas da Semana" do board de ${client.name}?`)) return;
  if (btn) { btn.disabled = true; btn.textContent = "Enviando…"; }
  if (msgEl) msgEl.textContent = "⏳ baixando imagens e criando cards…";
  try {
    const res = await window.api.trelloSendCreatives({ boardId: client.trelloBoardId, cards });
    toast(`✅ ${res.created} criativo(s) enviado(s) pro Trello!`);
    if (msgEl) msgEl.textContent = `✅ ${res.created} card(s) criado(s) em Demandas da Semana`;
    try { await window.api.logAction({ projectId: client.projectId, clientName: client.name, type: "creative", summary: `${res.created} criativo(s) de ${platformLabel} enviado(s) pro Trello (Demandas da Semana)`, detail: cards.map((c) => c.name.replace(/^🎨\s*/, "")).join(", ") }); } catch {}
    if (res.cards && res.cards[0] && res.cards[0].url) setTimeout(() => window.api.openExternal(res.cards[0].url), 400);
  } catch (e) { toast("Trello: " + e.message, true); if (msgEl) msgEl.textContent = "❌ " + e.message; }
  if (btn) { btn.disabled = false; btn.textContent = "📤 Enviar selecionados pro Trello"; }
}

/* ============================================================
   GOOGLE ADS — SESSÃO
   ============================================================ */
let gadsSessPeriod = 7;
let gadsOnlyActive = false; // filtro "só ativos"

function initGadsSession() {
  // preenche o seletor com os clientes que têm Google configurado
  const sel = $("#gadsAccSel");
  if (sel.options.length > 1) return;
  sel.innerHTML = '<option value="">— selecione —</option>';
  state.clients.forEach((c) => {
    const gid = c.adAccounts && c.adAccounts.google;
    if (!gid) return;
    sel.add(new Option(`${c.name} (${gid})`, gid));
  });
  if (!sel.options.length || sel.options.length === 1) {
    const opt = document.createElement("option");
    opt.disabled = true; opt.textContent = "Nenhum cliente com Google Ads vinculado";
    sel.add(opt);
  }
}

$$(".sess-period-g").forEach((b) => b.addEventListener("click", () => {
  $$(".sess-period-g, .sess-period-g-custom").forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
  gadsSessPeriod = Number(b.dataset.days);
  $("#gadsCustomRange").classList.add("hidden");
}));
$("#gadsCustomToggle").addEventListener("click", () => {
  $$(".sess-period-g, .sess-period-g-custom").forEach((x) => x.classList.remove("active"));
  $("#gadsCustomToggle").classList.add("active");
  gadsSessPeriod = "custom";
  const box = $("#gadsCustomRange");
  box.classList.remove("hidden");
  if (!$("#gadsStart").value) { const d = sessDates(7); $("#gadsStart").value = d.start; $("#gadsEnd").value = d.end; }
});

$("#gadsOnlyActive").addEventListener("change", (e) => {
  gadsOnlyActive = e.target.checked;
  if ($("#gadsAccSel").value) loadGadsCampaigns();
});
$("#gadsLoadBtn").addEventListener("click", loadGadsCampaigns);
async function loadGadsCampaigns() {
  const customerId = $("#gadsAccSel").value;
  if (!customerId) { toast("Selecione uma conta Google Ads.", true); return; }
  let start, end;
  if (gadsSessPeriod === "custom") {
    start = $("#gadsStart").value; end = $("#gadsEnd").value;
    if (!start || !end) { toast("Escolha as datas de início e fim.", true); return; }
    if (start > end) { toast("A data inicial não pode ser depois da final.", true); return; }
  } else {
    ({ start, end } = sessDates(gadsSessPeriod));
  }
  const body = $("#gadsCampBody");
  body.innerHTML = '<div class="state">⏳ Carregando campanhas…</div>';
  try {
    let camps = await window.api.gadsCampaigns({ customerId, start, end });
    if (gadsOnlyActive) camps = camps.filter((c) => c.status === "ENABLED");
    renderGadsCampaigns(camps, customerId, start, end);
    const totals = camps.reduce((t, c) => { t.cost += c.cost; t.conversions += c.conversions; t.clicks += c.clicks; t.impressions += c.impressions; return t; }, { cost: 0, conversions: 0, clicks: 0, impressions: 0 });
    $("#gGasto").textContent = "R$ " + totals.cost.toFixed(2);
    $("#gConv").textContent = totals.conversions.toFixed(1);
    $("#gCpa").textContent = totals.conversions ? "R$ " + (totals.cost / totals.conversions).toFixed(2) : "—";
    const avgCpc = camps.length ? camps.reduce((s, c) => s + c.cpc, 0) / camps.filter((c) => c.cpc > 0).length : 0;
    $("#gCpc").textContent = avgCpc ? "R$ " + avgCpc.toFixed(2) : "—";
    $("#gClicks").textContent = totals.clicks.toLocaleString("pt-BR");
    $("#gadsSessMetrics").classList.remove("hidden");
  } catch (e) { body.innerHTML = `<div class="state error">❌ ${e.message}</div>`; }
}

function gadsStatusBadge(status) {
  const map = { ENABLED: ["✅", "Ativa"], PAUSED: ["⏸️", "Pausada"], REMOVED: ["🗑️", "Removida"] };
  const [ic, lb] = map[status] || ["❓", status];
  return `<span class="sess-badge ${status === "ENABLED" ? "active" : "paused"}">${ic} ${lb}</span>`;
}

function renderGadsCampaigns(camps, customerId, start, end) {
  const body = $("#gadsCampBody");
  if (!camps.length) { body.innerHTML = '<div class="state">Nenhuma campanha com dados neste período.</div>'; return; }
  const html = camps.map((c) => {
    const budget = c.budgetMicros ? "R$ " + (Number(c.budgetMicros) / 1e6).toFixed(2) + "/dia" : "—";
    return `<div class="sess-row" data-id="${c.id}">
      <div class="sess-row-main">
        <div class="sess-row-name">${c.name}</div>
        <div class="sess-row-meta">${gadsStatusBadge(c.status)} · ${budget} · ${c.channelType || ""}${c.isTrial ? ' · <span class="sess-badge trial">🧪 Experimento</span>' : ""}</div>
      </div>
      <div class="sess-row-metrics">
        <span title="Gasto">💰 R$ ${c.cost.toFixed(2)}</span>
        <span title="Conversões">🎯 ${c.conversions.toFixed(1)} conv</span>
        <span title="Custo por conversão">📉 ${c.conversions ? "R$ " + (c.cost / c.conversions).toFixed(2) + " CPA" : "— CPA"}</span>
        <span title="CPC">🖱️ R$ ${c.cpc.toFixed(2)} CPC</span>
        <span title="Cliques">👆 ${c.clicks.toLocaleString("pt-BR")}</span>
      </div>
      <div class="sess-row-actions">
        ${c.isTrial
          ? `<button class="chip-btn" disabled title="Campanha de experimento — pause dentro do experimento no Google Ads">🧪 Experimento (não editável)</button>`
          : `<button class="chip-btn gads-toggle" data-id="${c.id}" data-status="${c.status}" data-cust="${customerId}">${c.status === "ENABLED" ? "Pausar" : "Ativar"}</button>`}
        <button class="chip-btn gads-expand" data-id="${c.id}" data-cust="${customerId}" data-start="${start}" data-end="${end}">Ver grupos ▾</button>
        ${c.channelType === "DISPLAY" ? `<button class="chip-btn gads-creatives" data-id="${c.id}" data-cust="${customerId}" data-start="${start}" data-end="${end}">🖼️ Criativos display</button>` : ""}
      </div>
      <div class="sess-expand" id="ag-${c.id}"></div>
      <div class="sess-expand" id="dc-${c.id}"></div>
    </div>`;
  }).join("");
  body.innerHTML = html;

  $$(".gads-toggle", body).forEach((btn) => btn.addEventListener("click", async () => {
    const cur = btn.dataset.status; const next = cur === "ENABLED" ? "PAUSED" : "ENABLED";
    btn.disabled = true; btn.textContent = "…";
    try {
      await window.api.gadsToggleCampaign({ customerId: btn.dataset.cust, campaignId: btn.dataset.id, status: next });
      btn.dataset.status = next; btn.textContent = next === "ENABLED" ? "Pausar" : "Ativar";
      toast(`Campanha ${next === "ENABLED" ? "ativada" : "pausada"}.`);
      const campName = btn.closest(".sess-row").querySelector(".sess-row-name").textContent.trim();
      const cli = clientByGoogle(btn.dataset.cust);
      if (cli) try { await window.api.logAction({ projectId: cli.projectId, clientName: cli.name, type: "toggle", summary: `${next === "ENABLED" ? "▶️ Ativou" : "⏸️ Pausou"} campanha "${campName}" no Google Ads` }); } catch {}
    } catch (e) { toast("Erro: " + e.message, true); btn.disabled = false; }
  }));

  $$(".gads-creatives", body).forEach((btn) => btn.addEventListener("click", () => loadGadsDisplayAds(btn)));

  $$(".gads-expand", body).forEach((btn) => btn.addEventListener("click", async () => {
    const id = btn.dataset.id; const box = $("#ag-" + id);
    if (box.dataset.loaded) { box.classList.toggle("hidden"); btn.textContent = box.classList.contains("hidden") ? "Ver grupos ▾" : "Ocultar ▴"; return; }
    btn.disabled = true; btn.textContent = "Carregando…";
    try {
      let ags = await window.api.gadsAdGroups({ customerId: btn.dataset.cust, campaignId: id, start: btn.dataset.start, end: btn.dataset.end });
      if (gadsOnlyActive) ags = ags.filter((a) => a.status === "ENABLED");
      box.dataset.loaded = "1";
      box.innerHTML = ags.length ? ags.map((a) => `
        <div class="sess-sub-row">
          <div class="sess-row-name">${a.name}</div>
          <div class="sess-row-meta">${gadsStatusBadge(a.status)}</div>
          <div class="sess-row-metrics">
            <span>💰 R$ ${a.cost.toFixed(2)}</span><span>🎯 ${a.conversions.toFixed(1)} conv</span><span>📉 ${a.conversions ? "R$ " + (a.cost / a.conversions).toFixed(2) + " CPA" : "— CPA"}</span><span>👆 ${a.clicks}</span>
          </div>
          <div style="display:flex;gap:6px">
            <button class="chip-btn ag-kw" data-id="${a.id}" data-cust="${btn.dataset.cust}" data-start="${btn.dataset.start}" data-end="${btn.dataset.end}">🔑 Palavras-chave</button>
            <button class="chip-btn ag-toggle" data-id="${a.id}" data-status="${a.status}" data-cust="${btn.dataset.cust}">
              ${a.status === "ENABLED" ? "Pausar" : "Ativar"}
            </button>
          </div>
          <div class="sess-expand" id="kw-${a.id}"></div>
        </div>`).join("") : '<div class="sub">Nenhum grupo com dados neste período.</div>';
      $$(".ag-toggle", box).forEach((tb) => tb.addEventListener("click", async () => {
        const cur = tb.dataset.status; const next = cur === "ENABLED" ? "PAUSED" : "ENABLED";
        tb.disabled = true; tb.textContent = "…";
        try {
          await window.api.gadsToggleAdGroup({ customerId: tb.dataset.cust, adGroupId: tb.dataset.id, status: next });
          tb.dataset.status = next; tb.textContent = next === "ENABLED" ? "Pausar" : "Ativar";
          toast(`Grupo ${next === "ENABLED" ? "ativado" : "pausado"}.`);
          const grpName = tb.closest(".sess-sub-row").querySelector(".sess-row-name").textContent.trim();
          const cli = clientByGoogle(tb.dataset.cust);
          if (cli) try { await window.api.logAction({ projectId: cli.projectId, clientName: cli.name, type: "toggle", summary: `${next === "ENABLED" ? "▶️ Ativou" : "⏸️ Pausou"} grupo "${grpName}" no Google Ads` }); } catch {}
        } catch (e) { toast("Erro: " + e.message, true); tb.disabled = false; }
      }));
      $$(".ag-kw", box).forEach((kb) => kb.addEventListener("click", () => loadGadsKeywords(kb)));
      btn.textContent = "Ocultar ▴";
    } catch (e) { toast(e.message, true); btn.textContent = "Ver grupos ▾"; }
    btn.disabled = false;
  }));
}

// carrega criativos de uma campanha Display (imagens + responsivos) com grade visual
async function loadGadsDisplayAds(btn) {
  const campId = btn.dataset.id; const box = $("#dc-" + campId);
  if (box.dataset.loaded) { box.classList.toggle("hidden"); btn.textContent = box.classList.contains("hidden") ? "🖼️ Criativos display" : "🖼️ Ocultar"; return; }
  btn.disabled = true; btn.textContent = "Carregando…";
  try {
    const ads = await window.api.gadsDisplayAds({ customerId: btn.dataset.cust, campaignId: campId, start: btn.dataset.start, end: btn.dataset.end });
    box.dataset.loaded = "1";
    if (!ads.length) { box.innerHTML = '<div class="sub" style="padding:10px 18px">Nenhum criativo com dados neste período.</div>'; }
    else {
      const typeLabel = (ad) => {
        if (ad.isImageAd) return `🖼️ Imagem${ad.width ? ` ${ad.width}×${ad.height}` : ""}`;
        if (ad.isResponsive) return "📱 Responsivo";
        return ad.type || "—";
      };
      box.innerHTML = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 18px 6px">
          <span style="font-size:12px;color:var(--muted)">${ads.length} criativo(s) · Display</span>
          <label style="font-size:12px;display:flex;align-items:center;gap:5px;cursor:pointer;margin-left:8px"><input type="checkbox" class="creative-selectall"> Selecionar todos</label>
          <button class="btn btn-primary creative-send-trello" style="padding:6px 12px;font-size:12.5px">📤 Enviar selecionados pro Trello</button>
          <span class="creative-send-msg" style="font-size:12px;color:var(--muted)"></span>
        </div>
        <div class="creative-grid" style="padding:0 18px 14px">${ads.map((ad) => `
          <div class="creative-card">
            <div class="creative-thumb">
              ${ad.imageUrl
                ? `<img class="disp-img" src="${ad.imageUrl}" alt="" loading="lazy">`
                : `<span style="font-size:28px;display:block;text-align:center;line-height:90px">${ad.isResponsive ? "📱" : "🖼️"}</span>`}
            </div>
            <div class="creative-info">
              <div class="creative-top" style="display:flex;align-items:center;gap:8px">${gadsStatusBadge(ad.status)}<label style="margin-left:auto;font-size:11px;display:flex;align-items:center;gap:4px;cursor:pointer" title="Selecionar pro Trello"><input type="checkbox" class="creative-ck" data-id="${ad.id}"> Trello</label></div>
              <div class="creative-name" title="${ad.name}">${ad.name}</div>
              <div style="font-size:11px;color:var(--muted);margin:2px 0 4px">${typeLabel(ad)}${ad.adGroupName ? ` · ${ad.adGroupName}` : ""}</div>
              <div class="creative-metrics">
                <div class="cm"><span class="cm-v">R$ ${ad.cost.toFixed(2)}</span><span class="cm-l">gasto</span></div>
                <div class="cm"><span class="cm-v">${ad.impressions.toLocaleString("pt-BR")}</span><span class="cm-l">impr.</span></div>
                <div class="cm"><span class="cm-v">${ad.clicks}</span><span class="cm-l">cliques</span></div>
                <div class="cm"><span class="cm-v">${ad.conversions.toFixed(1)}</span><span class="cm-l">conv.</span></div>
              </div>
              <button class="chip-btn disp-toggle ${ad.status === "ENABLED" ? "" : "is-paused"}" data-id="${ad.id}" data-ag="${ad.adGroupId}" data-cust="${btn.dataset.cust}" data-status="${ad.status}">${ad.status === "ENABLED" ? "⏸ Pausar" : "▶ Ativar"}</button>
            </div>
          </div>`).join("")}</div>`;
      // onerror nas imagens: substitui por ícone se não carregar
      $$(".disp-img", box).forEach((img) => { img.addEventListener("error", () => { img.parentNode.innerHTML = '<span style="font-size:28px;display:block;text-align:center;line-height:90px">🖼️</span>'; }); });
      // seleção + envio dos criativos pro Trello
      const selAllD = $(".creative-selectall", box);
      if (selAllD) selAllD.addEventListener("change", () => $$(".creative-ck", box).forEach((ck) => { ck.checked = selAllD.checked; }));
      const sendBtnD = $(".creative-send-trello", box);
      if (sendBtnD) sendBtnD.addEventListener("click", () => {
        const week = sessionWeekFromRange(btn.dataset.start, btn.dataset.end);
        const cli = clientByGoogle(btn.dataset.cust);
        const sel = $$(".creative-ck:checked", box).map((ck) => ads.find((a) => String(a.id) === ck.dataset.id)).filter(Boolean);
        const cards = sel.map((ad) => ({
          name: `🎨 ${ad.name}`,
          desc: [
            `Criativo de Display (Google Ads)${cli ? " — " + cli.name : ""} · ${typeLabel(ad)}`,
            `Período: ${week.label} · Status: ${ad.status === "ENABLED" ? "Ativo" : ad.status}${ad.adGroupName ? " · Grupo: " + ad.adGroupName : ""}`,
            ``,
            `💰 Gasto: R$ ${ad.cost.toFixed(2)}`,
            `👁️ Impressões: ${ad.impressions.toLocaleString("pt-BR")}`,
            `🖱️ Cliques: ${ad.clicks.toLocaleString("pt-BR")}`,
            `🎯 Conversões: ${ad.conversions.toFixed(1)}`,
          ].join("\n"),
          imageUrl: ad.imageUrl || null,
          filename: `display-${ad.id}.jpg`,
        }));
        pushCreativesToTrello({ client: cli, cards, platformLabel: "Google Display", btn: sendBtnD, msgEl: $(".creative-send-msg", box) });
      });
      // toggle de status dos anúncios display
      $$(".disp-toggle", box).forEach((tb) => tb.addEventListener("click", async () => {
        const cur = tb.dataset.status; const next = cur === "ENABLED" ? "PAUSED" : "ENABLED";
        tb.disabled = true; tb.textContent = "…";
        try {
          await window.api.gadsToggleAd({ customerId: tb.dataset.cust, adGroupId: tb.dataset.ag, adId: tb.dataset.id, status: next });
          tb.dataset.status = next; tb.textContent = next === "ENABLED" ? "⏸ Pausar" : "▶ Ativar";
          tb.classList.toggle("is-paused", next !== "ENABLED");
          toast(`Criativo display ${next === "ENABLED" ? "ativado" : "pausado"}.`);
          const adName = tb.closest(".creative-card").querySelector(".creative-name").textContent.trim();
          const cli = clientByGoogle(tb.dataset.cust);
          if (cli) try { await window.api.logAction({ projectId: cli.projectId, clientName: cli.name, type: "toggle", summary: `${next === "ENABLED" ? "▶️ Ativou" : "⏸️ Pausou"} criativo display "${adName}" no Google Ads` }); } catch {}
        } catch (e) { toast("Erro: " + e.message, true); tb.disabled = false; }
      }));
    }
    btn.textContent = "🖼️ Ocultar";
  } catch (e) { toast(e.message, true); btn.textContent = "🖼️ Criativos display"; }
  btn.disabled = false;
}

// carrega as palavras-chave de um grupo numa tabela (custo, conversão, CPA, QS) + pausar
async function loadGadsKeywords(kb) {
  const agId = kb.dataset.id; const box = $("#kw-" + agId);
  if (box.dataset.loaded) { box.classList.toggle("hidden"); kb.textContent = box.classList.contains("hidden") ? "🔑 Palavras-chave" : "🔑 Ocultar"; return; }
  kb.disabled = true; kb.textContent = "Carregando…";
  try {
    let kws = await window.api.gadsKeywords({ customerId: kb.dataset.cust, adGroupId: agId, start: kb.dataset.start, end: kb.dataset.end });
    if (gadsOnlyActive) kws = kws.filter((k) => k.status === "ENABLED");
    box.dataset.loaded = "1";
    if (!kws.length) { box.innerHTML = '<div class="sub">Nenhuma palavra-chave com dados neste período.</div>'; }
    else {
      box.innerHTML = `<div class="kw-legend">🔴 Em vermelho: gastou e não converteu (candidata a pausar)</div>
        <table class="kw-table">
        <thead><tr><th>Palavra-chave</th><th>Tipo</th><th>QS</th><th>Custo</th><th>Cliques</th><th>Conv.</th><th>CPA</th><th>CTR</th><th></th></tr></thead>
        <tbody>${kws.map((k) => {
          // destaque vermelho: gastou e não converteu (candidata a pausar)
          const warn = k.cost > 0 && k.conversions === 0;
          return `<tr class="${warn ? "kw-warn" : ""}">
            <td><b>${k.text}</b></td>
            <td>${matchLabel(k.matchType)}</td>
            <td>${k.qualityScore || "—"}</td>
            <td>R$ ${k.cost.toFixed(2)}</td>
            <td>${k.clicks}</td>
            <td>${k.conversions.toFixed(1)}</td>
            <td>${k.cpa != null ? "R$ " + k.cpa.toFixed(2) : "—"}</td>
            <td>${(k.ctr * 100).toFixed(1)}%</td>
            <td><button class="chip-btn kw-toggle" data-id="${k.id}" data-ag="${agId}" data-status="${k.status}" data-cust="${kb.dataset.cust}">${k.status === "ENABLED" ? "Pausar" : "Ativar"}</button></td>
          </tr>`;
        }).join("")}</tbody></table>`;
      $$(".kw-toggle", box).forEach((tb) => tb.addEventListener("click", async () => {
        const cur = tb.dataset.status; const next = cur === "ENABLED" ? "PAUSED" : "ENABLED";
        tb.disabled = true; tb.textContent = "…";
        try {
          await window.api.gadsToggleKeyword({ customerId: tb.dataset.cust, adGroupId: tb.dataset.ag, criterionId: tb.dataset.id, status: next });
          tb.dataset.status = next; tb.textContent = next === "ENABLED" ? "Pausar" : "Ativar";
          toast(`Palavra-chave ${next === "ENABLED" ? "ativada" : "pausada"}.`);
          const kwText = tb.closest("tr").querySelector("td b").textContent.trim();
          const cli = clientByGoogle(kb.dataset.cust);
          if (cli) try { await window.api.logAction({ projectId: cli.projectId, clientName: cli.name, type: "toggle", summary: `${next === "ENABLED" ? "▶️ Ativou" : "⏸️ Pausou"} palavra-chave "${kwText}" no Google Ads` }); } catch {}
        } catch (e) { toast("Erro: " + e.message, true); tb.disabled = false; }
      }));
    }
    kb.textContent = "🔑 Ocultar";
  } catch (e) { toast(e.message, true); kb.textContent = "🔑 Palavras-chave"; }
  kb.disabled = false;
}
function matchLabel(m) { return { EXACT: "[exata]", PHRASE: '"frase"', BROAD: "ampla" }[m] || m || ""; }

$("#gadsNewCampBtn").addEventListener("click", () => {
  $$(".nav .tab").forEach((x) => x.classList.toggle("active", x.dataset.view === "funil"));
  ALL_VIEWS.forEach((v) => $("#view-" + v).classList.toggle("hidden", v !== "funil"));
  toast("Use o Funil Studio para criar e depois envie pelo botão Subida.");
});
$("#gadsAnalyzeBtn").addEventListener("click", () => analyzeSessionPlatform("google"));

/* ============================================================
   TAG MANAGER — SESSÃO
   ============================================================ */
let gtmContainers = [];
let gtmSuggestedEvents = [];
let gtmImgData = null;

async function initGtmSession() {
  if (gtmContainers.length) return;
  const btn = $("#gtmContLoad"); btn.textContent = "↺ carregando…"; btn.disabled = true;
  try {
    gtmContainers = await window.api.gtmContainers();
    const sel = $("#gtmContSel");
    sel.innerHTML = '<option value="">— selecione —</option>';
    gtmContainers.forEach((c) => sel.add(new Option(`${c.containerName} (${c.accountName})`, c.path)));
  } catch (e) { toast("GTM: " + e.message + " — Conecte o GTM em Configurações.", true); }
  btn.textContent = "↺ carregar containers"; btn.disabled = false;
}

$("#gtmContLoad").addEventListener("click", async () => { gtmContainers = []; await initGtmSession(); });

/* ------------------------------------------------------------
   Utilitário reutilizável: escolher / COLAR (⌘V) / arrastar imagem
   numa "zona", devolvendo o dataURL. Use em qualquer aba do app.
   ------------------------------------------------------------ */
function fileToDataUrl(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result || "")); r.onerror = rej; r.readAsDataURL(file); });
}
function setupImageInput({ zone, nameEl, previewEl, clearBtn, pickBtn, pasteBtn, onImage }) {
  const setImg = async (fileOrUrl, name) => {
    const dataUrl = typeof fileOrUrl === "string" ? fileOrUrl : await fileToDataUrl(fileOrUrl);
    if (previewEl) { previewEl.src = dataUrl; previewEl.classList.remove("hidden"); }
    if (nameEl) nameEl.textContent = name || "print colado";
    if (clearBtn) clearBtn.classList.remove("hidden");
    onImage(dataUrl, name || "");
  };
  const clear = () => {
    if (previewEl) { previewEl.src = ""; previewEl.classList.add("hidden"); }
    if (nameEl) nameEl.textContent = "";
    if (clearBtn) clearBtn.classList.add("hidden");
    onImage(null, "");
  };
  if (pickBtn) pickBtn.addEventListener("click", () => {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
    inp.addEventListener("change", async () => { const f = inp.files[0]; if (f) await setImg(f, f.name); });
    inp.click();
  });
  // botão "Colar print" — lê a imagem direto da área de transferência
  if (pasteBtn) pasteBtn.addEventListener("click", async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith("image/"));
        if (type) { await setImg(await it.getType(type), "print colado"); return; }
      }
      toast("Não achei imagem copiada. Dê um print antes (⌘⇧4 no Mac / Win+Shift+S).", true);
    } catch { toast("Clique dentro da caixa e use ⌘V (Ctrl+V) pra colar o print.", true); }
  });
  if (zone) {
    // colar com ⌘V / Ctrl+V dentro da zona
    zone.addEventListener("paste", async (e) => {
      const items = (e.clipboardData || {}).items || [];
      for (const it of items) {
        if (it.type && it.type.startsWith("image/")) { e.preventDefault(); const f = it.getAsFile(); if (f) await setImg(f, "print colado"); return; }
      }
    });
    // arrastar-e-soltar
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("paste-ready"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("paste-ready"));
    zone.addEventListener("drop", async (e) => {
      e.preventDefault(); zone.classList.remove("paste-ready");
      const f = (e.dataTransfer.files || [])[0]; if (f && f.type.startsWith("image/")) await setImg(f, f.name);
    });
  }
  if (clearBtn) clearBtn.addEventListener("click", clear);
  return { clear };
}

setupImageInput({
  zone: $("#gtmImgZone"), nameEl: $("#gtmImgName"), previewEl: $("#gtmImgPreview"),
  clearBtn: $("#gtmImgClear"), pickBtn: $("#gtmPickImg"), pasteBtn: $("#gtmPasteImg"),
  onImage: (dataUrl) => { gtmImgData = dataUrl; },
});

$("#gtmSmartBtn").addEventListener("click", async () => {
  const containerPath = $("#gtmContSel").value;
  if (!containerPath) { toast("Selecione um container GTM.", true); return; }
  const url = $("#gtmPageUrl").value.trim();
  const measId = $("#gtmMeasId").value.trim();
  const box = $("#gtmSugestBox");
  if (!url && !gtmImgData) { toast("Informe a URL da página (ou anexe um print).", true); return; }
  box.innerHTML = '<div class="state">⏳ Lendo a página e sugerindo eventos…</div>';
  try {
    const events = await window.api.gtmSmartSetup({ url, screenshot: gtmImgData, containerPath, measurementId: measId });
    gtmSuggestedEvents = events;
    renderGtmSuggestions(events, containerPath);
    box.innerHTML = "";
  } catch (e) { box.innerHTML = `<div class="state error">❌ ${e.message}</div>`; }
});

function renderGtmSuggestions(events, containerPath) {
  const evBox = $("#gtmEvBox");
  const createBtn = $("#gtmCreateBtn");
  if (!events.length) { evBox.innerHTML = '<div class="state">Nenhum evento sugerido.</div>'; createBtn.classList.add("hidden"); return; }
  evBox.innerHTML = events.map((ev, i) => `
    <div class="sess-row" style="align-items:flex-start">
      <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;flex:1">
        <input type="checkbox" class="gtm-ev-check" data-i="${i}" checked style="margin-top:3px">
        <div>
          <div class="sess-row-name">${ev.name}</div>
          <div class="sub" style="margin-top:3px">Evento GA4: <code>${ev.eventName}</code> · Selector: <code>${ev.selector || "—"}</code></div>
          <div class="sub">${ev.description || ""}</div>
        </div>
      </label>
      <div style="display:flex;gap:6px;flex-direction:column;min-width:200px">
        <input type="text" class="gtm-ev-name" data-i="${i}" value="${ev.eventName}" placeholder="nome GA4" style="padding:4px 8px;background:var(--panel-2);border:1px solid var(--line);border-radius:6px;color:#cdd6e3;font-size:12px">
        <input type="text" class="gtm-ev-sel" data-i="${i}" value="${ev.selector || ""}" placeholder="CSS selector" style="padding:4px 8px;background:var(--panel-2);border:1px solid var(--line);border-radius:6px;color:#cdd6e3;font-size:12px">
      </div>
    </div>`).join("");
  createBtn.classList.remove("hidden");
  createBtn.dataset.container = containerPath;
}

$("#gtmCreateBtn").addEventListener("click", async () => {
  const containerPath = $("#gtmCreateBtn").dataset.container;
  const measId = $("#gtmMeasId").value.trim();
  const selected = $$(".gtm-ev-check:checked").map((cb) => {
    const i = Number(cb.dataset.i);
    const ev = { ...gtmSuggestedEvents[i] };
    const nameEl = $(`.gtm-ev-name[data-i="${i}"]`);
    const selEl = $(`.gtm-ev-sel[data-i="${i}"]`);
    if (nameEl) ev.eventName = nameEl.value.trim() || ev.eventName;
    if (selEl) ev.selector = selEl.value.trim() || ev.selector;
    ev.measurementId = measId;
    return ev;
  });
  if (!selected.length) { toast("Selecione pelo menos um evento.", true); return; }
  const btn = $("#gtmCreateBtn"); btn.disabled = true; btn.textContent = "Criando…";
  try {
    const results = await window.api.gtmSetup({ containerPath, events: selected });
    const resBox = $("#gtmResultBox");
    resBox.innerHTML = results.map((r) => `
      <div style="padding:6px 0;border-bottom:1px solid var(--line)">${r.ok ? "✅" : "❌"} <b>${r.name}</b>${r.ok ? "" : " — " + r.error}</div>`).join("");
    const ok = results.filter((r) => r.ok).length;
    toast(`${ok}/${results.length} evento(s) criado(s) no GTM.`);
  } catch (e) { toast("Erro: " + e.message, true); }
  btn.disabled = false; btn.textContent = "Criar eventos selecionados no GTM";
});

/* ============================================================
   MINHA SEMANA — rotina por call (PRÉ / CALL / PÓS)
   Cada cliente tem 1 dia fixo de call. A partir dele:
   véspera = PRÉ (preparar dados), dia = CALL, dia seguinte = PÓS (implementar).
   ============================================================ */
const WD_NAMES = ["", "Segunda", "Terça", "Quarta", "Quinta", "Sexta"];
// dias de call sugeridos por projectId (do mapeamento de calls da analista) — só popula clientes sem call ainda
const CALL_SUGGEST = {
  928553: 1, 1192435: 1, 1108921: 1,        // seg: Piticas, Work On, Grupo Nexo
  701461: 2, 790226: 2,                     // ter: Manusis4, Specttra
  705705: 3, 781722: 3,                     // qua: Find HR, Puket
  708180: 4, 1257483: 4, 772469: 4,         // qui: Average, Aarin, Income Housing
  707245: 5, 1197827: 5,                    // sex: aloee, Clemente Guerra
};
const nextBiz = (wd) => (wd >= 5 ? 1 : wd + 1);      // dia útil seguinte (sexta → segunda)
const prevBiz = (wd) => (wd <= 1 ? 5 : wd - 1);      // dia útil anterior (segunda → sexta)
const callWeekday = (c) => (c.call && c.call.weekday) || 0;
const clientsOnDay = (wd) => state.clients.filter((c) => callWeekday(c) === wd);

/* ---- status "feito" da rotina (persistido em settings.routineDone, chave data|cliente|tipo) ---- */
const routineKey = (ds, pid, kind) => `${ds}|${pid}|${kind}`;
const isDone = (ds, pid, kind) => !!(state.settings && state.settings.routineDone && state.settings.routineDone[routineKey(ds, pid, kind)]);
async function setDone(ds, pid, kind, val) {
  const rd = { ...((state.settings && state.settings.routineDone) || {}) };
  if (val) rd[routineKey(ds, pid, kind)] = 1; else delete rd[routineKey(ds, pid, kind)];
  const cut = iso(new Date(Date.now() - 21 * 864e5)); // descarta marcações com +21 dias
  Object.keys(rd).forEach((k) => { if (k.split("|")[0] < cut) delete rd[k]; });
  state.settings = await window.api.setSettings({ routineDone: rd });
}
const lastBizBefore = (date) => { const d = new Date(date); do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6); return d; };

let semRenderedFor = null; // data (iso) da última renderização — usado pra re-render quando o dia vira
function renderSemana() {
  const body = $("#semBody"); if (!body) return;
  // auto-popula a sugestão para clientes que ainda não têm call definida (1ª vez)
  let changed = false;
  state.clients.forEach((c) => { if (c.call == null && CALL_SUGGEST[c.projectId]) { c.call = { weekday: CALL_SUGGEST[c.projectId] }; changed = true; } });
  if (changed) window.api.setClients(state.clients);

  const now = new Date();
  const dow = now.getDay(); // 0=dom … 6=sáb
  const weekend = (dow === 0 || dow === 6);
  const today = iso(now);
  semRenderedFor = today;
  $("#semHojeLabel").textContent = now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" });

  const anyConfigured = state.clients.some((c) => callWeekday(c));
  if (!anyConfigured) {
    body.innerHTML = `<div class="state"><div class="big">🗓️</div>Nenhuma call configurada ainda.<br><span style="font-size:12px">Clique em "⚙️ Configurar dias das calls" acima para definir o dia de cada cliente.</span></div>`;
    return;
  }

  // card de cliente com ação + botão "feito" (ds = dia da tarefa, pra marcar o status certo)
  const card = (c, kind, ds) => {
    const done = isDone(ds, c.projectId, kind);
    const ads = c.adAccounts || {};
    const acts = {
      pre: { txt: "📊 Analisar semana", act: "panel", sub: `Call ${WD_NAMES[callWeekday(c)]}` },
      call: { txt: "📊 Ver dados", act: "panel", sub: `Call hoje${c.call && c.call.time ? " · " + c.call.time : ""}` },
      pos: { txt: "📋 Ver combinado (Trello)", act: "trello", sub: `Call foi ${WD_NAMES[callWeekday(c)]}` },
    }[kind];
    const platBtns = (ads.google ? `<button class="chip-btn sem-plat" data-plat="google" data-pid="${c.projectId}" title="Abrir a conta no Google Ads">🟢 Google</button>` : "")
      + (ads.meta ? `<button class="chip-btn sem-plat" data-plat="meta" data-pid="${c.projectId}" title="Abrir a conta no Gerenciador de Anúncios">📘 Meta</button>` : "")
      + (c.trelloBoardId ? `<button class="chip-btn sem-trello" data-pid="${c.projectId}" title="Abrir o board do Trello">📋 Trello</button>` : "");
    return `<div style="background:var(--panel-2);border:1px solid ${done ? "var(--accent)" : "var(--line)"};border-radius:10px;padding:11px 13px;margin-bottom:8px;${done ? "opacity:.62" : ""}">
      <div style="font-weight:600;font-size:14px;${done ? "text-decoration:line-through" : ""}">${c.name}</div>
      <div style="font-size:12px;color:var(--muted);margin:2px 0 6px">${acts.sub}</div>
      <div class="sem-pacing" data-pid="${c.projectId}" style="font-size:11.5px;margin:0 0 9px"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="chip-btn sem-act" data-act="${acts.act}" data-pid="${c.projectId}">${acts.txt}</button>
        ${platBtns}
        <button class="chip-btn sem-hist" data-pid="${c.projectId}">📜 histórico</button>
        <button class="chip-btn sem-done" data-pid="${c.projectId}" data-kind="${kind}" data-ds="${ds}">${done ? "↩︎ desfazer" : "✓ feito"}</button>
      </div>
    </div>`;
  };
  const col = (title, badge, color, list, kind, ds) => `
    <div style="flex:1;min-width:220px">
      <div style="display:inline-flex;align-items:center;gap:6px;background:${color}1a;color:${color};border:1px solid ${color}55;font-size:12px;font-weight:700;padding:4px 11px;border-radius:20px;margin-bottom:12px">${badge} ${title}</div>
      ${list.length ? list.map((c) => card(c, kind, ds)).join("") : `<div style="font-size:12.5px;color:var(--muted);padding:8px 2px">Nenhum cliente.</div>`}
    </div>`;

  const gridSemana = `<div class="section-title">📅 Visão da semana</div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:8px">
      ${[1, 2, 3, 4, 5].map((d) => {
        const isToday = d === dow;
        const list = clientsOnDay(d);
        return `<div style="background:var(--panel-2);border:${isToday ? "2px solid var(--accent)" : "1px solid var(--line)"};border-radius:10px;padding:9px;min-height:90px">
          <div style="font-size:12px;font-weight:700;color:${isToday ? "var(--accent)" : "var(--muted)"};margin-bottom:8px">${WD_NAMES[d]}${isToday ? " · hoje" : ""}</div>
          ${list.length ? list.map((c) => `<div style="font-size:12px;background:var(--panel);border-radius:6px;padding:4px 7px;margin-bottom:5px">${c.name}</div>`).join("") : `<div style="font-size:11px;color:var(--muted)">—</div>`}
        </div>`;
      }).join("")}
    </div>`;

  const bindCards = () => {
    $$(".sem-act", body).forEach((b) => b.addEventListener("click", () => {
      const pid = Number(b.dataset.pid);
      if (b.dataset.act === "trello") goClientTrello(pid); else if (b.dataset.act === "hist") goClientHistory(pid); else goClientPanel(pid);
    }));
    $$(".sem-plat", body).forEach((b) => b.addEventListener("click", () => openPlatform(b.dataset.plat, Number(b.dataset.pid))));
    $$(".sem-trello", body).forEach((b) => b.addEventListener("click", () => {
      const c = state.clients.find((x) => x.projectId === Number(b.dataset.pid));
      if (c && c.trelloBoardId) window.api.openExternal(`https://trello.com/b/${c.trelloBoardId}`);
    }));
    $$(".sem-hist", body).forEach((b) => b.addEventListener("click", () => goClientHistory(Number(b.dataset.pid))));
    $$(".sem-done", body).forEach((b) => b.addEventListener("click", async () => {
      const pid = Number(b.dataset.pid);
      await setDone(b.dataset.ds, pid, b.dataset.kind, !isDone(b.dataset.ds, pid, b.dataset.kind));
      renderSemana();
    }));
  };

  // FIM DE SEMANA: sem rotina ativa — mostra aviso + a semana
  if (weekend) {
    const seg = clientsOnDay(1);
    body.innerHTML = `<div class="card" style="padding:16px 20px;margin-bottom:10px">
        <div style="font-size:15px;font-weight:700">🌴 Fim de semana</div>
        <div class="sub" style="margin-top:6px">Sua rotina volta na <b>segunda</b>. Calls de segunda: ${seg.length ? seg.map((c) => c.name).join(", ") : "—"}.</div>
      </div>${gridSemana}`;
    return;
  }

  const wd = dow; // 1-5
  // PENDÊNCIAS: tarefas (PRÉ/PÓS) do último dia útil que não foram marcadas como feitas — pra não deixar passar
  const prevD = lastBizBefore(now); const pds = iso(prevD); const pdow = prevD.getDay();
  const pend = [];
  clientsOnDay(nextBiz(pdow)).forEach((c) => { if (!isDone(pds, c.projectId, "pre")) pend.push({ c, kind: "pre", ds: pds }); });
  clientsOnDay(prevBiz(pdow)).forEach((c) => { if (!isDone(pds, c.projectId, "pos")) pend.push({ c, kind: "pos", ds: pds }); });
  const pendHtml = pend.length ? `<div class="section-title" style="margin-top:0;color:#e0857a">⚠️ Ficou pendente de ${WD_NAMES[pdow]}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:6px">${pend.map((p) => `<div style="flex:1;min-width:220px;max-width:340px">${card(p.c, p.kind, p.ds)}</div>`).join("")}</div>` : "";

  const pre = clientsOnDay(nextBiz(wd));
  const call = clientsOnDay(wd);
  const pos = clientsOnDay(prevBiz(wd));

  body.innerHTML = pendHtml + `<div class="section-title" style="margin-top:${pend.length ? "18px" : "0"}">🎯 Foco de hoje</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px">
      ${col(`PRÉ · preparar (call ${WD_NAMES[nextBiz(wd)].toLowerCase()})`, "🎯", "#3b82f6", pre, "pre", today)}
      ${col("CALL hoje", "📞", "#19e3a2", call, "call", today)}
      ${col(`PÓS · implementar (call ${WD_NAMES[prevBiz(wd)].toLowerCase()})`, "🛠️", "#e0b85a", pos, "pos", today)}
    </div>
    ${gridSemana}`;
  bindCards();
  // pacing: clientes visíveis hoje, sem repetir
  const visiveis = [...new Map([...pend.map((p) => p.c), ...pre, ...call, ...pos].map((c) => [c.projectId, c])).values()];
  loadPacing(visiveis);
}

// puxa o gasto do MÊS ATÉ HOJE de cada cliente (com orçamento) e pinta o pacing nos cards. Cache por dia.
async function loadPacing(clientes) {
  const now = new Date(); const today = iso(now);
  const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const frac = now.getDate() / dim;
  if (!state.pacing || state.pacing.date !== today) state.pacing = { date: today, data: {} };
  // re-pinta os que já estão em cache
  clientes.forEach((c) => paintPacing(c, frac));
  const pend = clientes.filter((c) => c.budget && (c.budget.meta || c.budget.google || c.budget.linkedin) && !state.pacing.data[c.projectId]);
  for (const c of pend) {
    try {
      const ads = c.adAccounts || {};
      const resp = await window.api.reporteiWeekData({ projectId: reporteiIdOf(c), start: monthStart, end: today, includeAds: false, directMeta: ads.meta || null, directGoogle: ads.google || null });
      const spent = {};
      (resp.platforms || []).forEach((p) => { spent[p.platform] = (p.totals.spend || 0) + (p.totals.cost || 0); });
      state.pacing.data[c.projectId] = spent;
    } catch { state.pacing.data[c.projectId] = {}; }
    paintPacing(c, frac);
  }
}
function paintPacing(c, frac) {
  const bud = c.budget || {};
  const hasBudget = bud.meta || bud.google || bud.linkedin;
  const els = $$('.sem-pacing[data-pid="' + c.projectId + '"]', $("#semBody"));
  if (!els.length) return;
  if (!hasBudget) { els.forEach((el) => { el.innerHTML = ""; }); return; } // sem orçamento → sem pacing
  const spent = state.pacing && state.pacing.data[c.projectId];
  if (!spent) { els.forEach((el) => { el.innerHTML = '<span style="color:var(--muted)">💰 carregando pacing…</span>'; }); return; }
  const brl = (n) => Math.round(n).toLocaleString("pt-BR");
  const parts = [];
  [["meta", "Meta"], ["google", "Google"], ["linkedin", "LinkedIn"]].forEach(([k, label]) => {
    const b = bud[k]; if (!b) return;
    const s = spent[k] || 0; const pct = Math.round(s / b * 100);
    const ratio = s / (b * frac || 1);
    const icon = ratio > 1.12 ? "🔴" : ratio < 0.85 ? "🟠" : "🟢";
    parts.push(`${icon} ${label} ${pct}% <span style="color:var(--muted)">(R$ ${brl(s)}/${brl(b)})</span>`);
  });
  els.forEach((el) => { el.innerHTML = parts.length ? "💰 " + parts.join(" · ") : ""; });
}

// re-renderiza a aba se o dia virou e a aba está visível (app aberto de um dia pro outro)
function maybeRefreshSemana() {
  const sec = $("#view-semana");
  if (sec && !sec.classList.contains("hidden") && semRenderedFor !== iso(new Date())) renderSemana();
}
window.addEventListener("focus", maybeRefreshSemana);
document.addEventListener("visibilitychange", () => { if (!document.hidden) maybeRefreshSemana(); });
setInterval(maybeRefreshSemana, 60000);

// vai pro Painel da semana já analisando o cliente
function goClientPanel(projectId) {
  $("#clientSel").value = projectId;
  $('.nav .tab[data-view="painel"]').click();
  analisar();
}
// abre o Histórico do cliente (o que foi combinado/feito)
function goClientHistory(projectId) {
  $("#histClientSel").value = projectId;
  $('.nav .tab[data-view="historico"]').click();
}
// abre a plataforma (Google Ads / Gerenciador do Meta) já na conta do cliente
function openPlatform(plat, projectId) {
  const c = state.clients.find((x) => x.projectId === projectId);
  const ads = (c && c.adAccounts) || {};
  if (plat === "google") {
    const gid = String(ads.google || "").replace(/-/g, "");
    if (!gid) { toast("Cliente sem conta Google vinculada.", true); return; }
    window.api.openExternal(`https://ads.google.com/aw/campaigns?__c=${gid}`);
  } else if (plat === "meta") {
    const aid = String(ads.meta || "").replace(/^act_/, "");
    if (!aid) { toast("Cliente sem conta Meta vinculada.", true); return; }
    window.api.openExternal(`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${aid}`);
  }
}
// abre o Trello do cliente na "Demandas da Semana": prioriza o card de otimizações mais recente
// (que vive nessa lista); se não houver, abre o board.
async function goClientTrello(projectId) {
  const c = state.clients.find((x) => x.projectId === projectId);
  if (!c) return;
  if (!c.trelloBoardId) { toast("Vincule o board do Trello deste cliente em ⚙️ Configurações.", true); return; }
  try {
    const list = await window.api.historyList(projectId);
    const withCard = (list || []).filter((h) => h.trello && h.trello.optCardUrl).sort((a, b) => (a.start < b.start ? 1 : -1));
    if (withCard.length) { window.api.openExternal(withCard[0].trello.optCardUrl); return; }
  } catch {}
  window.api.openExternal(`https://trello.com/b/${c.trelloBoardId}`);
}

$("#semConfigBtn").addEventListener("click", () => {
  const box = $("#semConfigBox");
  if (!box.classList.contains("hidden")) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  box.classList.remove("hidden");
  const dayOpts = (sel) => [["", "— sem call —"], [1, "Segunda"], [2, "Terça"], [3, "Quarta"], [4, "Quinta"], [5, "Sexta"]]
    .map(([v, l]) => `<option value="${v}" ${String(sel || "") === String(v) ? "selected" : ""}>${l}</option>`).join("");
  box.innerHTML = `<div class="card" style="margin-bottom:16px;padding:16px">
    <p class="sub" style="margin-bottom:4px">Dia fixo da call de performance de cada cliente. Toda a rotina (PRÉ/CALL/PÓS) é calculada a partir daqui.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-top:12px">
      ${state.clients.map((c) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:8px 12px">
        <span style="font-weight:500;font-size:13.5px">${c.name}</span>
        <select class="sem-day" data-pid="${c.projectId}" style="background:var(--panel);border:1px solid var(--line);border-radius:7px;padding:5px 8px;color:var(--txt);outline:none">${dayOpts(callWeekday(c))}</select>
      </div>`).join("")}
    </div>
    <div style="display:flex;gap:10px;margin-top:14px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-primary" id="semSaveCfg" style="padding:8px 16px">Salvar dias</button>
      <span class="hist-meta">⚠️ Kwik e Alô Promotor ainda não estão no painel — adicione-os em ⚙️ Configurações pra incluí-los na rotina.</span>
    </div>
  </div>`;
  $("#semSaveCfg").addEventListener("click", async () => {
    $$(".sem-day", box).forEach((sel) => {
      const c = state.clients.find((x) => x.projectId === Number(sel.dataset.pid));
      if (c) c.call = { weekday: Number(sel.value) || 0 };
    });
    await window.api.setClients(state.clients);
    box.classList.add("hidden"); box.innerHTML = "";
    renderSemana();
    toast("Dias das calls salvos.");
  });
});

/* preload.cjs — ponte segura entre a UI (renderer) e o processo principal */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // configurações e clientes salvos
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (s) => ipcRenderer.invoke("settings:set", s),
  getClients: () => ipcRenderer.invoke("clients:get"),
  setClients: (c) => ipcRenderer.invoke("clients:set", c),

  // Reportei
  reporteiProjects: (q) => ipcRenderer.invoke("reportei:projects", q),
  reporteiWeekData: (args) => ipcRenderer.invoke("reportei:weekData", args),

  // Relatório estilo Reportei (dado ao vivo + análise + export PDF)
  reportBuild: (args) => ipcRenderer.invoke("report:build", args),
  reportAnalyze: (args) => ipcRenderer.invoke("report:analyzeSection", args),
  reportAnalyzeMetric: (args) => ipcRenderer.invoke("report:analyzeMetric", args),
  reportReviewOptim: (args) => ipcRenderer.invoke("report:reviewOptimizations", args),
  reportExportPdf: (args) => ipcRenderer.invoke("report:exportPdf", args),

  // Trello
  trelloBoards: (q) => ipcRenderer.invoke("trello:boards", q),
  trelloSendWeek: (args) => ipcRenderer.invoke("trello:sendWeek", args),
  trelloDoneCard: (args) => ipcRenderer.invoke("trello:doneCard", args),
  trelloSendCreatives: (args) => ipcRenderer.invoke("trello:sendCreatives", args),
  trelloBudget: (args) => ipcRenderer.invoke("trello:budget", args),
  ekyteTest: () => ipcRenderer.invoke("ekyte:test"),
  ekyteTaskTypes: () => ipcRenderer.invoke("ekyte:taskTypes"),
  ekyteMcpTest: () => ipcRenderer.invoke("ekyte:mcpTest"),
  ekyteCreateTasks: (args) => ipcRenderer.invoke("ekyte:createTasks", args),

  // Gemini
  geminiAnalyze: (args) => ipcRenderer.invoke("gemini:analyze", args),
  geminiReport: (args) => ipcRenderer.invoke("gemini:report", args),
  geminiReportPlatform: (args) => ipcRenderer.invoke("gemini:reportPlatform", args),
  geminiReportFinal: (args) => ipcRenderer.invoke("gemini:reportFinal", args),
  geminiRaw: (args) => ipcRenderer.invoke("gemini:raw", args),
  obsidianClientProfile: (args) => ipcRenderer.invoke("obsidian:clientProfile", args),
  obsidianSaveNote: (args) => ipcRenderer.invoke("obsidian:saveNote", args),
  obsidianVaultFiles: (args) => ipcRenderer.invoke("obsidian:vaultFiles", args),
  obsidianAsk: (args) => ipcRenderer.invoke("obsidian:ask", args),

  // subida de campanhas
  metaTest: () => ipcRenderer.invoke("meta:test"),
  metaPermissions: () => ipcRenderer.invoke("meta:permissions"),
  metaPages: () => ipcRenderer.invoke("meta:pages"),
  uploadMeta: (args) => ipcRenderer.invoke("upload:meta", args),
  uploadGoogle: (args) => ipcRenderer.invoke("upload:google", args),
  googleAdsTest: () => ipcRenderer.invoke("googleads:test"),
  googleAdsConnect: (args) => ipcRenderer.invoke("googleads:connect", args),
  googleAdsAccounts: () => ipcRenderer.invoke("googleads:accounts"),
  googleAdsSearchTerms: (args) => ipcRenderer.invoke("googleads:searchTerms", args),
  googleAdsNegate: (args) => ipcRenderer.invoke("googleads:negate", args),
  googleAdsAddKeywords: (args) => ipcRenderer.invoke("googleads:addKeywords", args),
  googleAdsKeywordVolume: (args) => ipcRenderer.invoke("googleads:keywordVolume", args),
  googleAdsKeywordIdeas: (args) => ipcRenderer.invoke("googleads:keywordIdeas", args),
  gadsPlan: (args) => ipcRenderer.invoke("gads:plan", args),
  gadsAdsFromKeywords: (args) => ipcRenderer.invoke("gads:adsFromKeywords", args),
  gadsCreateSearchDraft: (args) => ipcRenderer.invoke("gads:createSearchDraft", args),
  ga4Sessions: (args) => ipcRenderer.invoke("ga4:sessions", args),

  pageSpeedCheck: (args) => ipcRenderer.invoke("pagespeed:check", args),

  // histórico
  historyList: (projectId) => ipcRenderer.invoke("history:list", projectId),
  historyGet: (id) => ipcRenderer.invoke("history:get", id),
  historySave: (record) => ipcRenderer.invoke("history:save", record),
  historyDelete: (id) => ipcRenderer.invoke("history:delete", id),
  logAction: (a) => ipcRenderer.invoke("action:log", a),
  listActions: (projectId) => ipcRenderer.invoke("action:list", projectId),

  // urgência
  urgencyScan: () => ipcRenderer.invoke("urgency:scan"),

  // qualificação de leads
  leadsSummary: (args) => ipcRenderer.invoke("leads:summary", args),
  leadsHeaders: (sheetUrl) => ipcRenderer.invoke("leads:headers", sheetUrl),
  leadsTest: (cfg) => ipcRenderer.invoke("leads:test", cfg),

  updateCheck: () => ipcRenderer.invoke("update:check"),
  updateApply: (args) => ipcRenderer.invoke("update:apply", args),
  openExternal: (url) => ipcRenderer.invoke("open:external", url),
  readImage: (p) => ipcRenderer.invoke("file:readImage", p),
  openJsonFile: () => ipcRenderer.invoke("dialog:openJson"),

  // motor de IA (Claude pelo seu plano / Gemini)
  aiEngineInfo: () => ipcRenderer.invoke("ai:engineInfo"),

  // GTM — conexão separada do Google Ads
  gtmConnect: (args) => ipcRenderer.invoke("gtm:connect", args),
  gtmContainers: () => ipcRenderer.invoke("gtm:containers"),
  gtmSetup: (args) => ipcRenderer.invoke("gtm:setup", args),
  gtmSmartSetup: (args) => ipcRenderer.invoke("gtm:smartSetup", args),

  // Meta Ads — sessão por cliente
  metaAdAccounts: () => ipcRenderer.invoke("meta:adAccounts"),
  metaCampaigns: (args) => ipcRenderer.invoke("meta:campaigns", args),
  metaToggleCampaign: (args) => ipcRenderer.invoke("meta:toggleCampaign", args),
  metaAdSets: (args) => ipcRenderer.invoke("meta:adSets", args),
  metaToggleAdSet: (args) => ipcRenderer.invoke("meta:toggleAdSet", args),
  metaAds: (args) => ipcRenderer.invoke("meta:ads", args),
  metaToggleAd: (args) => ipcRenderer.invoke("meta:toggleAd", args),

  // Google Ads — sessão por cliente
  gadsCampaigns: (args) => ipcRenderer.invoke("gads:campaigns", args),
  gadsToggleCampaign: (args) => ipcRenderer.invoke("gads:toggleCampaign", args),
  gadsAdGroups: (args) => ipcRenderer.invoke("gads:adGroups", args),
  gadsToggleAdGroup: (args) => ipcRenderer.invoke("gads:toggleAdGroup", args),
  gadsAds: (args) => ipcRenderer.invoke("gads:ads", args),
  gadsToggleAd: (args) => ipcRenderer.invoke("gads:toggleAd", args),
  gadsKeywords: (args) => ipcRenderer.invoke("gads:keywords", args),
  gadsToggleKeyword: (args) => ipcRenderer.invoke("gads:toggleKeyword", args),
  gadsDisplayAds: (args) => ipcRenderer.invoke("gads:displayAds", args),
});

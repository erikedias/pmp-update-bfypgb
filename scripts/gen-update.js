// Gera o update.json (manifesto de atualização) com a versão do package.json
// e a lista de TODOS os arquivos de código que o app baixa ao atualizar (src/ + electron/ + package.json).
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

function walk(dir, base, out) {
  for (const f of fs.readdirSync(dir)) {
    if (f === ".DS_Store") continue;
    const full = path.join(dir, f);
    const rel = base ? base + "/" + f : f;
    if (fs.statSync(full).isDirectory()) walk(full, rel, out);
    else out.push(rel);
  }
}

const files = [];
walk(path.join(ROOT, "src"), "src", files);
walk(path.join(ROOT, "electron"), "electron", files);
files.push("package.json");

const version = require(path.join(ROOT, "package.json")).version;
const notes = process.argv[2] || "";
fs.writeFileSync(path.join(ROOT, "update.json"), JSON.stringify({ version, notes, files }, null, 2) + "\n");
console.log(`update.json gerado · v${version} · ${files.length} arquivos`);

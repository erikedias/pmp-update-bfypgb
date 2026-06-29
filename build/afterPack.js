// Assina o app com assinatura "adhoc" (ad-hoc) depois de empacotar no Mac.
// Sem isso, apps sem certificado pago da Apple aparecem como "danificado" em outros Macs.
// Com a assinatura adhoc, o aviso vira o "leve" (botão direito → Abrir resolve).
const { execSync } = require("child_process");
const path = require("path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  try {
    execSync(`codesign --deep --force --sign - "${app}"`, { stdio: "inherit" });
    console.log("  • assinatura adhoc aplicada em " + app);
  } catch (e) {
    console.warn("  • aviso: não consegui assinar adhoc: " + e.message);
  }
};

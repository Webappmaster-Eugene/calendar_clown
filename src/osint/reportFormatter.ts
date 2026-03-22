/** Format the AI-generated report for Telegram (Markdown V1). */
export function formatReport(report: string, sourcesCount: number): string {
  const header = "🔍 *Результаты OSINT-поиска*\n\n";
  const timestamp = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
  const footer = `\n\n---\n📊 Источников проанализировано: ${sourcesCount}\n🕐 ${timestamp} (МСК)\n📡 Источники: веб-поиск, госреестры, соцсети (Tavily Advanced Search)`;
  return header + report + footer;
}

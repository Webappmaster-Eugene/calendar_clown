/** Format the AI-generated report for Telegram (Markdown V1). */
export function formatReport(report: string, sourcesCount: number, extractedCount: number = 0): string {
  const header = "🔍 *Результаты OSINT-поиска*\n\n";
  const timestamp = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
  const extractedInfo = extractedCount > 0 ? ` | 🔗 Профилей извлечено: ${extractedCount}` : "";
  const footer = `\n\n---\n📊 Источников: ${sourcesCount} (двухфазный поиск)${extractedInfo}\n🕐 ${timestamp} (МСК)\n📡 Источники: веб-поиск, госреестры, соцсети, финансовые реестры, недвижимость (Tavily Advanced Search)`;
  return header + report + footer;
}

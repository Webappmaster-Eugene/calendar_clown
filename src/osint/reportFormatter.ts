/** Format the AI-generated report for Telegram (Markdown V1). */
export function formatReport(report: string, sourcesCount: number): string {
  const header = "🔍 *Результаты OSINT-поиска*\n\n";
  const footer = `\n\n📊 Источников проанализировано: ${sourcesCount}`;
  return header + report + footer;
}

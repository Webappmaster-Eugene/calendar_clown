/** Format the AI-generated report for Telegram (Markdown V1). */
export function formatReport(report: string): string {
  const header = "🔍 *Результаты OSINT-поиска*\n\n";
  return header + report;
}

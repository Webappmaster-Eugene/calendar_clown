import ExcelJS from "exceljs";
import type { CategoryTotal } from "./types.js";
import { monthName } from "./formatter.js";

const TIMEZONE = "Europe/Moscow";

interface ExcelExpenseRow {
  categoryName: string;
  categoryEmoji: string;
  subcategory: string | null;
  amount: number;
  firstName: string;
  createdAt: Date;
}

export async function generateMonthlyExcel(
  categoryTotals: CategoryTotal[],
  detailedRows: ExcelExpenseRow[],
  year: number,
  month: number,
  tribeName: string,
  monthLimit: number
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  // ─── Sheet 1: Summary by categories ───
  const summarySheet = workbook.addWorksheet("Сводка");

  summarySheet.columns = [
    { header: "", width: 5 },
    { header: "Категория", width: 35 },
    { header: "Сумма", width: 18 },
  ];

  // Title
  summarySheet.mergeCells("A1:C1");
  const titleCell = summarySheet.getCell("A1");
  titleCell.value = `Расходы за ${monthName(month)} ${year} — ${tribeName}`;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: "center" };

  // Header row
  const headerRow = summarySheet.getRow(3);
  headerRow.values = ["", "Категория", "Сумма"];
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };
    cell.border = {
      bottom: { style: "thin" },
    };
  });

  let rowIdx = 4;
  let grandTotal = 0;
  for (const ct of categoryTotals) {
    const row = summarySheet.getRow(rowIdx);
    row.values = [ct.categoryEmoji, ct.categoryName, ct.total];
    row.getCell(3).numFmt = "#,##0.00";
    grandTotal += ct.total;
    rowIdx++;
  }

  // Total row
  const totalRow = summarySheet.getRow(rowIdx + 1);
  totalRow.values = ["", "ИТОГО", grandTotal];
  totalRow.font = { bold: true };
  totalRow.getCell(3).numFmt = "#,##0.00";

  // Limit row
  if (monthLimit > 0) {
    const limitRow = summarySheet.getRow(rowIdx + 2);
    limitRow.values = ["", "Лимит", monthLimit];
    limitRow.getCell(3).numFmt = "#,##0.00";
    const diffRow = summarySheet.getRow(rowIdx + 3);
    diffRow.values = ["", "Остаток", monthLimit - grandTotal];
    diffRow.getCell(3).numFmt = "#,##0.00";
    if (grandTotal > monthLimit) {
      diffRow.getCell(3).font = { color: { argb: "FFFF0000" }, bold: true };
    }
  }

  // ─── Sheet 2: Detailed records ───
  if (detailedRows.length > 0) {
    const detailSheet = workbook.addWorksheet("Детали");

    detailSheet.columns = [
      { header: "Дата", width: 18 },
      { header: "Категория", width: 30 },
      { header: "Описание", width: 30 },
      { header: "Сумма", width: 15 },
      { header: "Автор", width: 15 },
    ];

    const detailHeader = detailSheet.getRow(1);
    detailHeader.font = { bold: true };
    detailHeader.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE0E0E0" },
      };
      cell.border = {
        bottom: { style: "thin" },
      };
    });

    for (const row of detailedRows) {
      const dateStr = row.createdAt.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: TIMEZONE,
      });
      const excelRow = detailSheet.addRow([
        dateStr,
        `${row.categoryEmoji} ${row.categoryName}`,
        row.subcategory || "",
        row.amount,
        row.firstName,
      ]);
      excelRow.getCell(4).numFmt = "#,##0.00";
    }

    // Detail total
    const detailTotalRow = detailSheet.addRow([
      "",
      "",
      "ИТОГО",
      grandTotal,
      "",
    ]);
    detailTotalRow.font = { bold: true };
    detailTotalRow.getCell(4).numFmt = "#,##0.00";
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

import ExcelJS from "exceljs";
import type { CategoryTotal } from "./types.js";
import { monthName, monthNameShort } from "./formatter.js";
import { TIMEZONE_MSK } from "../constants.js";

interface ExcelExpenseRow {
  categoryId: number;
  categoryName: string;
  categoryEmoji: string;
  subcategory: string | null;
  amount: number;
  firstName: string;
  createdAt: Date;
}

const HEADER_FILL = {
  type: "pattern" as const,
  pattern: "solid" as const,
  fgColor: { argb: "FFE0E0E0" },
};

const CATEGORY_HEADER_FILL = {
  type: "pattern" as const,
  pattern: "solid" as const,
  fgColor: { argb: "FFF2F2F2" },
};

const MONEY_FMT = "#,##0.00";

function formatMskDateTime(date: Date): string {
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE_MSK,
  });
}

function addDetailedBreakdownSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  categoryTotals: CategoryTotal[],
  detailedRows: ExcelExpenseRow[],
  grandTotal: number
): void {
  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = [
    { header: "Дата", width: 22 },
    { header: "Описание", width: 38 },
    { header: "Сумма", width: 16 },
    { header: "Автор", width: 16 },
  ];

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.border = { bottom: { style: "thin" } };
  });

  const byCategory = new Map<number, ExcelExpenseRow[]>();
  for (const row of detailedRows) {
    const list = byCategory.get(row.categoryId);
    if (list) list.push(row);
    else byCategory.set(row.categoryId, [row]);
  }

  let rowIdx = 2;
  for (const ct of categoryTotals) {
    const ops = byCategory.get(ct.categoryId);
    if (!ops || ops.length === 0) continue;

    sheet.mergeCells(`A${rowIdx}:B${rowIdx}`);
    const titleCell = sheet.getCell(`A${rowIdx}`);
    titleCell.value = `${ct.categoryEmoji} ${ct.categoryName}`;
    titleCell.font = { bold: true };
    titleCell.fill = CATEGORY_HEADER_FILL;

    const sumCell = sheet.getCell(`C${rowIdx}`);
    sumCell.value = ct.total;
    sumCell.numFmt = MONEY_FMT;
    sumCell.font = { bold: true };
    sumCell.fill = CATEGORY_HEADER_FILL;

    sheet.getCell(`D${rowIdx}`).fill = CATEGORY_HEADER_FILL;
    rowIdx++;

    for (const op of ops) {
      const opRow = sheet.getRow(rowIdx);
      opRow.values = [
        `   ${formatMskDateTime(op.createdAt)}`,
        op.subcategory || "",
        op.amount,
        op.firstName,
      ];
      opRow.getCell(3).numFmt = MONEY_FMT;
      rowIdx++;
    }

    rowIdx++;
  }

  const totalRow = sheet.getRow(rowIdx);
  totalRow.values = ["", "ИТОГО", grandTotal, ""];
  totalRow.font = { bold: true };
  totalRow.getCell(3).numFmt = MONEY_FMT;
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

  summarySheet.mergeCells("A1:C1");
  const titleCell = summarySheet.getCell("A1");
  titleCell.value = `Расходы за ${monthName(month)} ${year} — ${tribeName}`;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: "center" };

  const headerRow = summarySheet.getRow(3);
  headerRow.values = ["", "Категория", "Сумма"];
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.border = { bottom: { style: "thin" } };
  });

  let rowIdx = 4;
  let grandTotal = 0;
  for (const ct of categoryTotals) {
    const row = summarySheet.getRow(rowIdx);
    row.values = [ct.categoryEmoji, ct.categoryName, ct.total];
    row.getCell(3).numFmt = MONEY_FMT;
    grandTotal += ct.total;
    rowIdx++;
  }

  const totalRow = summarySheet.getRow(rowIdx + 1);
  totalRow.values = ["", "ИТОГО", grandTotal];
  totalRow.font = { bold: true };
  totalRow.getCell(3).numFmt = MONEY_FMT;

  if (monthLimit > 0) {
    const limitRow = summarySheet.getRow(rowIdx + 2);
    limitRow.values = ["", "Лимит", monthLimit];
    limitRow.getCell(3).numFmt = MONEY_FMT;
    const diffRow = summarySheet.getRow(rowIdx + 3);
    diffRow.values = ["", "Остаток", monthLimit - grandTotal];
    diffRow.getCell(3).numFmt = MONEY_FMT;
    if (grandTotal > monthLimit) {
      diffRow.getCell(3).font = { color: { argb: "FFFF0000" }, bold: true };
    }
  }

  // ─── Sheet 2: Flat list of detailed records (Ctrl+F / autofilter friendly) ───
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
      cell.fill = HEADER_FILL;
      cell.border = { bottom: { style: "thin" } };
    });

    for (const row of detailedRows) {
      const excelRow = detailSheet.addRow([
        formatMskDateTime(row.createdAt),
        `${row.categoryEmoji} ${row.categoryName}`,
        row.subcategory || "",
        row.amount,
        row.firstName,
      ]);
      excelRow.getCell(4).numFmt = MONEY_FMT;
    }

    const detailTotalRow = detailSheet.addRow(["", "", "ИТОГО", grandTotal, ""]);
    detailTotalRow.font = { bold: true };
    detailTotalRow.getCell(4).numFmt = MONEY_FMT;

    // ─── Sheet 3: Hierarchical breakdown (categories with their items inline) ───
    addDetailedBreakdownSheet(
      workbook,
      "Детализация",
      categoryTotals,
      detailedRows,
      grandTotal
    );
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export interface YearlyPivotCell {
  month: number;
  categoryId: number;
  total: number;
}

export async function generateYearlyExcel(
  categoryTotals: CategoryTotal[],
  pivotCells: YearlyPivotCell[],
  detailedRows: ExcelExpenseRow[],
  year: number,
  tribeName: string,
  yearLimit: number
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  // ─── Sheet 1: Yearly pivot ───
  const pivot = workbook.addWorksheet("Сводка года");

  const totalCols = 1 + 1 + 12 + 1;
  pivot.getColumn(1).width = 5;
  pivot.getColumn(2).width = 35;
  for (let m = 1; m <= 12; m++) pivot.getColumn(2 + m).width = 12;
  pivot.getColumn(totalCols).width = 16;

  pivot.mergeCells(1, 1, 1, totalCols);
  const titleCell = pivot.getCell(1, 1);
  titleCell.value = `Расходы за ${year} — ${tribeName}`;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: "center" };

  const headerRow = pivot.getRow(3);
  const headerValues: (string | number)[] = ["", "Категория"];
  for (let m = 1; m <= 12; m++) headerValues.push(monthNameShort(m));
  headerValues.push("Итого");
  headerRow.values = headerValues;
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.border = { bottom: { style: "thin" } };
    cell.alignment = { horizontal: "center" };
  });

  const lookup = new Map<string, number>();
  for (const cell of pivotCells) {
    lookup.set(`${cell.categoryId}:${cell.month}`, cell.total);
  }

  let rowIdx = 4;
  const monthTotals = new Array(13).fill(0);
  let grandTotal = 0;

  for (const ct of categoryTotals) {
    const row = pivot.getRow(rowIdx);
    const values: (string | number)[] = [ct.categoryEmoji, ct.categoryName];
    let rowTotal = 0;
    for (let m = 1; m <= 12; m++) {
      const v = lookup.get(`${ct.categoryId}:${m}`) ?? 0;
      values.push(v);
      rowTotal += v;
      monthTotals[m] += v;
    }
    values.push(rowTotal);
    row.values = values;

    for (let c = 3; c <= totalCols; c++) row.getCell(c).numFmt = MONEY_FMT;
    row.getCell(totalCols).font = { bold: true };

    grandTotal += rowTotal;
    rowIdx++;
  }

  const totalRow = pivot.getRow(rowIdx);
  const totalValues: (string | number)[] = ["", "ИТОГО"];
  for (let m = 1; m <= 12; m++) totalValues.push(monthTotals[m]);
  totalValues.push(grandTotal);
  totalRow.values = totalValues;
  totalRow.font = { bold: true };
  for (let c = 3; c <= totalCols; c++) totalRow.getCell(c).numFmt = MONEY_FMT;
  totalRow.eachCell((cell) => {
    cell.border = { top: { style: "thin" } };
  });
  rowIdx++;

  if (yearLimit > 0) {
    rowIdx++;
    const limitRow = pivot.getRow(rowIdx);
    limitRow.getCell(2).value = "Лимит года";
    limitRow.getCell(totalCols).value = yearLimit;
    limitRow.getCell(totalCols).numFmt = MONEY_FMT;
    rowIdx++;

    const diffRow = pivot.getRow(rowIdx);
    diffRow.getCell(2).value = "Остаток";
    diffRow.getCell(totalCols).value = yearLimit - grandTotal;
    diffRow.getCell(totalCols).numFmt = MONEY_FMT;
    if (grandTotal > yearLimit) {
      diffRow.getCell(totalCols).font = { color: { argb: "FFFF0000" }, bold: true };
    }
  }

  // ─── Sheet 2: Hierarchical breakdown for the whole year ───
  if (detailedRows.length > 0) {
    addDetailedBreakdownSheet(
      workbook,
      "Детализация года",
      categoryTotals,
      detailedRows,
      grandTotal
    );
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

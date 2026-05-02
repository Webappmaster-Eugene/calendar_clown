/**
 * Regression tests for the Excel-export Content-Disposition header.
 *
 * Background: Node's HTTP layer rejects header values containing bytes
 * outside ISO-8859-1 with ERR_INVALID_CHAR. A Cyrillic filename like
 * "Расходы_Апрель_2026.xlsx" used to be passed verbatim to `c.header(...)`,
 * causing a 500 the moment the webapp started sending authenticated
 * requests to /api/expenses/excel (the bot path is unaffected because
 * Telegram's Bot API handles filenames separately).
 *
 * The helper must produce an output that:
 *   1. Contains the ASCII fallback filename for legacy clients.
 *   2. Includes the RFC 5987 `filename*=UTF-8''…` form with the original
 *      filename percent-encoded.
 *   3. Is ASCII-only — every byte must be < 128 so Node accepts it.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildExcelDispositionHeader } from "../src/api/routes/expenses.js";

describe("buildExcelDispositionHeader", () => {
  it("includes the ASCII fallback with zero-padded month", () => {
    const value = buildExcelDispositionHeader("Расходы_Апрель_2026.xlsx", 2026, 4);
    assert.match(value, /filename="expenses-2026-04\.xlsx"/);
  });

  it("includes the RFC 5987 UTF-8 percent-encoded variant", () => {
    const value = buildExcelDispositionHeader("Расходы_Апрель_2026.xlsx", 2026, 4);
    assert.match(value, /filename\*=UTF-8''/);
    // Percent-encoded UTF-8 of "Р" is %D0%A0, "а" is %D0%B0 — anchor on the prefix.
    assert.match(value, /%D0%A0%D0%B0%D1%81%D1%85%D0%BE%D0%B4%D1%8B/);
    assert.ok(
      value.includes(encodeURIComponent("Расходы_Апрель_2026.xlsx")),
      "must contain the full encoded filename"
    );
  });

  it("produces a value that is ASCII-only (Node-safe)", () => {
    const value = buildExcelDispositionHeader("Расходы_Декабрь_2099.xlsx", 2099, 12);
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      assert.ok(code < 128, `non-ASCII byte at index ${i}: U+${code.toString(16)}`);
    }
  });

  it("zero-pads single-digit months", () => {
    const value = buildExcelDispositionHeader("Расходы_Январь_2026.xlsx", 2026, 1);
    assert.match(value, /expenses-2026-01\.xlsx/);
    assert.doesNotMatch(value, /expenses-2026-1\.xlsx/);
  });

  it("handles all-ASCII filenames without breaking", () => {
    const value = buildExcelDispositionHeader("report.xlsx", 2026, 4);
    assert.match(value, /filename="expenses-2026-04\.xlsx"/);
    assert.match(value, /filename\*=UTF-8''report\.xlsx/);
  });
});

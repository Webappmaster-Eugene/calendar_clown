-- Repair merchants recorded before the parser learned to drop T-Bank's routing
-- boilerplate: every SBP/utility payment was stored as "<payee> через СБП на счет
-- RUB", so the label carried more noise than payee and the category matcher had
-- little to match on.
--
-- The rules below mirror TRANSFER_NOISE / stripTransferNoise() in
-- src/expenses/bankPush/parseTinkoffPush.ts, in the same order. \y is Postgres's
-- word boundary and — unlike JS's \b — does fire around Cyrillic, so no lookaround
-- workaround is needed here.
--
-- Scope: only `source = 'bank_push'` rows; hand-entered and voice subcategories are
-- never touched. Guarded by a WHERE that requires the value to actually change, so
-- re-running is a no-op, and by NULLIF so a subcategory made entirely of noise keeps
-- its original text instead of becoming an empty string.
UPDATE expenses AS e
SET subcategory = cleaned.value
FROM (
  SELECT
    id,
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(subcategory, '\y(т-?банк|тинькофф|tinkoff)\y', ' ', 'gi'),
                '\y(через\s+сбп)\y', ' ', 'gi'),
              '\y(на\s+нако[пв][а-яё]*\s+сч[её]т)\y', ' ', 'gi'),
            '\y(на\s+сч[её]т(\s+[a-zа-яё]{3})?)\y', ' ', 'gi'),
          '\y(со\s+сч[её]та)\y', ' ', 'gi'),
        '\y(на\s+карту)\y', ' ', 'gi'),
      '\s{2,}', ' ', 'g')
    ) AS value
  FROM expenses
  WHERE source = 'bank_push' AND subcategory IS NOT NULL
) AS cleaned
WHERE e.id = cleaned.id
  AND NULLIF(cleaned.value, '') IS NOT NULL
  AND e.subcategory IS DISTINCT FROM cleaned.value;

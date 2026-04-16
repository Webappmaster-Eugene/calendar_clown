import { getCategories } from "./repository.js";
import type { Category, ParsedExpense } from "./types.js";

/** Minimum allowed expense amount (aligned with repository validation). */
const MIN_AMOUNT = 1;

/**
 * Parse expense text in format: "Категория [Описание] Сумма"
 * Amount can be anywhere (end, start, or middle).
 * Category is matched by fuzzy search against known categories and aliases,
 * with AI fallback for low-confidence matches.
 */
export async function parseExpenseText(text: string): Promise<ParsedExpense | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const extracted = extractAndRemoveAmount(trimmed);
  if (!extracted) return null;

  const { amount, textWithoutAmount } = extracted;
  if (!textWithoutAmount) return null;

  const categories = await getCategories();
  const match = findCategory(textWithoutAmount, categories);

  // High-confidence fuzzy match — use directly (fast path)
  if (match && match.score >= 40) {
    const subcategory = extractSubcategory(textWithoutAmount, match.matchedText);
    return {
      categoryId: match.category.id,
      categoryName: match.category.name,
      categoryEmoji: match.category.emoji,
      subcategory: subcategory || null,
      amount,
    };
  }

  // Low confidence or no match — try AI categorization
  try {
    const { categorizeExpenseText } = await import("./categorizeWithAI.js");
    const aiResult = await categorizeExpenseText(trimmed, categories);
    if (aiResult) return aiResult;
  } catch {
    // AI failed — fall through to fuzzy fallback
  }

  // Final fallback: use fuzzy match result (low score) or "Другое"
  let finalMatch = match;
  if (!finalMatch) {
    const fallback = categories.find((c) => c.name === "Другое");
    if (!fallback) return null;
    finalMatch = { category: fallback, matchedText: "", score: 0 };
  }

  const subcategory = extractSubcategory(textWithoutAmount, finalMatch.matchedText);
  return {
    categoryId: finalMatch.category.id,
    categoryName: finalMatch.category.name,
    categoryEmoji: finalMatch.category.emoji,
    subcategory: subcategory || null,
    amount,
  };
}

interface AmountExtractionResult {
  amount: number;
  textWithoutAmount: string;
}

/**
 * Pre-process text to normalize amount formats.
 * Expands abbreviations (5к → 5000, 5тыс → 5000) and normalizes comma-separated thousands (5,000 → 5000).
 */
function normalizeAmountFormats(text: string): string {
  return text
    // Abbreviations: 5к, 5K, 5тыс, 1.5к, 1,5к
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:к|k|К|K|тыс\.?)\b/g, (_, num: string) => {
      const n = parseFloat(num.replace(",", "."));
      return String(Math.round(n * 1000));
    })
    // Comma as thousands separator: 5,000 → 5000, 10,000 → 10000
    // Only when exactly 3 digits follow the comma (not 1-2 digits = decimal)
    .replace(/(\d{1,3}),(\d{3})(?!\d)/g, "$1$2");
}

/**
 * Extract amount and remove it from text in a single coordinated pass.
 * Handles: "5000", "5 000", "5000.50", "5,000", "5к", "5тыс", "500₽", "500 руб"
 * Returns the amount and remaining text, or null if no valid amount found.
 */
function extractAndRemoveAmount(text: string): AmountExtractionResult | null {
  const normalized = normalizeAmountFormats(text);

  // Patterns in order of preference: end-of-string first, then start, then anywhere
  const patterns: RegExp[] = [
    // End: multi-digit with spaces, optional currency suffix
    /(\d[\d\s]*[\d](?:[.,]\d{1,2})?)\s*(?:р(?:уб)?\.?|₽)?\s*$/,
    // End: simple number, optional currency suffix
    /(\d+(?:[.,]\d{1,2})?)\s*(?:р(?:уб)?\.?|₽)?\s*$/,
    // Start: multi-digit with spaces
    /^(\d[\d\s]*[\d](?:[.,]\d{1,2})?)\s+/,
    // Start: simple number followed by space
    /^(\d+(?:[.,]\d{1,2})?)\s+/,
    // Anywhere: multi-digit with spaces (not followed by decimal)
    /(\d[\d\s]*\d)(?![.,]\d)/,
    // Anywhere: any standalone number
    /(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match != null && match.index !== undefined) {
      const raw = match[1].replace(/\s/g, "").replace(",", ".");
      const num = parseFloat(raw);
      if (!isNaN(num) && num >= MIN_AMOUNT) {
        const before = normalized.slice(0, match.index);
        const after = normalized.slice(match.index + match[0].length);
        return {
          amount: num,
          textWithoutAmount: (before + " " + after).replace(/\s+/g, " ").trim(),
        };
      }
    }
  }

  return null;
}

interface CategoryMatch {
  category: Category;
  matchedText: string;
  score: number;
}

/**
 * Find the best matching category using aliases and fuzzy prefix matching.
 */
function findCategory(text: string, categories: Category[]): CategoryMatch | null {
  const normalized = text.toLowerCase().trim();
  let bestMatch: CategoryMatch | null = null;

  for (const cat of categories) {
    const allNames = [cat.name.toLowerCase(), ...cat.aliases.map((a) => a.toLowerCase())];

    for (const alias of allNames) {
      // Exact match
      if (normalized === alias || normalized.startsWith(alias + " ") || normalized.startsWith(alias)) {
        const score = alias.length * 10 + (normalized === alias ? 100 : 0);
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { category: cat, matchedText: alias, score };
        }
      }

      // Check if text starts with the alias (prefix match)
      if (normalized.startsWith(alias)) {
        const score = alias.length * 8;
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { category: cat, matchedText: alias, score };
        }
      }

      // Check first word match
      const firstWord = normalized.split(/\s+/)[0];
      if (firstWord === alias || alias.startsWith(firstWord)) {
        const score = firstWord.length * 5;
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { category: cat, matchedText: firstWord, score };
        }
      }

      // Levenshtein for typos (only for short aliases)
      if (alias.length <= 15) {
        const firstWords = normalized.split(/\s+/).slice(0, 2).join(" ");
        const dist = levenshtein(firstWords, alias);
        const maxDist = Math.floor(alias.length * 0.3);
        if (dist <= maxDist && dist < alias.length) {
          const score = (alias.length - dist) * 3;
          if (!bestMatch || score > bestMatch.score) {
            bestMatch = { category: cat, matchedText: firstWords, score };
          }
        }
      }
    }
  }

  return bestMatch;
}

/**
 * Extract subcategory text (everything between category and amount).
 */
function extractSubcategory(textWithoutAmount: string, matchedCategoryText: string): string {
  const normalized = textWithoutAmount.toLowerCase();
  const idx = normalized.indexOf(matchedCategoryText.toLowerCase());
  if (idx === -1) return textWithoutAmount;
  const after = textWithoutAmount.substring(idx + matchedCategoryText.length).trim();
  return after;
}

/**
 * Levenshtein distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  const dp: number[][] = Array.from({ length: la + 1 }, () => Array(lb + 1).fill(0) as number[]);
  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[la][lb];
}

/**
 * Parse multiple expenses from a single message.
 * Splits by newlines, parses each line independently.
 * Returns array of parsed expenses (skips unparseable lines).
 */
export async function parseMultipleExpenses(text: string): Promise<ParsedExpense[]> {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return [];

  const results: ParsedExpense[] = [];
  for (const line of lines) {
    const parsed = await parseExpenseText(line);
    if (parsed) {
      results.push(parsed);
    }
  }
  return results;
}

/**
 * Get formatted categories list for display.
 */
export async function getCategoriesList(): Promise<string> {
  const categories = await getCategories();
  return categories
    .map((c) => `${c.emoji} ${c.name}`)
    .join("\n");
}

/**
 * Get formatted categories list WITH aliases for AI prompts.
 * Format: "- CategoryName (aliases: alias1, alias2)"
 */
export async function getCategoriesListWithAliases(): Promise<string> {
  const categories = await getCategories();
  return categories
    .map((c) => {
      const aliasStr = c.aliases.length > 0
        ? ` (aliases: ${c.aliases.join(", ")})`
        : "";
      return `- ${c.name}${aliasStr}`;
    })
    .join("\n");
}

import { getCategories } from "./repository.js";
import type { Category, ParsedExpense } from "./types.js";

/**
 * Parse expense text in format: "Категория [Описание] Сумма"
 * Amount can be anywhere but is typically at the end.
 * Category is matched by fuzzy search against known categories and aliases.
 */
export async function parseExpenseText(text: string): Promise<ParsedExpense | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const amount = extractAmount(trimmed);
  if (amount === null) return null;

  const textWithoutAmount = removeAmount(trimmed).trim();
  if (!textWithoutAmount) return null;

  const categories = await getCategories();
  let match = findCategory(textWithoutAmount, categories);
  if (!match) {
    const fallback = categories.find((c) => c.name === "Другое");
    if (fallback) {
      match = { category: fallback, matchedText: "", score: 0 };
    } else {
      return null;
    }
  }

  const subcategory = extractSubcategory(textWithoutAmount, match.matchedText);

  return {
    categoryId: match.category.id,
    categoryName: match.category.name,
    categoryEmoji: match.category.emoji,
    subcategory: subcategory || null,
    amount,
  };
}

/**
 * Extract the numeric amount from text.
 * Handles formats: "5000", "5 000", "5000.50", "5000,50"
 * Takes the last number found in the text.
 */
function extractAmount(text: string): number | null {
  const patterns = [
    /(\d[\d\s]*[\d](?:[.,]\d{1,2})?)\s*(?:р(?:уб)?\.?|₽)?\s*$/,
    /(\d+(?:[.,]\d{1,2})?)\s*(?:р(?:уб)?\.?|₽)?\s*$/,
    /(\d[\d\s]*\d)(?![.,]\d)/,
    /(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const raw = match[1].replace(/\s/g, "").replace(",", ".");
      const num = parseFloat(raw);
      if (!isNaN(num) && num > 0) return num;
    }
  }
  return null;
}

/**
 * Remove the amount (last number) from text.
 */
function removeAmount(text: string): string {
  return text
    .replace(/\s*(\d[\d\s]*[\d](?:[.,]\d{1,2})?)\s*(?:р(?:уб)?\.?|₽)?\s*$/, "")
    .replace(/\s*(\d+(?:[.,]\d{1,2})?)\s*(?:р(?:уб)?\.?|₽)?\s*$/, "")
    .trim();
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

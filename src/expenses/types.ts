export interface Category {
  id: number;
  name: string;
  emoji: string;
  aliases: string[];
  sortOrder: number;
  isActive: boolean;
}

export interface Expense {
  id: number;
  userId: number;
  tribeId: number;
  categoryId: number;
  subcategory: string | null;
  amount: number;
  inputMethod: "text" | "voice";
  createdAt: Date;
}

export interface ExpenseWithCategory extends Expense {
  categoryName: string;
  categoryEmoji: string;
}

export interface CategoryTotal {
  categoryId: number;
  categoryName: string;
  categoryEmoji: string;
  total: number;
  sortOrder: number;
}

export interface UserTotal {
  userId: number;
  firstName: string;
  total: number;
}

export interface MonthComparison {
  categoryId: number;
  categoryName: string;
  categoryEmoji: string;
  sortOrder: number;
  prevTotal: number;
  currTotal: number;
  diff: number;
}

export interface DbUser {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
  role: "admin" | "user";
  tribeId: number | null;
}

export interface ParsedExpense {
  categoryId: number;
  categoryName: string;
  categoryEmoji: string;
  subcategory: string | null;
  amount: number;
}

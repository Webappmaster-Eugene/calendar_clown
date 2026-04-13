/**
 * Mock API responses for E2E tests.
 * All data is in Russian to match real app usage.
 */

export const MOCK_USER_PROFILE = {
  telegramId: 123456789,
  firstName: "Тестов",
  lastName: "Тест",
  username: "testuser",
  isAdmin: false,
  tribeName: "Тестовый трайб",
  hasGoogleAuth: true,
  availableModes: [
    "calendar", "expenses", "transcribe", "simplifier", "gandalf",
    "goals", "reminders", "wishlist", "notable_dates", "digest",
    "neuro", "osint", "tasks", "summarizer", "blogger", "nutritionist",
  ],
};

export const MOCK_CATEGORIES = [
  { id: 1, name: "Продукты", emoji: "🛒", sortOrder: 1 },
  { id: 2, name: "Здоровье", emoji: "🏥", sortOrder: 2 },
  { id: 3, name: "Маркетплейсы и подарки", emoji: "🎁", sortOrder: 3 },
  { id: 4, name: "Кафе, доставка, фастфуд", emoji: "🍔", sortOrder: 4 },
  { id: 5, name: "Транспорт", emoji: "🚗", sortOrder: 5 },
  { id: 6, name: "Одежда", emoji: "👔", sortOrder: 6 },
  { id: 7, name: "Развлечения", emoji: "🎬", sortOrder: 7 },
  { id: 8, name: "ЖКХ", emoji: "🏠", sortOrder: 8 },
];

export const MOCK_EXPENSE_REPORT = {
  month: "2026-04",
  byCategory: [
    { categoryId: 1, categoryName: "Продукты", categoryEmoji: "🛒", total: 3300, sortOrder: 1 },
    { categoryId: 2, categoryName: "Здоровье", categoryEmoji: "🏥", total: 0, sortOrder: 2 },
    { categoryId: 3, categoryName: "Маркетплейсы и подарки", categoryEmoji: "🎁", total: 2000, sortOrder: 3 },
    { categoryId: 4, categoryName: "Кафе, доставка, фастфуд", categoryEmoji: "🍔", total: 3150, sortOrder: 4 },
    { categoryId: 5, categoryName: "Транспорт", categoryEmoji: "🚗", total: 1200, sortOrder: 5 },
  ],
  byUser: [
    { userId: 1, firstName: "Тестов", total: 6500 },
    { userId: 2, firstName: "Аня", total: 3150 },
  ],
  total: 9650,
  monthlyLimit: 350000,
  comparison: [
    { categoryId: 1, categoryName: "Продукты", categoryEmoji: "🛒", sortOrder: 1, prevTotal: 8680, currTotal: 3300, diff: -5380 },
    { categoryId: 2, categoryName: "Здоровье", categoryEmoji: "🏥", sortOrder: 2, prevTotal: 6800, currTotal: 0, diff: -6800 },
    { categoryId: 3, categoryName: "Маркетплейсы и подарки", categoryEmoji: "🎁", sortOrder: 3, prevTotal: 0, currTotal: 2000, diff: 2000 },
    { categoryId: 4, categoryName: "Кафе, доставка, фастфуд", categoryEmoji: "🍔", sortOrder: 4, prevTotal: 15640, currTotal: 3150, diff: -12490 },
    { categoryId: 5, categoryName: "Транспорт", categoryEmoji: "🚗", sortOrder: 5, prevTotal: 4200, currTotal: 1200, diff: -3000 },
  ],
  comparisonDay: 13,
};

export const MOCK_NOTABLE_DATES = [
  { id: 1, name: "Данильченко Диман", date: "04-01", type: "birthday", location: "Москва" },
  { id: 2, name: "Благовещение Пресвятой Богородицы", date: "04-07", type: "holiday", location: null },
  { id: 3, name: "Ариан Шапиро", date: "04-08", type: "birthday", location: null },
  { id: 4, name: "Кудрин Илюха", date: "04-09", type: "birthday", location: "Кызыл 97" },
  { id: 5, name: "Горолёв Серёга", date: "04-13", type: "birthday", location: "УШДС" },
];

export const MOCK_TRANSCRIPTIONS = {
  items: [
    {
      id: 1,
      status: "done",
      text: "Тестовая транскрипция голосового сообщения для проверки интерфейса.",
      createdAt: "2026-04-13T10:30:00.000Z",
      duration: 15,
    },
    {
      id: 2,
      status: "done",
      text: "Вторая запись — проверка списка.",
      createdAt: "2026-04-12T08:00:00.000Z",
      duration: 5,
    },
  ],
  total: 2,
};

export const MOCK_SIMPLIFICATIONS = {
  items: [
    {
      id: 1,
      originalText: "Ну типа вот значит мы это вот как бы решили что нужно сделать рефакторинг.",
      simplifiedText: "Мы решили, что нужно сделать рефакторинг.",
      createdAt: "2026-04-13T09:00:00.000Z",
    },
  ],
  total: 1,
};

export const MOCK_COMPARISON_DRILLDOWN = {
  categoryName: "Продукты",
  categoryEmoji: "🛒",
  prevExpenses: [
    { id: 101, subcategory: "Молоко", amount: 120, firstName: "Тестов", createdAt: "2026-03-05T10:00:00.000Z" },
    { id: 102, subcategory: "Хлеб", amount: 80, firstName: "Аня", createdAt: "2026-03-03T12:00:00.000Z" },
  ],
  currExpenses: [
    { id: 201, subcategory: "Молоко", amount: 130, firstName: "Тестов", createdAt: "2026-04-10T10:00:00.000Z" },
    { id: 202, subcategory: "Яйца", amount: 150, firstName: "Тестов", createdAt: "2026-04-08T09:00:00.000Z" },
    { id: 203, subcategory: "Сыр", amount: 340, firstName: "Аня", createdAt: "2026-04-06T14:00:00.000Z" },
  ],
  prevCount: 2,
  currCount: 3,
  comparisonDay: 13,
};

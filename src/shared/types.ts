/**
 * Shared types between backend API and frontend Mini App.
 * Only types needed for API request/response contracts belong here.
 * Internal backend-only types stay in their respective modules.
 */

// ─── Generic API ──────────────────────────────────────────────

export interface ApiResponse<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: string;
  code?: string;
}

export type ApiResult<T> = ApiResponse<T> | ApiError;

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// ─── User & Auth ──────────────────────────────────────────────

export type UserRole = "admin" | "user";
export type UserStatus = "pending" | "approved";

export type UserMode =
  | "calendar"
  | "expenses"
  | "transcribe"
  | "simplifier"
  | "digest"
  | "broadcast"
  | "notable_dates"
  | "gandalf"
  | "neuro"
  | "wishlist"
  | "goals"
  | "reminders"
  | "osint"
  | "summarizer"
  | "blogger"
  | "admin"
  | "tasks";

export interface UserProfile {
  telegramId: number;
  username: string | null;
  firstName: string;
  role: UserRole;
  status: UserStatus;
  mode: UserMode;
  hasTribe: boolean;
  tribeId: number | null;
  tribeName: string | null;
  hasCalendarLinked: boolean;
}

// ─── Calendar ─────────────────────────────────────────────────

export interface CalendarEventDto {
  id: string;
  summary: string;
  start: string;
  end: string;
  htmlLink?: string;
  recurringEventId?: string;
}

export type CalendarEventInputMethod = "text" | "voice";
export type CalendarEventStatus = "created" | "deleted" | "failed";

export interface CalendarEventRecordDto {
  id: number;
  googleEventId: string | null;
  summary: string;
  description: string | null;
  startTime: string;
  endTime: string;
  recurrence: string[] | null;
  inputMethod: CalendarEventInputMethod;
  status: CalendarEventStatus;
  htmlLink: string | null;
  createdAt: string;
}

export interface CalendarIntentEvent {
  title: string;
  startISO: string;
  endISO: string;
  recurrence?: string[];
}

export interface CreateEventRequest {
  /** Natural language text — parsed via chrono-node (for typed input). */
  text?: string;
  /** Pre-extracted intent from LLM — bypasses chrono-node (for voice input). */
  intent?: {
    events: CalendarIntentEvent[];
  };
}

export interface CreateEventResponse {
  event: CalendarEventDto;
  savedToDb: boolean;
}

// ─── Voice ────────────────────────────────────────────────────

export type VoiceIntentType = "calendar" | "cancel_event" | "list_today" | "list_week" | "unknown";

export interface VoiceExtractIntentResponse {
  transcript: string;
  intent: {
    type: VoiceIntentType;
    events?: CalendarIntentEvent[];
    cancelQuery?: string;
    cancelDate?: string | null;
  };
}

export interface VoiceTranscribeResponse {
  transcript: string;
  intent?: {
    type: VoiceIntentType;
    events?: CalendarEventDto[];
    cancelledEventId?: string;
    eventsList?: CalendarEventDto[];
  };
}

// ─── Expenses ─────────────────────────────────────────────────

export interface CategoryDto {
  id: number;
  name: string;
  emoji: string;
  sortOrder: number;
}

export interface ExpenseDto {
  id: number;
  categoryId: number;
  categoryName: string;
  categoryEmoji: string;
  subcategory: string | null;
  amount: number;
  inputMethod: "text" | "voice";
  createdAt: string;
}

export interface CategoryTotalDto {
  categoryId: number;
  categoryName: string;
  categoryEmoji: string;
  total: number;
  sortOrder: number;
}

export interface UserTotalDto {
  userId: number;
  firstName: string;
  total: number;
}

export interface MonthComparisonDto {
  categoryId: number;
  categoryName: string;
  categoryEmoji: string;
  sortOrder: number;
  prevTotal: number;
  currTotal: number;
  diff: number;
}

export interface ExpenseReportDto {
  month: string;
  byCategory: CategoryTotalDto[];
  byUser: UserTotalDto[];
  total: number;
  monthlyLimit: number;
  comparison: MonthComparisonDto[];
}

export interface AddExpenseRequest {
  categoryId: number;
  amount: number;
  subcategory?: string;
}

export interface UpdateExpenseRequest {
  amount?: number;
  categoryId?: number;
  subcategory?: string | null;
}

// ─── Gandalf (Knowledge Base) ─────────────────────────────────

export interface GandalfCategoryDto {
  id: number;
  name: string;
  emoji: string;
  isActive: boolean;
  totalEntries?: number;
  totalPrice?: number | null;
}

export interface GandalfEntryDto {
  id: number;
  categoryId: number;
  categoryName: string;
  categoryEmoji: string;
  title: string;
  price: number | null;
  addedByName: string;
  nextDate: string | null;
  additionalInfo: string | null;
  inputMethod: string;
  isImportant: boolean;
  isUrgent: boolean;
  visibility: "tribe" | "private";
  createdAt: string;
  files: GandalfFileDto[];
}

export interface GandalfFileDto {
  id: number;
  fileType: string;
  fileName: string | null;
}

export interface CreateGandalfEntryRequest {
  categoryId: number;
  title: string;
  price?: number;
  nextDate?: string;
  additionalInfo?: string;
  isImportant?: boolean;
  isUrgent?: boolean;
  visibility?: "tribe" | "private";
}

export interface UpdateGandalfEntryRequest {
  title?: string;
  price?: number | null;
  nextDate?: string | null;
  additionalInfo?: string | null;
  isImportant?: boolean;
  isUrgent?: boolean;
  visibility?: "tribe" | "private";
  categoryId?: number;
}

export interface UpdateGandalfCategoryRequest {
  name?: string;
  emoji?: string;
}

// ─── Goals ────────────────────────────────────────────────────

export type GoalPeriod = "current" | "month" | "year" | "5years";
export type GoalSetVisibility = "public" | "private";

export interface GoalSetDto {
  id: number;
  name: string;
  emoji: string;
  period: GoalPeriod;
  visibility: GoalSetVisibility;
  deadline: string | null;
  completedCount: number;
  totalCount: number;
  createdAt: string;
}

export interface GoalDto {
  id: number;
  goalSetId: number;
  text: string;
  isCompleted: boolean;
  completedAt: string | null;
  createdAt: string;
}

export interface CreateGoalSetRequest {
  name: string;
  emoji?: string;
  period: GoalPeriod;
  visibility?: GoalSetVisibility;
  deadline?: string;
}

export interface CreateGoalRequest {
  goalSetId: number;
  text: string;
}

export interface UpdateGoalRequest {
  text: string;
}

// ─── Reminders ────────────────────────────────────────────────

export interface ReminderScheduleDto {
  times: string[];
  weekdays: number[];
  endDate: string | null;
}

export interface ReminderDto {
  id: number;
  text: string;
  schedule: ReminderScheduleDto;
  isActive: boolean;
  lastFiredAt: string | null;
  createdAt: string;
  subscribers: ReminderSubscriberDto[];
}

export interface ReminderSubscriberDto {
  id: number;
  subscriberName: string;
}

export interface CreateReminderRequest {
  text: string;
  schedule: ReminderScheduleDto;
}

// ─── Wishlist ─────────────────────────────────────────────────

export interface WishlistDto {
  id: number;
  name: string;
  emoji: string;
  ownerName: string;
  itemCount: number;
  isOwn: boolean;
  createdAt: string;
}

export interface WishlistItemDto {
  id: number;
  wishlistId: number;
  title: string;
  description: string | null;
  link: string | null;
  priority: number;
  isReserved: boolean;
  reservedByName: string | null;
  canUnreserve: boolean;
  files: WishlistFileDto[];
  createdAt: string;
}

export interface WishlistFileDto {
  id: number;
  fileType: string;
  fileName: string | null;
}

export interface CreateWishlistRequest {
  name: string;
  emoji?: string;
}

export interface CreateWishlistItemRequest {
  wishlistId: number;
  title: string;
  description?: string;
  link?: string;
  priority?: number;
}

export interface UpdateWishlistItemRequest {
  title?: string;
  description?: string | null;
  link?: string | null;
  priority?: number;
}

// ─── Notable Dates ────────────────────────────────────────────

export interface NotableDateDto {
  id: number;
  name: string;
  dateMonth: number;
  dateDay: number;
  eventType: string;
  description: string | null;
  emoji: string;
  isPriority: boolean;
  isActive: boolean;
}

export interface CreateNotableDateRequest {
  name: string;
  dateMonth: number;
  dateDay: number;
  eventType?: string;
  description?: string;
  emoji?: string;
  isPriority?: boolean;
}

// ─── Digest ───────────────────────────────────────────────────

export interface DigestRubricDto {
  id: number;
  name: string;
  description: string | null;
  emoji: string | null;
  keywords: string[];
  isActive: boolean;
  channelCount?: number;
  lastRunAt?: string | null;
}

export interface DigestChannelDto {
  id: number;
  rubricId: number;
  channelUsername: string;
  channelTitle: string | null;
  subscriberCount: number | null;
  isActive: boolean;
}

export type DigestRunStatus = "pending" | "running" | "completed" | "failed";

export interface DigestRunDto {
  id: number;
  rubricId: number;
  status: DigestRunStatus;
  channelsParsed: number;
  postsFound: number;
  postsSelected: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface DigestPostDto {
  id: number;
  channelUsername: string;
  channelTitle: string | null;
  messageUrl: string | null;
  summary: string | null;
  postDate: string;
  views: number;
  forwards: number;
  engagementScore: number;
}

export interface CreateRubricRequest {
  name: string;
  description?: string;
  emoji?: string;
  keywords: string[];
}

export interface UpdateRubricRequest {
  name?: string;
  description?: string | null;
  emoji?: string | null;
  keywords?: string[];
}

// ─── OSINT ────────────────────────────────────────────────────

export type OsintStatus = "pending" | "searching" | "analyzing" | "completed" | "failed";

export interface OsintSearchDto {
  id: number;
  query: string;
  status: OsintStatus;
  report: string | null;
  sourcesCount: number;
  inputMethod: "text" | "voice";
  errorMessage: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface StartOsintSearchRequest {
  query: string;
}

// ─── Chat (Neuro) ─────────────────────────────────────────────

export type ChatProvider = "free" | "paid";

export interface ChatDialogDto {
  id: number;
  title: string;
  isActive: boolean;
  messageCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageDto {
  id: number;
  dialogId: number;
  role: "user" | "assistant";
  content: string;
  modelUsed?: string;
  createdAt: string;
}

export interface SendChatMessageRequest {
  dialogId?: number;
  content: string;
}

export interface SendChatMessageResponse {
  dialogId: number;
  userMessage: ChatMessageDto;
  assistantMessage: ChatMessageDto;
}

// ─── Transcribe ───────────────────────────────────────────────

export type TranscriptionStatus = "pending" | "processing" | "completed" | "failed";

export interface TranscriptionDto {
  id: number;
  durationSeconds: number;
  forwardedFromName: string | null;
  transcript: string | null;
  status: TranscriptionStatus;
  errorMessage: string | null;
  isDelivered: boolean;
  createdAt: string;
  transcribedAt: string | null;
}

export interface TranscribeQueueStatusDto {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

// ─── Summarizer ───────────────────────────────────────────────

export interface WorkplaceDto {
  id: number;
  title: string;
  company: string | null;
  isActive: boolean;
  achievementCount: number;
  createdAt: string;
}

export interface WorkAchievementDto {
  id: number;
  workplaceId: number;
  text: string;
  inputMethod: string;
  createdAt: string;
}

export interface CreateWorkplaceRequest {
  title: string;
  company?: string;
}

export interface AddAchievementRequest {
  workplaceId: number;
  text: string;
}

export interface UpdateWorkplaceRequest {
  title?: string;
  company?: string | null;
}

export interface UpdateAchievementRequest {
  text: string;
}

export interface SummaryDto {
  workplaceId: number;
  summary: string;
  achievementCount: number;
}

// ─── Blogger ──────────────────────────────────────────────────

export interface BloggerChannelDto {
  id: number;
  channelUsername: string | null;
  channelTitle: string;
  nicheDescription: string | null;
  isActive: boolean;
  postCount: number;
  createdAt: string;
}

export interface BloggerPostDto {
  id: number;
  channelId: number;
  topic: string;
  status: string;
  generatedText: string | null;
  sourceCount: number;
  createdAt: string;
  generatedAt: string | null;
}

export interface BloggerSourceDto {
  id: number;
  postId: number;
  sourceType: string;
  title: string | null;
  content: string;
}

export interface CreateBloggerChannelRequest {
  channelTitle: string;
  channelUsername?: string;
  nicheDescription?: string;
}

export interface UpdateBloggerChannelRequest {
  channelTitle?: string;
  channelUsername?: string | null;
  nicheDescription?: string | null;
}

export interface CreateBloggerPostRequest {
  channelId: number;
  topic: string;
}

// ─── Broadcast ────────────────────────────────────────────────

export interface SendBroadcastRequest {
  text: string;
}

export interface BroadcastResultDto {
  sent: number;
  failed: number;
}

// ─── Admin ────────────────────────────────────────────────────

export interface AdminUserDto {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
  role: UserRole;
  status: UserStatus;
  mode: UserMode;
  tribeId: number | null;
  tribeName: string | null;
  createdAt: string;
}

export interface TribeDto {
  id: number;
  name: string;
  monthlyLimit: number;
  memberCount: number;
  createdAt: string;
}

export interface AdminStatsDto {
  totalUsers: number;
  approvedUsers: number;
  pendingUsers: number;
  totalTribes: number;
  totalExpenses: number;
  totalCalendarEvents: number;
  totalTranscriptions: number;
}

// ─── Admin Summary Analytics ─────────────────────────────────

export type SummaryPeriod = "today" | "yesterday" | "week" | "month" | "year";

export interface SummaryPeriodRange {
  from: string;
  to: string;
  label: string;
}

export interface SummaryCategoryStat {
  name: string;
  emoji: string;
  count: number;
  amount: number;
}

export interface SummaryUserCount {
  firstName: string;
  count: number;
}

export interface SummaryUserExpense {
  firstName: string;
  count: number;
  amount: number;
}

export interface SummaryUserCalendar {
  firstName: string;
  created: number;
  deleted: number;
}

export interface UsageSummaryDto {
  period: SummaryPeriodRange;
  expenses: {
    count: number;
    totalAmount: number;
    textCount: number;
    voiceCount: number;
    categories: SummaryCategoryStat[];
    perUser: SummaryUserExpense[];
  };
  calendarEvents: {
    created: number;
    deleted: number;
    textCount: number;
    voiceCount: number;
    perUser: SummaryUserCalendar[];
  };
  transcriptions: { total: number; errors: number; perUser: SummaryUserCount[] };
  actionLogs: Array<{ action: string; count: number }>;
  gandalfEntries: { count: number; categories: Array<{ name: string; count: number }> };
  chatMessages: { count: number; perUser: SummaryUserCount[] };
  digestRuns: { count: number; postsFound: number };
  wishlistItems: { count: number };
  goals: { created: number; completed: number };
  notableDates: { count: number };
}

// ─── Admin Data Editing ──────────────────────────────────────

export interface EntityEditField {
  key: string;
  label: string;
  type: "number" | "text";
}

export interface EntityMetaDto {
  key: string;
  emoji: string;
  label: string;
  editable: boolean;
  editFields: EntityEditField[];
}

// ─── Tasks ───────────────────────────────────────────────────

export interface TaskWorkDto {
  id: number;
  name: string;
  emoji: string;
  isArchived: boolean;
  activeCount: number;
  completedCount: number;
  createdAt: string;
}

export interface TaskItemDto {
  id: number;
  workId: number;
  text: string;
  deadline: string;
  isCompleted: boolean;
  completedAt: string | null;
  inputMethod: string;
  createdAt: string;
}

export interface CreateTaskWorkRequest {
  name: string;
  emoji?: string;
}

export interface CreateTaskItemRequest {
  text: string;
  deadline: string;
}

export interface UpdateTaskDeadlineRequest {
  deadline: string;
}

// ─── Paginated Response Types ────────────────────────────────

/** Response from GET /api/wishlist — own + tribe wishlists */
export interface WishlistsListResponse {
  own: WishlistDto[];
  tribe: WishlistDto[];
}

/** Response from GET /api/osint — paginated search history */
export interface OsintSearchHistoryResponse {
  searches: OsintSearchDto[];
  total: number;
}

/** Response from GET /api/transcribe — paginated transcription history */
export interface TranscribeHistoryResponse {
  transcriptions: TranscriptionDto[];
  total: number;
}

// ─── Simplifier ──────────────────────────────────────────────

export type SimplificationInputType = "text" | "voice" | "mixed";
export type SimplificationStatus = "pending" | "processing" | "completed" | "failed";

export interface SimplificationDto {
  id: number;
  inputType: SimplificationInputType;
  originalText: string;
  simplifiedText: string | null;
  status: SimplificationStatus;
  errorMessage: string | null;
  createdAt: string;
  simplifiedAt: string | null;
}

export interface SimplifierHistoryResponse {
  simplifications: SimplificationDto[];
  total: number;
}

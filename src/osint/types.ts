export interface OsintParsedSubject {
  name: string;
  lastName?: string;
  firstName?: string;
  patronymic?: string;
  inn?: string;
  snils?: string;
  isProfessionalTech?: boolean;
  aliases?: string[];
  phone?: string;
  email?: string;
  city?: string;
  company?: string;
  socialMedia?: string[];
  searchType: "person" | "company" | "phone" | "email" | "general";
}

export type OsintStatus = "pending" | "searching" | "analyzing" | "completed" | "failed";

export interface OsintSearch {
  id: number;
  userId: number;
  query: string;
  parsedSubject: OsintParsedSubject | null;
  status: OsintStatus;
  searchQueries: string[] | null;
  rawResults: TavilyResult[] | null;
  report: string | null;
  sourcesCount: number;
  inputMethod: "text" | "voice";
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
  raw_content?: string;
}

export interface TavilyExtractResult {
  url: string;
  raw_content: string;
}

export interface TavilyExtractResponse {
  results: TavilyExtractResult[];
  failed_results?: Array<{ url: string; error: string }>;
}

export interface IntermediateAnalysis {
  followUpQueries: string[];
  profileUrls: string[];
  discoveredEntities: string[];
  keyFindings: string;
}

export interface TavilyImage {
  url: string;
  description?: string;
}

export interface TavilySearchResponse {
  results: TavilyResult[];
  images?: TavilyImage[];
  query: string;
}

export interface DigestRubric {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  emoji: string | null;
  keywords: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DigestChannel {
  id: number;
  rubricId: number;
  channelUsername: string;
  channelTitle: string | null;
  subscriberCount: number | null;
  isActive: boolean;
  addedAt: Date;
}

export type DigestRunStatus = "pending" | "running" | "completed" | "failed";

export interface DigestRun {
  id: number;
  userId: number;
  rubricId: number;
  status: DigestRunStatus;
  channelsParsed: number;
  postsFound: number;
  postsSelected: number;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export interface DigestPost {
  id: number;
  runId: number;
  rubricId: number;
  userId: number;
  channelUsername: string;
  channelTitle: string | null;
  telegramMessageId: number;
  messageUrl: string | null;
  originalText: string | null;
  summary: string | null;
  postDate: Date;
  views: number;
  forwards: number;
  reactionsCount: number;
  commentsCount: number;
  engagementScore: number;
  isFromTrackedChannel: boolean;
  createdAt: Date;
}

export interface CreateRubricParams {
  userId: number;
  name: string;
  description: string | null;
  emoji: string | null;
  keywords: string[];
}

export interface RawChannelPost {
  channelUsername: string;
  channelTitle: string | null;
  messageId: number;
  text: string;
  date: Date;
  views: number;
  forwards: number;
  reactionsCount: number;
  commentsCount: number;
}

/** Data needed to insert a digest post into DB. */
export interface CreateDigestPostParams {
  runId: number;
  rubricId: number;
  userId: number;
  channelUsername: string;
  channelTitle: string | null;
  telegramMessageId: number;
  messageUrl: string | null;
  originalText: string | null;
  summary: string | null;
  postDate: Date;
  views: number;
  forwards: number;
  reactionsCount: number;
  commentsCount: number;
  engagementScore: number;
  isFromTrackedChannel: boolean;
}

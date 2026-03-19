export type TranscriptionStatus = "pending" | "processing" | "completed" | "failed";

/** Fire-and-forget progress callback. Accepts a Russian step description. */
export type OnProgressCallback = (step: string) => void;

export interface VoiceTranscription {
  id: number;
  userId: number;
  telegramFileId: string;
  telegramFileUniqueId: string;
  durationSeconds: number;
  fileSizeBytes: number | null;
  forwardedFromName: string | null;
  forwardedDate: Date | null;
  transcript: string | null;
  modelUsed: string | null;
  audioFilePath: string | null;
  status: TranscriptionStatus;
  errorMessage: string | null;
  sequenceNumber: number;
  isDelivered: boolean;
  chatId: number | null;
  statusMessageId: number | null;
  createdAt: Date;
  transcribedAt: Date | null;
}

export interface CreateTranscriptionParams {
  userId: number;
  telegramFileId: string;
  telegramFileUniqueId: string;
  durationSeconds: number;
  fileSizeBytes: number | null;
  forwardedFromName: string | null;
  forwardedDate: Date | null;
  audioFilePath: string;
  sequenceNumber: number;
  chatId: number;
  statusMessageId: number;
}

export interface TranscribeJobData {
  transcriptionId: number;
  filePath: string;
  chatId: number;
  statusMessageId: number;
  /** Audio duration in seconds (from Telegram metadata). Used for timeout calculation. */
  durationSeconds: number;
  sequenceNumber: number;
  userId: number;
}

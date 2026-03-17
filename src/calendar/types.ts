export type CalendarEventInputMethod = "text" | "voice";

export type CalendarEventStatus = "created" | "deleted" | "failed";

export interface CalendarEventRecord {
  id: number;
  userId: number;
  tribeId: number | null;
  googleEventId: string | null;
  summary: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  recurrence: string[] | null;
  inputMethod: CalendarEventInputMethod;
  status: CalendarEventStatus;
  errorMessage: string | null;
  htmlLink: string | null;
  createdAt: Date;
  updatedAt: Date | null;
  deletedAt: Date | null;
}

export interface CreateCalendarEventParams {
  userId: number;
  tribeId: number | null;
  googleEventId: string | null;
  summary: string;
  description?: string | null;
  startTime: Date;
  endTime: Date;
  recurrence?: string[] | null;
  inputMethod: CalendarEventInputMethod;
  status: CalendarEventStatus;
  errorMessage?: string | null;
  htmlLink?: string | null;
}

ALTER TABLE "chat_dialogs" ADD COLUMN "model" varchar(120);--> statement-breakpoint
ALTER TABLE "chat_dialogs" ADD COLUMN "system_prompt" text;--> statement-breakpoint
ALTER TABLE "chat_dialogs" ADD COLUMN "temperature" real;--> statement-breakpoint
ALTER TABLE "chat_dialogs" ADD COLUMN "max_tokens" integer;--> statement-breakpoint
ALTER TABLE "chat_dialogs" ADD COLUMN "theme" varchar(200);
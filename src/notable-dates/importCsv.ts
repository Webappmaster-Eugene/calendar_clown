/**
 * One-time script to import birthdays from Google Calendar CSV export.
 * Usage: npm run import-birthdays -- <path-to-csv>
 *
 * CSV format: Subject,Start Date,Start Time,End Date,End Time,Description
 * Subject: "🎂 День рождения: Имя Фамилия"
 * Start Date: MM/DD/YYYY
 * Description: optional text (city, notes)
 */

import dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import { readFile } from "fs/promises";
import { runMigrations } from "../db/migrate.js";
import { setDatabaseAvailable, closePool } from "../db/connection.js";
import { addNotableDate } from "./repository.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("import-birthdays");

async function main(): Promise<void> {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Usage: tsx src/notable-dates/importCsv.ts <path-to-csv>");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  await runMigrations();
  setDatabaseAvailable(true);

  const content = await readFile(csvPath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  // Skip header
  const dataLines = lines.slice(1);
  let imported = 0;
  let skipped = 0;

  for (const line of dataLines) {
    try {
      const parts = parseCSVLine(line);
      if (parts.length < 6) {
        skipped++;
        continue;
      }

      const [subject, startDate, , , , description] = parts;

      // Extract name from "🎂 День рождения: Name" or anniversary/other events
      const birthdayMatch = subject.match(/День рождения:\s*(.+)/);
      const anniversaryMatch = !birthdayMatch ? subject.match(/Годовщина\s+(.+)/i) : null;

      let name: string;
      let eventType: string;
      let emoji: string;

      if (birthdayMatch) {
        name = birthdayMatch[1].trim();
        eventType = "birthday";
        emoji = "🎂";
      } else if (anniversaryMatch) {
        name = subject.replace(/^[^\p{L}]*/u, "").trim(); // Remove leading emoji
        eventType = "anniversary";
        emoji = "💍";
      } else {
        // Import any other event as-is
        name = subject.replace(/^[^\p{L}]*/u, "").trim();
        if (!name) {
          log.info(`Skipping empty subject: ${subject}`);
          skipped++;
          continue;
        }
        eventType = "other";
        emoji = "📌";
      }

      // Parse date MM/DD/YYYY
      const dateMatch = startDate.match(/^(\d{1,2})\/(\d{1,2})\/\d{4}$/);
      if (!dateMatch) {
        log.info(`Skipping invalid date: ${startDate}`);
        skipped++;
        continue;
      }
      const month = parseInt(dateMatch[1], 10);
      const day = parseInt(dateMatch[2], 10);

      await addNotableDate({
        tribeId: 1,
        addedByUserId: null,
        name,
        dateMonth: month,
        dateDay: day,
        eventType,
        description: description?.trim() || null,
        emoji,
      });

      imported++;
      log.info(`Imported: ${name} (${day}.${month}) ${description?.trim() || ""}`);
    } catch (err) {
      log.error(`Error on line: ${line}`, err);
      skipped++;
    }
  }

  log.info(`Done. Imported: ${imported}, Skipped: ${skipped}`);
  await closePool();
}

/** Simple CSV line parser that handles quoted fields. */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

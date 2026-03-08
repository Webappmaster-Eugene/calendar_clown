import dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: ".env.local", override: true });
import { createInterface } from "readline";
import { getAuthUrl, saveTokenFromCode } from "../src/calendar/auth.js";

const urlOnly = process.argv.includes("--url-only");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const userId = args[0] ?? process.env.AUTHORIZE_USER_ID;
const codeArg = args[1] ?? process.env.AUTHORIZE_CODE;

async function main() {
  if (!userId?.trim()) {
    console.error("Usage: npm run authorize -- <TELEGRAM_USER_ID> [CODE]");
    console.error("   or: AUTHORIZE_USER_ID=123 AUTHORIZE_CODE=4/0Ae... npm run authorize");
    console.error("Get your Telegram user id from @userinfobot or from the bot when you send /start (see logs).");
    process.exit(1);
  }
  const uid = userId.trim();
  const url = getAuthUrl(uid);
  if (urlOnly) {
    console.log(url);
    return;
  }
  const code = codeArg?.trim();
  if (code) {
    await saveTokenFromCode(code, uid);
    console.log(`Token saved for user ${uid}. You can run the bot.`);
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  function question(prompt: string): Promise<string> {
    return new Promise((resolve) => rl.question(prompt, resolve));
  }
  console.log("Google Calendar authorization (user: " + uid + ")\n");
  console.log("Open this URL in your browser and paste the authorization code:\n");
  console.log(url);
  console.log("");
  const entered = await question("Enter the code: ");
  rl.close();
  if (!entered?.trim()) {
    console.error("No code provided.");
    process.exit(1);
  }
  await saveTokenFromCode(entered.trim(), uid);
  console.log(`Token saved for user ${uid}. You can run the bot.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

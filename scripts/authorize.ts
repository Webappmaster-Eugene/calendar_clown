import dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: ".env.local", override: true });
import { createInterface } from "readline";
import { getAuthUrl, saveTokenFromCode } from "../src/calendar/auth.js";

const urlOnly = process.argv.includes("--url-only");
const codeArg = process.argv[2];
const codeEnv = process.env.AUTHORIZE_CODE;

async function main() {
  const url = getAuthUrl();
  if (urlOnly) {
    console.log(url);
    return;
  }
  const code = codeArg ?? codeEnv ?? null;
  if (code?.trim()) {
    await saveTokenFromCode(code.trim());
    console.log("Token saved. You can run the bot.");
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  function question(prompt: string): Promise<string> {
    return new Promise((resolve) => rl.question(prompt, resolve));
  }
  console.log("Google Calendar authorization\n");
  console.log("Open this URL in your browser and paste the authorization code:\n");
  console.log(url);
  console.log("");
  const entered = await question("Enter the code: ");
  rl.close();
  if (!entered?.trim()) {
    console.error("No code provided.");
    process.exit(1);
  }
  await saveTokenFromCode(entered.trim());
  console.log("Token saved. You can run the bot.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

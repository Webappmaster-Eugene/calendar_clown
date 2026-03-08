import "dotenv/config";
import { createInterface } from "readline";
import { getAuthUrl, saveTokenFromCode } from "../src/calendar/auth.js";

const rl = createInterface({ input: process.stdin, output: process.stdout });

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

async function main() {
  console.log("Google Calendar authorization\n");
  const url = getAuthUrl();
  console.log("Open this URL in your browser and paste the authorization code:\n");
  console.log(url);
  console.log("");
  const code = await question("Enter the code: ");
  rl.close();
  if (!code?.trim()) {
    console.error("No code provided.");
    process.exit(1);
  }
  await saveTokenFromCode(code);
  console.log("Token saved. You can run the bot.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

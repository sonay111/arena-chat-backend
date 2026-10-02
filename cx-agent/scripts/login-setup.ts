// scripts/login-setup.ts
//
// ONE-TIME MANUAL LOGIN SCRIPT.
// Run this once (npx tsx scripts/login-setup.ts) whenever you need to
// (re)establish a logged-in session for the chat widget automation.
//
// It opens a REAL, VISIBLE Chrome window. You log in exactly as you
// normally would (phone number + OTP from SMS/WhatsApp). Once logged in,
// press Enter in the terminal, and it saves your session (cookies + local
// storage) to auth-state.json. The main server then reuses that file
// forever, without needing to log in again, until the session expires.

import { chromium } from "playwright";
import * as readline from "node:readline/promises";

const SITE_URL = "https://crazybet.vgb2b.com/sports";
const AUTH_STATE_PATH = "./auth-state.json";

async function main() {
  console.log("Opening a real browser window. Log in manually with your phone + OTP.");
  console.log(`Site: ${SITE_URL}`);

  const browser = await chromium.launch({ headless: false }); // visible window
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(SITE_URL);

  console.log("");
  console.log("=> Log in now in the browser window that just opened.");
  console.log("=> Once you're fully logged in (you can see your balance/profile), come back here.");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("Press Enter here once you are logged in... ");
  rl.close();

  await context.storageState({ path: AUTH_STATE_PATH });
  console.log(`\nSaved logged-in session to ${AUTH_STATE_PATH}`);
  console.log("You can now close this browser window and run your normal server.");

  await browser.close();
}

main().catch((err) => {
  console.error("login-setup failed:", err);
  process.exit(1);
});
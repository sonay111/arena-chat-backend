// src/channels/chatWidgetBrowser.ts
//
// Sends messages into the CrazyBet support chat widget by controlling a
// REAL browser (Playwright), logged in using the session saved by
// scripts/login-setup.ts.
//
// The browser is launched ONCE and kept open for the life of the server.
//
// IMPORTANT: headless is set to FALSE on purpose — visible browser window
// for demos. Do NOT log into this same account in a separate browser
// tab/window while this is running.
//
// COSMETIC-ONLY NOTE: this file finds EVERY alert bubble currently on the
// page (matched by ALERT_MARKER text — not just the newest one) and
// left-aligns them, every single time a message is sent. This ensures old
// AND new alerts all stay left-aligned, even if the chat panel is closed
// and reopened, as long as this same browser tab stays open.

/// <reference lib="dom" />

import { chromium, Browser, BrowserContext, Page } from "playwright";
import path from "node:path";

const SITE_URL = "https://crazybet.vgb2b.com/sports";
const AUTH_STATE_PATH = path.resolve(process.cwd(), "auth-state.json");

const CHAT_BUBBLE_SELECTOR = 'button[aria-label="Open support chat"]';
const MESSAGE_INPUT_SELECTOR = 'input[placeholder="Type a message"]';
const SEND_BUTTON_SELECTOR = 'button[aria-label="Send message"]';

// Text every one of our alert messages starts with — used to find ALL
// matching bubbles on the page (past and present), not just the latest.
const ALERT_MARKER = "Payment gateway issue";

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

async function getPage(): Promise<Page> {
  if (page && !page.isClosed()) return page;

  console.log("[chatWidgetBrowser] Launching browser with saved session...");
  browser = await chromium.launch({ headless: false });
  context = await browser.newContext({ storageState: AUTH_STATE_PATH });
  page = await context.newPage();
  await page.goto(SITE_URL, { waitUntil: "domcontentloaded" });

  try {
    await page.click(CHAT_BUBBLE_SELECTOR, { timeout: 10000 });
    console.log("[chatWidgetBrowser] Chat widget opened.");
  } catch (err) {
    console.error(
      "[chatWidgetBrowser] Could not find/click the chat bubble. You may need to adjust CHAT_BUBBLE_SELECTOR.",
      err,
    );
  }

  return page;
}

// COSMETIC ONLY: finds EVERY alert bubble currently on the page (matched by
// ALERT_MARKER, not just the one we just sent) and left-aligns them.
async function repositionAllAlertBubbles(targetPage: Page): Promise<void> {
  try {
    const styledCount = await targetPage.evaluate((marker) => {
      let count = 0;
      const matches = Array.from(document.querySelectorAll("div")).filter(
        (el) => el.textContent && el.textContent.includes(marker),
      );
      for (const bubble of matches) {
        const el = bubble as HTMLElement;
        if (el.style.alignSelf === "flex-end" || getComputedStyle(el).alignSelf === "flex-end") {
          el.style.setProperty("align-self", "flex-start", "important");
          count++;
        }
      }
      return count;
    }, ALERT_MARKER);

    if (styledCount > 0) {
      console.log(`[chatWidgetBrowser] Left-aligned ${styledCount} alert bubble(s) on the page.`);
    }
  } catch (err) {
    console.warn("[chatWidgetBrowser] Could not reposition alert bubbles (cosmetic step failed):", err);
  }
}

export async function sendChatWidgetMessageViaBrowser(message: string): Promise<void> {
  const p = await getPage();

  try {
    await p.fill(MESSAGE_INPUT_SELECTOR, message);
    await p.press(MESSAGE_INPUT_SELECTOR, "Enter");
    console.log(`[chatWidgetBrowser] Sent message: "${message.slice(0, 60)}..."`);

    await p.waitForTimeout(300);
    await repositionAllAlertBubbles(p);

    for (let i = 0; i < 10; i++) {
      await p.waitForTimeout(400);
      await repositionAllAlertBubbles(p);
    }
  } catch (err) {
    console.error("[chatWidgetBrowser] Failed to send message via browser:", err);
    throw err;
  }
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
    context = null;
    page = null;
  }
}
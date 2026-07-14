// Dev-only: capture a screenshot of the running scene for visual verification.
import puppeteer from "puppeteer-core";

const out = process.argv[2] ?? "shot.png";
const waitMs = Number(process.argv[3] ?? 4500);
const url = process.argv[4] ?? "http://localhost:5199";
const holdKey = process.argv[5]; // e.g. "KeyE" — held from page load through the shot

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "shell",
  args: ["--use-angle=default", "--window-size=1600,900", "--hide-scrollbars"],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
if (holdKey) await page.keyboard.down(holdKey);
await new Promise((r) => setTimeout(r, waitMs));
await page.screenshot({ path: out });
console.log("saved:", out);
console.log(logs.slice(0, 40).join("\n"));
await browser.close();

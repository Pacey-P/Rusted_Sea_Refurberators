// Dev-only: verify the stow progress bar — visible mid-hold, stow fires at
// full, short press still toggles mode.
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "shell",
  args: ["--use-angle=default", "--window-size=1600,900", "--hide-scrollbars"],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto("http://localhost:5199/sub.html", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 2000));

const modeText = () => page.$eval("#mode", (el) => el.textContent);
const stowVisible = () =>
  page.$eval("#stow", (el) => getComputedStyle(el).display !== "none");
const clawText = () => page.$eval("#clawState", (el) => el.textContent);

await page.keyboard.press("Tab"); // short press -> MANIPULATOR (arm wakes)
await new Promise((r) => setTimeout(r, 300));
console.log("after short press:", await modeText());

await page.keyboard.down("Tab"); // hold
await new Promise((r) => setTimeout(r, 300)); // mid-hold ~60%
console.log("bar visible mid-hold:", await stowVisible());
await page.screenshot({ path: "stow1.png" });
await new Promise((r) => setTimeout(r, 350)); // crosses 500ms -> stow fires
console.log("claw hud at fire:", await clawText(), "| mode:", await modeText());
await page.keyboard.up("Tab");
await new Promise((r) => setTimeout(r, 300));
console.log("bar hidden after:", !(await stowVisible()), "| mode:", await modeText());

await browser.close();

// Dev-only: verify left click toggles the claw (both modes) and that a real
// camera drag does NOT.
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

const clawText = () => page.$eval("#clawState", (el) => el.textContent);

console.log("start (PILOT):", await clawText());
await page.mouse.click(800, 450); // click in PILOT
await new Promise((r) => setTimeout(r, 200));
console.log("after click in PILOT:", await clawText());

// real drag: press, move far over ~600ms, release -> should NOT toggle
await page.mouse.move(800, 450);
await page.mouse.down();
for (let i = 0; i < 12; i++) {
  await page.mouse.move(800 + i * 25, 450 + i * 8);
  await new Promise((r) => setTimeout(r, 55));
}
await page.mouse.up();
await new Promise((r) => setTimeout(r, 200));
console.log("after long drag (no toggle expected):", await clawText());

await page.keyboard.press("Tab"); // MANIPULATOR
await new Promise((r) => setTimeout(r, 300));
await page.mouse.click(700, 500);
await new Promise((r) => setTimeout(r, 200));
console.log("after click in MANIPULATOR:", await clawText());

await browser.close();

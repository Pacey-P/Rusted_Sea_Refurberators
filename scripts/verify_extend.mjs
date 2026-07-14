// Dev-only: verify full arm extension — target far beyond max reach should
// put the claw at ~max extension along the target direction, not folded
// back onto the shoulder.
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "shell",
  args: ["--use-angle=default", "--window-size=1600,900", "--hide-scrollbars"],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto("http://localhost:5199/sub.html?yaw=1.2&pitch=0.2&dist=8", {
  waitUntil: "networkidle0",
});
await new Promise((r) => setTimeout(r, 2500));

await page.keyboard.press("Tab"); // MANIPULATOR
await new Promise((r) => setTimeout(r, 500));
// way beyond reach (arm total = 3.35), out to the side and forward
await page.evaluate(() => window.__dbg.setArmTarget(30, -4, 30));
await new Promise((r) => setTimeout(r, 1500));
const res = await page.evaluate(() => {
  const claw = window.__dbg.clawPos ? window.__dbg.clawPos() : null;
  return { claw };
});
// claw should be far from sub origin (extended), and forward of it
console.log("claw world pos at full stretch:", res.claw?.map((v) => v.toFixed(2)).join(", "));
await page.screenshot({ path: "extend1.png" });
await browser.close();

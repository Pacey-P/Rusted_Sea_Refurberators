// Dev-only: verify claw collision + shove — drive the arm target INTO the
// crate and confirm (a) the claw stops at the surface, (b) the crate moves.
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "shell",
  args: ["--use-angle=default", "--window-size=1600,900", "--hide-scrollbars"],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto("http://localhost:5199/sub.html?yaw=0.7&pitch=0.25&dist=7", {
  waitUntil: "networkidle0",
});
await new Promise((r) => setTimeout(r, 2500));

const cratePos = () => page.evaluate(() => window.__dbg.cratePos());
const clawToCrate = () => page.evaluate(() => window.__dbg.clawToCrate());

const before = await cratePos();
await page.evaluate(
  ([x, y, z]) => window.__dbg.setSubPos(x, y + 2.0, z - 2.0),
  before,
);
await page.keyboard.press("Tab"); // MANIPULATOR
await new Promise((r) => setTimeout(r, 600));
// drive the target INTO / THROUGH the crate center repeatedly
await page.evaluate(([x, y, z]) => window.__dbg.setArmTarget(x, y, z), before);
await new Promise((r) => setTimeout(r, 2500));
const during = await clawToCrate();
const after = await cratePos();
console.log("crate before:", before.map((v) => v.toFixed(2)).join(", "));
console.log("claw-to-crate while pushing (should stay >= ~1.1):", during.toFixed(2));
console.log("crate after:", after.map((v) => v.toFixed(2)).join(", "));
const moved = Math.hypot(after[0] - before[0], after[2] - before[2]);
console.log("crate displaced:", moved.toFixed(2), moved > 0.3 ? "PUSHED ✓" : "no push ✗");
await page.screenshot({ path: "push1.png" });
await browser.close();

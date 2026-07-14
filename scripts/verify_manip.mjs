// Dev-only: verify manipulator mode + arm pose persistence + long-press stow.
// 1. Tab -> MANIPULATOR, aim arm with mouse, grip           -> manip1.png
// 2. Tab (short) -> PILOT, thrust forward: arm should HOLD  -> manip2.png
// 3. Hold Tab 0.7s -> arm stows to folded rest              -> manip3.png
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "shell",
  args: ["--use-angle=default", "--window-size=1600,900", "--hide-scrollbars"],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto("http://localhost:5199/sub.html?yaw=0.8&pitch=0.3&dist=8", {
  waitUntil: "networkidle0",
});
await new Promise((r) => setTimeout(r, 2500));

await page.keyboard.press("Tab"); // -> MANIPULATOR
await page.mouse.move(1000, 640, { steps: 12 });
await new Promise((r) => setTimeout(r, 1500));
await page.keyboard.press("Space"); // grip
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: "manip1.png" });

await page.keyboard.press("Tab"); // short -> PILOT, arm should hold pose
await page.keyboard.down("KeyW"); // fly forward
await new Promise((r) => setTimeout(r, 1800));
await page.keyboard.up("KeyW");
await page.screenshot({ path: "manip2.png" });

await page.keyboard.down("Tab"); // long press -> stow
await new Promise((r) => setTimeout(r, 700));
await page.keyboard.up("Tab");
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: "manip3.png" });

console.log("saved manip1.png manip2.png manip3.png");
await browser.close();

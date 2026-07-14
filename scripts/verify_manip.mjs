// Dev-only: verify MANIPULATOR mode — toggle with Tab, aim the arm with the
// mouse, close the claw with a click, screenshot.
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
await page.mouse.move(1000, 640, { steps: 12 }); // aim low-right
await new Promise((r) => setTimeout(r, 2000));
await page.screenshot({ path: "manip1.png" });
await page.keyboard.press("Space"); // grip
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: "manip2.png" });
console.log("saved manip1.png manip2.png");
await browser.close();

// Dev-only: verify the economy loop end to end.
// grab bomb -> carry to pad -> release over pad -> +100 CR -> fire torpedoes
// at the base (teleported nearby) -> base destroyed -> +300 CR.
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "shell",
  args: ["--use-angle=default", "--window-size=1600,900", "--hide-scrollbars"],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto("http://localhost:5199/sub.html?yaw=0.7&pitch=0.25&dist=9", {
  waitUntil: "networkidle0",
});
await new Promise((r) => setTimeout(r, 2500));

// --- grab bomb 0 ---
const [cx, cy, cz] = await page.evaluate(() => window.__dbg.cratePos());
await page.evaluate(([x, y, z]) => window.__dbg.setSubPos(x, y + 2.0, z - 2.0), [cx, cy, cz]);
await page.keyboard.press("Tab");
await new Promise((r) => setTimeout(r, 600));
await page.evaluate(([x, y, z]) => window.__dbg.setArmTarget(x, y + 0.8, z), [cx, cy, cz]);
await new Promise((r) => setTimeout(r, 1500));
await page.keyboard.press("Space"); // grip
await new Promise((r) => setTimeout(r, 500));
console.log("carried:", await page.evaluate(() => window.__dbg.isCarried()));

// --- teleport over the pad, aim the claw at the pad center, release ---
await page.evaluate(() => window.__dbg.setSubPos(-34, -4, -18.5));
await new Promise((r) => setTimeout(r, 800));
await page.evaluate(() => window.__dbg.setArmTarget(-34, -30, -18)); // straight down over pad
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: "econ1.png" });
await page.keyboard.press("Space"); // release over pad
await new Promise((r) => setTimeout(r, 4000)); // sink + deliver
console.log("credits after delivery:", await page.evaluate(() => window.__dbg.credits()));
await page.screenshot({ path: "econ2.png" });

// --- torpedo the base: teleport in front of it, aim north (yaw 0 faces +z;
// base at z=-148 so face -z: set yaw via... we can't set yaw; place sub south
// of base facing +z won't work. Place sub at z=-160 facing +z toward base. ---
await page.evaluate(() => window.__dbg.giveCredits(200)); // fund the torpedoes
// deep in the trench, at hull-clamp altitude, base dead ahead (+z)
await page.evaluate(() => window.__dbg.setSubPos(0, -44, -160));
await new Promise((r) => setTimeout(r, 1200));
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => window.__dbg.fire());
  await new Promise((r) => setTimeout(r, 1400));
}
await new Promise((r) => setTimeout(r, 1500));
console.log("base hp:", await page.evaluate(() => window.__dbg.baseHp()));
console.log("credits final:", await page.evaluate(() => window.__dbg.credits()));
await page.screenshot({ path: "econ3.png" });
await browser.close();

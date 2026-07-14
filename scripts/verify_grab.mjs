// Dev-only: verify the grab loop end to end.
// Position sub over the crate -> MANIPULATOR -> aim at crate (beacon goes
// green) -> grip (attach) -> fly with payload -> release (crate sinks).
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

// derive positions from wherever the crate actually sits on the terrain
const [cx, cy, cz] = await page.evaluate(() => window.__dbg.cratePos());
await page.evaluate(
  ([x, y, z]) => window.__dbg.setSubPos(x, y + 2.0, z - 2.0),
  [cx, cy, cz],
);
await page.keyboard.press("Tab"); // MANIPULATOR
await new Promise((r) => setTimeout(r, 600));
// grab technique: come from ABOVE (the collision cylinder is open on top,
// so a side approach shoves the crate away — by design)
await page.evaluate(
  ([x, y, z]) => window.__dbg.setArmTarget(x, y + 0.8, z),
  [cx, cy, cz],
);
await new Promise((r) => setTimeout(r, 1500));
const inRange = await page.evaluate(() => window.__dbg.inRange());
console.log("in grab range (beacon green):", inRange);
await page.screenshot({ path: "grab1.png" });

await page.keyboard.press("Space"); // grip
await new Promise((r) => setTimeout(r, 600));
console.log("carried after grip:", await page.evaluate(() => window.__dbg.isCarried()));
await page.screenshot({ path: "grab2.png" });

await page.keyboard.press("Tab"); // back to PILOT, arm holds, payload rides
await page.keyboard.down("KeyW");
await page.keyboard.down("KeyR");
await new Promise((r) => setTimeout(r, 1800));
await page.keyboard.up("KeyW");
await page.keyboard.up("KeyR");
await page.screenshot({ path: "grab3.png" });

await page.keyboard.press("Tab"); // MANIPULATOR again
await new Promise((r) => setTimeout(r, 300));
await page.keyboard.press("Space"); // release
await new Promise((r) => setTimeout(r, 2200)); // crate sinks
console.log("carried after release:", await page.evaluate(() => window.__dbg.isCarried()));
await page.screenshot({ path: "grab4.png" });

console.log("saved grab1-4.png");
await browser.close();

// Dev-only: screenshot with the sub teleported to a given position.
// usage: node scripts/shot_at.mjs out.png x y z [urlQuery] [waitMs]
import puppeteer from "puppeteer-core";

const [out, x, y, z, query = "", waitMs = "5000"] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "shell",
  args: ["--use-angle=default", "--window-size=1600,900", "--hide-scrollbars"],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(`http://localhost:5199/sub.html${query}`, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(
  ([px, py, pz]) => window.__dbg.setSubPos(px, py, pz),
  [Number(x), Number(y), Number(z)],
);
await new Promise((r) => setTimeout(r, Number(waitMs)));
await page.screenshot({ path: out });
console.log("saved:", out);
await browser.close();

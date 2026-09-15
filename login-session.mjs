import { createServer } from "node:http"
import { chromium } from "playwright"

const browser = await chromium.launch({
  headless: false,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1280,800"],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await context.newPage()
await page.goto("https://ethol.pens.ac.id/", { waitUntil: "domcontentloaded", timeout: 60000 })

const srv = createServer(async (req, res) => {
  res.setHeader("content-type", "application/json")
  try {
    if (req.url === "/dump") {
      res.end(JSON.stringify(await context.cookies()))
      return
    }
    if (req.url === "/quit") {
      res.end("{\"ok\":true}")
      srv.close()
      await browser.close()
      process.exit(0)
    }
    res.statusCode = 404
    res.end("{}")
  } catch (e) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : "err" }))
  }
})
srv.listen(9876, "127.0.0.1")

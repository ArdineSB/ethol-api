import { readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const BASE = "https://ethol.pens.ac.id/api"
const DIR = dirname(fileURLToPath(import.meta.url))
const COOKIE_FILE = join(DIR, ".cookie")
const SEEN_FILE = join(DIR, ".seen.json")
const PORT = 8787

const WRITE = new Set([
  "/notifikasi/mahasiswa-baca-notif",
  "/presensi/mahasiswa",
  "/presensi/buka",
  "/presensi/tutup",
  "/presensi/batalkan",
  "/tugas/submit",
])

function apiUrl(path: string, params: Record<string, string> = {}): string {
  const u = new URL(BASE + (path.startsWith("/") ? path : `/${path}`))
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return u.href
}

function parseParams(args: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const a of args) {
    const i = a.indexOf("=")
    if (i <= 0) throw new Error(`want key=value, got ${a}`)
    out[a.slice(0, i)] = a.slice(i + 1)
  }
  return out
}

function assertGettable(path: string) {
  const p = path.split("?")[0]
  if (WRITE.has(p)) throw new Error(`blocked write: ${p}`)
}

function env(k: string): string | undefined {
  if (process.env[k]) return process.env[k]
  try {
    for (const line of readFileSync(join(DIR, ".env"), "utf8").split(/\r?\n/)) {
      if (line.startsWith(k + "=")) return line.slice(k.length + 1).trim()
    }
  } catch { /* no .env */ }
}

function loadCookie(): string {
  const fromEnv = env("ETHOL_COOKIE")
  if (fromEnv) return fromEnv
  try {
    return readFileSync(COOKIE_FILE, "utf8").trim()
  } catch {
    throw new Error("missing .cookie")
  }
}

async function refresh(): Promise<void> {
  const res = await fetch(apiUrl("/auth/refresh"), {
    method: "POST",
    headers: { cookie: loadCookie(), accept: "application/json", "content-type": "application/json" },
    body: "{}",
  })
  const set = res.headers.getSetCookie?.() ?? []
  const tok = set.map((s) => s.split(";")[0]).find((s) => s.startsWith("token="))
  if (!res.ok || !tok) throw new Error(`refresh failed ${res.status}`)
  const map = Object.fromEntries(loadCookie().split("; ").filter(Boolean).map((p) => {
    const i = p.indexOf("=")
    return [p.slice(0, i), p.slice(i + 1)]
  }))
  map.token = tok.slice("token=".length)
  writeFileSync(COOKIE_FILE, Object.entries(map).map(([k, v]) => `${k}=${v}`).join("; "))
}

async function get(path: string, params: Record<string, string> = {}, retried = false): Promise<unknown> {
  assertGettable(path)
  const res = await fetch(apiUrl(path, params), { headers: { cookie: loadCookie(), accept: "application/json" } })
  const text = await res.text()
  if (res.status === 401 && !retried) {
    await refresh()
    return get(path, params, true)
  }
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 200)}`)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

type Notif = {
  idNotifikasi: number
  kodeNotifikasi?: string
  keterangan?: string
  waktuNotifikasi?: string
  status?: string
}
type Course = { nomor: number; matakuliah: { nama: string }; dosen: string }

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!))
}

async function data() {
  const badge = (await get("/notifikasi/mahasiswa-belum-baca")) as { jumlah: number }
  const notifications = (await get("/notifikasi/mahasiswa", { filterNotif: "SEMUA" })) as Notif[]
  const courses = (await get("/kuliah", { tahun: "2026", semester: "1" })) as Course[]
  return { badge: badge.jumlah, notifications, courses }
}

function selfCheck() {
  const u = apiUrl("/kuliah", { tahun: "2026", semester: "1" })
  if (u !== "https://ethol.pens.ac.id/api/kuliah?tahun=2026&semester=1") throw new Error(`url join: ${u}`)
  try {
    assertGettable("/presensi/mahasiswa")
    throw new Error("write not blocked")
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith("blocked write")) throw e
  }
  console.log("ok")
}

function json(res: import("node:http").ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(body))
}

async function htmlPage(): Promise<string> {
  const { badge, courses } = await data()
  const lis = courses.map((c) => `<li>${esc(c.matakuliah.nama)} <span class="muted">— ${esc(c.dosen)}</span></li>`).join("\n")
  return `<!doctype html><meta charset="utf-8"><title>ethol-api</title>
<style>
body{font:16px/1.4 system-ui;max-width:42rem;margin:2rem auto;padding:0 1rem;background:#111;color:#eee}
.badge{display:inline-block;background:#c0392b;color:#fff;border-radius:999px;padding:.15rem .6rem}
.muted{color:#888;font-size:.9rem} li{margin:.35rem 0}
</style>
<h1>ethol-api</h1>
<p>Lonceng belum dibaca: <span class="badge">${badge}</span></p>
<p>Matakuliah: <strong>${courses.length}</strong></p>
<ol>${lis}</ol>
<p class="muted">Live GET. Tidak mark-read, tidak presensi.</p>`
}

async function telegramTick() {
  const token = env("TELEGRAM_BOT_TOKEN")
  const chat = env("TELEGRAM_CHAT_ID")
  if (!token || !chat) return
  const { notifications } = await data()
  let seen: number[] = []
  try {
    seen = JSON.parse(readFileSync(SEEN_FILE, "utf8"))
  } catch { /* first run */ }
  const ids = notifications.map((n) => n.idNotifikasi)
  if (seen.length === 0) {
    // ponytail: first run seeds, no flood of old notifs
    writeFileSync(SEEN_FILE, JSON.stringify(ids))
    console.log("telegram: seeded", ids.length)
    return
  }
  const have = new Set(seen)
  const fresh = notifications.filter((n) => !have.has(n.idNotifikasi))
  for (const n of fresh) {
    const text = [n.kodeNotifikasi, n.keterangan, n.waktuNotifikasi].filter(Boolean).join("\n")
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: text || String(n.idNotifikasi) }),
    })
    if (!r.ok) console.error("telegram send", r.status, await r.text().then((t) => t.slice(0, 120)))
  }
  writeFileSync(SEEN_FILE, JSON.stringify([...new Set([...ids, ...seen])].slice(0, 500)))
}

function serve() {
  const s = createServer(async (req, res) => {
    const url = req.url ?? "/"
    try {
      if (url === "/" || url === "/index.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
        res.end(await htmlPage())
        return
      }
      if (url === "/v1/notifications") {
        const { badge, notifications } = await data()
        json(res, 200, { badge, notifications })
        return
      }
      if (url === "/v1/courses") {
        json(res, 200, { courses: (await data()).courses })
        return
      }
      res.writeHead(404)
      res.end("no")
    } catch (e) {
      json(res, 500, { error: e instanceof Error ? e.message : "err" })
    }
  })
  s.listen(PORT, "127.0.0.1", () => {
    console.log(`http://127.0.0.1:${PORT}/`)
    console.log("GET /v1/notifications  GET /v1/courses")
    if (env("TELEGRAM_BOT_TOKEN") && env("TELEGRAM_CHAT_ID")) {
      telegramTick().catch((e) => console.error(e))
      setInterval(() => telegramTick().catch((e) => console.error(e)), 5 * 60 * 1000)
    } else {
      console.log("telegram off — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env")
    }
  })
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === "--self-check") selfCheck()
else if (cmd === "serve") serve()
else if (!cmd || cmd === "-h") {
  console.log(`node --experimental-strip-types ethol.ts serve
node --experimental-strip-types ethol.ts /notifikasi/mahasiswa-belum-baca`)
} else {
  get(cmd, parseParams(rest)).then((d) => console.log(JSON.stringify(d, null, 2)), (e) => {
    console.error(e.message)
    process.exit(1)
  })
}

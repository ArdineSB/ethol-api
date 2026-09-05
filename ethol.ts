import { readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const BASE = "https://ethol.pens.ac.id/api"
const DIR = dirname(fileURLToPath(import.meta.url))
const COOKIE_FILE = join(DIR, ".cookie")
const SEEN_FILE = join(DIR, ".seen.json")
const PORT = 8787
const TG = "https://api.telegram.org/bot"

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
}
type Course = { nomor: number; jenisSchema: number; matakuliah: { nama: string }; dosen: string }
type Tugas = { title: string; deadline_indonesia?: string; submission_time?: string | null }
type Materi = { title: string; tipe?: number }

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!))
}

async function courses(): Promise<Course[]> {
  return (await get("/kuliah", { tahun: "2026", semester: "1" })) as Course[]
}

async function data() {
  const badge = (await get("/notifikasi/mahasiswa-belum-baca")) as { jumlah: number }
  const notifications = (await get("/notifikasi/mahasiswa", { filterNotif: "SEMUA" })) as Notif[]
  return { badge: badge.jumlah, notifications, courses: await courses() }
}

function clip(s: string, n = 3900) {
  return s.length <= n ? s : s.slice(0, n) + "\n…"
}

async function textTugas(): Promise<string> {
  const cs = await courses()
  const lines: string[] = []
  for (const c of cs) {
    const items = (await get("/tugas", { kuliah: String(c.nomor), jenisSchema: String(c.jenisSchema) })) as Tugas[]
    if (!items?.length) continue
    lines.push(c.matakuliah.nama)
    for (const t of items) {
      const st = t.submission_time ? "sudah" : "belum"
      lines.push(`- ${t.title} · ${t.deadline_indonesia ?? "?"} · ${st}`)
    }
    lines.push("")
  }
  return clip(lines.join("\n").trim() || "Tidak ada tugas.")
}

async function textMateri(nomor: string, js: string): Promise<string> {
  const cs = await courses()
  const c = cs.find((x) => String(x.nomor) === nomor)
  const items = (await get("/materi", { matakuliah: nomor, jenis_schema: js })) as Materi[]
  const head = c ? c.matakuliah.nama : nomor
  if (!items?.length) return `${head}\n(tidak ada materi)`
  return clip([head, ...items.map((m) => `- ${m.title}`)].join("\n"))
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
  const { badge, courses: cs } = await data()
  const lis = cs.map((c) => `<li>${esc(c.matakuliah.nama)} <span class="muted">— ${esc(c.dosen)}</span></li>`).join("\n")
  return `<!doctype html><meta charset="utf-8"><title>ethol-api</title>
<style>
body{font:16px/1.4 system-ui;max-width:42rem;margin:2rem auto;padding:0 1rem;background:#111;color:#eee}
.badge{display:inline-block;background:#c0392b;color:#fff;border-radius:999px;padding:.15rem .6rem}
.muted{color:#888;font-size:.9rem} li{margin:.35rem 0}
</style>
<h1>ethol-api</h1>
<p>Lonceng belum dibaca: <span class="badge">${badge}</span></p>
<p>Matakuliah: <strong>${cs.length}</strong></p>
<ol>${lis}</ol>`
}

const menuKb = {
  keyboard: [[{ text: "Tugas" }, { text: "Materi" }]],
  resize_keyboard: true,
}

async function tg(token: string, method: string, body: unknown) {
  const r = await fetch(`${TG}${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!r.ok) console.error("tg", method, r.status, (await r.text()).slice(0, 160))
}

async function send(token: string, chat: string, text: string, extra: Record<string, unknown> = {}) {
  await tg(token, "sendMessage", { chat_id: chat, text, ...extra })
}

async function telegramTick(token: string, chat: string) {
  const { notifications } = await data()
  let seen: number[] = []
  try {
    seen = JSON.parse(readFileSync(SEEN_FILE, "utf8"))
  } catch { /* first run */ }
  const ids = notifications.map((n) => n.idNotifikasi)
  if (seen.length === 0) {
    writeFileSync(SEEN_FILE, JSON.stringify(ids))
    console.log("telegram: seeded", ids.length)
    return
  }
  const have = new Set(seen)
  for (const n of notifications.filter((x) => !have.has(x.idNotifikasi))) {
    await send(token, chat, [n.kodeNotifikasi, n.keterangan, n.waktuNotifikasi].filter(Boolean).join("\n") || String(n.idNotifikasi))
  }
  writeFileSync(SEEN_FILE, JSON.stringify([...new Set([...ids, ...seen])].slice(0, 500)))
}

async function handleMsg(token: string, chat: string, text: string) {
  const t = text.trim()
  if (t === "/start" || t === "/menu") {
    await send(token, chat, "Menu: Tugas atau Materi.", { reply_markup: menuKb })
    return
  }
  if (t === "/tugas" || t === "Tugas") {
    await send(token, chat, "Ambil tugas…")
    await send(token, chat, await textTugas())
    return
  }
  if (t === "/materi" || t === "Materi") {
    const cs = await courses()
    const buttons = cs.map((c) => [{
      text: c.matakuliah.nama.slice(0, 60),
      callback_data: `m:${c.nomor}:${c.jenisSchema}`,
    }])
    await send(token, chat, "Pilih matakuliah:", { reply_markup: { inline_keyboard: buttons } })
    return
  }
}

async function telegramInbox(token: string, allow: string) {
  await tg(token, "setMyCommands", {
    commands: [
      { command: "tugas", description: "List tugas" },
      { command: "materi", description: "List materi (pilih matkul)" },
      { command: "menu", description: "Tampilkan menu" },
    ],
  })
  let offset = 0
  for (;;) {
    try {
      const r = await fetch(`${TG}${token}/getUpdates?timeout=50&offset=${offset}`)
      const data = (await r.json()) as { ok?: boolean; result?: any[] }
      for (const u of data.result ?? []) {
        offset = u.update_id + 1
        const msg = u.message
        const cb = u.callback_query
        if (msg?.text && String(msg.chat.id) === allow) await handleMsg(token, allow, msg.text)
        if (cb?.data && String(cb.message?.chat?.id) === allow) {
          await tg(token, "answerCallbackQuery", { callback_query_id: cb.id })
          const m = /^m:(\d+):(\d+)$/.exec(cb.data)
          if (m) await send(token, allow, await textMateri(m[1], m[2]))
        }
      }
    } catch (e) {
      console.error("inbox", e instanceof Error ? e.message : e)
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
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
        json(res, 200, { courses: await courses() })
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
    const token = env("TELEGRAM_BOT_TOKEN")
    const chat = env("TELEGRAM_CHAT_ID")
    if (token && chat) {
      telegramTick(token, chat).catch((e) => console.error(e))
      setInterval(() => telegramTick(token, chat).catch((e) => console.error(e)), 5 * 60 * 1000)
      telegramInbox(token, chat).catch((e) => console.error(e))
    } else console.log("telegram off")
  })
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === "--self-check") selfCheck()
else if (cmd === "serve") serve()
else if (!cmd || cmd === "-h") {
  console.log(`node --experimental-strip-types ethol.ts serve`)
} else {
  get(cmd, parseParams(rest)).then((d) => console.log(JSON.stringify(d, null, 2)), (e) => {
    console.error(e.message)
    process.exit(1)
  })
}

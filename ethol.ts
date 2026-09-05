import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const BASE = "https://ethol.pens.ac.id/api"
const DIR = dirname(fileURLToPath(import.meta.url))
const COOKIE_FILE = join(DIR, ".cookie")
const SEEN_FILE = join(DIR, ".seen.json")
const SESS_DIR = join(DIR, "sessions")
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

function sessionFile(chat: string) {
  return join(SESS_DIR, `${chat}.cookie`)
}

function cookieFor(chat: string): string | null {
  try {
    const s = readFileSync(sessionFile(chat), "utf8").trim()
    if (s) return s
  } catch { /* none */ }
  if (chat === env("TELEGRAM_CHAT_ID")) {
    try {
      return loadCookie()
    } catch {
      return null
    }
  }
  return null
}

function writeCookie(file: string, cookie: string) {
  writeFileSync(file, cookie)
}

function mergeToken(cookie: string, tokenVal: string) {
  const map = Object.fromEntries(cookie.split("; ").filter(Boolean).map((p) => {
    const i = p.indexOf("=")
    return [p.slice(0, i), p.slice(i + 1)]
  }))
  map.token = tokenVal
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join("; ")
}

async function refresh(cookie: string, file: string): Promise<string> {
  const res = await fetch(apiUrl("/auth/refresh"), {
    method: "POST",
    headers: { cookie, accept: "application/json", "content-type": "application/json" },
    body: "{}",
  })
  const set = res.headers.getSetCookie?.() ?? []
  const tok = set.map((s) => s.split(";")[0]).find((s) => s.startsWith("token="))
  if (!res.ok || !tok) throw new Error(`refresh failed ${res.status}`)
  const next = mergeToken(cookie, tok.slice("token=".length))
  writeCookie(file, next)
  return next
}

async function get(path: string, params: Record<string, string> = {}, cookie = loadCookie(), file = COOKIE_FILE, retried = false): Promise<unknown> {
  assertGettable(path)
  const res = await fetch(apiUrl(path, params), { headers: { cookie, accept: "application/json" } })
  const text = await res.text()
  if (res.status === 401 && !retried) {
    const next = await refresh(cookie, file)
    return get(path, params, next, file, true)
  }
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 200)}`)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

type Notif = { idNotifikasi: number; kodeNotifikasi?: string; keterangan?: string; waktuNotifikasi?: string }
type Course = { nomor: number; jenisSchema: number; matakuliah: { nama: string }; dosen: string }
type Tugas = { title: string; deadline_indonesia?: string; submission_time?: string | null }
type Materi = { title: string; path?: string; tipe?: number }

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!))
}

function clip(s: string, n = 3900) {
  return s.length <= n ? s : s.slice(0, n) + "\n…"
}

function href(p: string) {
  if (!p) return ""
  try {
    return encodeURI(p)
  } catch {
    return p
  }
}

async function courses(cookie: string, file: string): Promise<Course[]> {
  return (await get("/kuliah", { tahun: "2026", semester: "1" }, cookie, file)) as Course[]
}

async function data(cookie: string, file: string) {
  const badge = (await get("/notifikasi/mahasiswa-belum-baca", {}, cookie, file)) as { jumlah: number }
  const notifications = (await get("/notifikasi/mahasiswa", { filterNotif: "SEMUA" }, cookie, file)) as Notif[]
  return { badge: badge.jumlah, notifications, courses: await courses(cookie, file) }
}

async function textTugas(cookie: string, file: string): Promise<string> {
  const cs = await courses(cookie, file)
  const lines: string[] = []
  for (const c of cs) {
    const items = (await get("/tugas", { kuliah: String(c.nomor), jenisSchema: String(c.jenisSchema) }, cookie, file)) as Tugas[]
    const open = (items ?? []).filter((t) => !t.submission_time)
    if (!open.length) continue
    lines.push(c.matakuliah.nama)
    for (const t of open) lines.push(`- ${t.title} · ${t.deadline_indonesia ?? "?"}`)
    lines.push("")
  }
  return clip(lines.join("\n").trim() || "Tidak ada tugas belum dikumpulkan.")
}

async function textMateri(cookie: string, file: string, nomor: string, js: string): Promise<string> {
  const cs = await courses(cookie, file)
  const c = cs.find((x) => String(x.nomor) === nomor)
  const items = (await get("/materi", { matakuliah: nomor, jenis_schema: js }, cookie, file)) as Materi[]
  const head = c ? c.matakuliah.nama : nomor
  if (!items?.length) return `${head}\n(tidak ada materi)`
  return clip([head, ...items.map((m) => `- ${m.title}\n  ${href(m.path ?? "")}`)].join("\n"))
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
  const cookie = loadCookie()
  const { badge, courses: cs } = await data(cookie, COOKIE_FILE)
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
  await tg(token, "sendMessage", { chat_id: chat, text, disable_web_page_preview: false, ...extra })
}

async function telegramTick(token: string, chat: string) {
  const cookie = cookieFor(chat)
  if (!cookie) return
  const file = chat === env("TELEGRAM_CHAT_ID") ? COOKIE_FILE : sessionFile(chat)
  const { notifications } = await data(cookie, file)
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

const LOGIN_HELP = `Akun ETHOL per Telegram, bukan share satu session.

Kamu (chat yang sudah di-VPS) sudah terhubung.
Teman: jangan kirim password ke bot. VPS masih HTTP — form login SSO belum dipasang.

Nanti: HTTPS + halaman connect. Sementara admin bisa taruh sessions/<chat_id>.cookie di VPS.`

async function handleMsg(token: string, chat: string, text: string) {
  const t = text.trim()
  const cookie = cookieFor(chat)
  const file = cookie && chat === env("TELEGRAM_CHAT_ID") ? COOKIE_FILE : sessionFile(chat)
  if (t === "/start" || t === "/menu") {
    await send(token, chat, cookie ? "Menu: Tugas atau Materi." : LOGIN_HELP, { reply_markup: menuKb })
    return
  }
  if (t === "/login") {
    await send(token, chat, cookie ? "Sudah terhubung." : LOGIN_HELP)
    return
  }
  if (!cookie) {
    await send(token, chat, LOGIN_HELP)
    return
  }
  if (t === "/tugas" || t === "Tugas") {
    await send(token, chat, "Ambil tugas belum…")
    await send(token, chat, await textTugas(cookie, file))
    return
  }
  if (t === "/materi" || t === "Materi") {
    const cs = await courses(cookie, file)
    const buttons = cs.map((c) => [{
      text: c.matakuliah.nama.slice(0, 60),
      callback_data: `m:${c.nomor}:${c.jenisSchema}`,
    }])
    await send(token, chat, "Pilih matakuliah:", { reply_markup: { inline_keyboard: buttons } })
  }
}

async function telegramInbox(token: string) {
  mkdirSync(SESS_DIR, { recursive: true })
  await tg(token, "setMyCommands", {
    commands: [
      { command: "tugas", description: "Tugas belum dikumpulkan" },
      { command: "materi", description: "Materi (pilih matkul + link)" },
      { command: "login", description: "Status akun ETHOL" },
      { command: "menu", description: "Menu" },
    ],
  })
  let offset = 0
  for (;;) {
    try {
      const r = await fetch(`${TG}${token}/getUpdates?timeout=50&offset=${offset}`)
      const data = (await r.json()) as { result?: any[] }
      for (const u of data.result ?? []) {
        offset = u.update_id + 1
        const msg = u.message
        const cb = u.callback_query
        if (msg?.text) await handleMsg(token, String(msg.chat.id), msg.text)
        if (cb?.data) {
          const chat = String(cb.message?.chat?.id ?? "")
          await tg(token, "answerCallbackQuery", { callback_query_id: cb.id })
          const cookie = cookieFor(chat)
          if (!cookie) {
            await send(token, chat, LOGIN_HELP)
            continue
          }
          const file = chat === env("TELEGRAM_CHAT_ID") ? COOKIE_FILE : sessionFile(chat)
          const m = /^m:(\d+):(\d+)$/.exec(cb.data)
          if (m) await send(token, chat, await textMateri(cookie, file, m[1], m[2]))
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
        const d = await data(loadCookie(), COOKIE_FILE)
        json(res, 200, { badge: d.badge, notifications: d.notifications })
        return
      }
      if (url === "/v1/courses") {
        json(res, 200, { courses: await courses(loadCookie(), COOKIE_FILE) })
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
      telegramInbox(token).catch((e) => console.error(e))
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

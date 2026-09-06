import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const BASE = "https://ethol.pens.ac.id/api"
const DIR = dirname(fileURLToPath(import.meta.url))
const COOKIE_FILE = join(DIR, ".cookie")
const SEEN_FILE = join(DIR, ".seen.json")
const PRE_FILE = join(DIR, ".presensi.json")
const SESS_DIR = join(DIR, "sessions")
const PORT = 8787
const TG = "https://api.telegram.org/bot"

const WRITE = new Set([
  "/notifikasi/mahasiswa-baca-notif",
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

function assertPostable(path: string) {
  if (path !== "/presensi/mahasiswa") throw new Error(`blocked write: ${path}`)
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

async function post(path: string, body: unknown, cookie = loadCookie(), file = COOKIE_FILE, retried = false): Promise<unknown> {
  assertPostable(path)
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { cookie, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (res.status === 401 && !retried) {
    const next = await refresh(cookie, file)
    return post(path, body, next, file, true)
  }
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 200)}`)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

type Notif = { idNotifikasi: number; kodeNotifikasi?: string; keterangan?: string; waktuNotifikasi?: string }
type Course = { nomor: number; jenisSchema: number; matakuliah: { nama: string }; dosen: string; kuliah_asal?: number | null }
type Tugas = { title: string; deadline_indonesia?: string; submission_time?: string | null }
type Materi = { title: string; path?: string; tipe?: number }
type Slot = {
  matakuliah?: string
  nomor_hari?: number
  jam_awal?: string
  jam_akhir?: string
  ruang?: string
  kode_kelas?: string
  pararel?: string
}
type Me = { nomor: number; nama?: string }
type Sesi = { open?: number; key: string }
type Riwayat = { key: string }
type PresensiCfg = { enabled: boolean; timer: boolean; hours: number; minutes: number; seen: Record<string, number> }
type PresensiHit = {
  nama: string
  kuliah: number
  jenis_schema: number
  key: string
  already: boolean
  payload: { kuliah: number; jenis_schema: number; mahasiswa: number; key: string; kuliah_asal: number | null }
  firstSeen: number
  ready: boolean
  waitMs: number
}

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
    const page = `https://ethol.pens.ac.id/mahasiswa/matakuliah/${c.nomor}/tugas`
    for (const t of open) {
      lines.push(`- ${t.title} · ${t.deadline_indonesia ?? "?"}\n  ${page}`)
    }
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

const HARI = [
  { v: 1, n: "Senin" },
  { v: 2, n: "Selasa" },
  { v: 3, n: "Rabu" },
  { v: 4, n: "Kamis" },
  { v: 5, n: "Jumat" },
  { v: 6, n: "Sabtu" },
  { v: 0, n: "Minggu" },
]

function jam(s?: string) {
  return s ? String(s).slice(0, 5) : "—"
}

async function textJadwal(cookie: string, file: string): Promise<string> {
  const raw = await get("/jadwal/jadwal-online", { tahun: "2026", semester: "1" }, cookie, file)
  const rows = (Array.isArray(raw) ? raw : (raw as { data?: Slot[] })?.data ?? []) as Slot[]
  const seen = new Set<string>()
  const uniq: Slot[] = []
  for (const u of rows) {
    const k = `${u.matakuliah}|${u.nomor_hari}|${u.kode_kelas}|${u.pararel}`
    if (seen.has(k)) continue
    seen.add(k)
    uniq.push(u)
  }
  const lines: string[] = []
  for (const d of HARI) {
    const items = uniq.filter((u) => u.nomor_hari === d.v).sort((a, b) => jam(a.jam_awal).localeCompare(jam(b.jam_awal)))
    if (!items.length) continue
    lines.push(d.n)
    for (const u of items) {
      lines.push(`- ${u.matakuliah ?? "?"} · ${jam(u.jam_awal)}–${jam(u.jam_akhir)} · ${u.ruang ?? "—"}`)
    }
    lines.push("")
  }
  return clip(lines.join("\n").trim() || "Tidak ada jadwal.")
}

function defaultCfg(): PresensiCfg {
  return { enabled: false, timer: false, hours: 0, minutes: 0, seen: {} }
}

function loadCfg(): PresensiCfg {
  try {
    const j = JSON.parse(readFileSync(PRE_FILE, "utf8")) as Partial<PresensiCfg>
    return {
      enabled: !!j.enabled,
      timer: !!j.timer,
      hours: Number.isFinite(j.hours) && (j.hours as number) >= 0 ? Math.floor(j.hours as number) : 0,
      minutes: Number.isFinite(j.minutes) && (j.minutes as number) >= 0 ? Math.floor(j.minutes as number) : 0,
      seen: j.seen && typeof j.seen === "object" ? j.seen : {},
    }
  } catch {
    return defaultCfg()
  }
}

function saveCfg(c: PresensiCfg) {
  writeFileSync(PRE_FILE, JSON.stringify(c, null, 2))
}

function delayMs(c: PresensiCfg) {
  return (c.hours * 60 + c.minutes) * 60 * 1000
}

function seenKey(kuliah: number, js: number, key: string) {
  return `${kuliah}:${js}:${key}`
}

async function scanPresensi(cookie: string, file: string, now = Date.now()): Promise<{ cfg: PresensiCfg; hits: PresensiHit[] }> {
  const cfg = loadCfg()
  const me = (await get("/auth/validasi-token", {}, cookie, file)) as Me
  if (!me?.nomor) throw new Error("no mahasiswa nomor")
  const cs = await courses(cookie, file)
  const hits: PresensiHit[] = []
  const live = new Set<string>()
  for (const c of cs) {
    const js = c.jenisSchema
    const aktif = (await get("/presensi/aktif-kuliah", { kuliah: String(c.nomor), jenis_schema: String(js) }, cookie, file)) as Sesi[]
    const open = (aktif ?? []).find((s) => s.open === 1)
    if (!open?.key) continue
    const sk = seenKey(c.nomor, js, open.key)
    live.add(sk)
    const riwayat = (await get("/presensi/riwayat", { kuliah: String(c.nomor), jenis_schema: String(js), nomor: String(me.nomor) }, cookie, file)) as Riwayat[]
    const already = (riwayat ?? []).some((r) => r.key === open.key)
    const firstSeen = cfg.seen[sk] ?? now
    cfg.seen[sk] = firstSeen
    const wait = cfg.timer ? Math.max(0, firstSeen + delayMs(cfg) - now) : 0
    hits.push({
      nama: c.matakuliah.nama,
      kuliah: c.nomor,
      jenis_schema: js,
      key: open.key,
      already,
      payload: {
        kuliah: c.nomor,
        jenis_schema: js,
        mahasiswa: me.nomor,
        key: open.key,
        kuliah_asal: c.kuliah_asal ?? null,
      },
      firstSeen,
      ready: !already && wait === 0,
      waitMs: wait,
    })
  }
  cfg.seen = Object.fromEntries(Object.entries(cfg.seen).filter(([k]) => live.has(k)))
  saveCfg(cfg)
  return { cfg, hits }
}

function fmtWait(ms: number) {
  const s = Math.ceil(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}j ${m}m` : `${m}m`
}

function textPresensiScan(cfg: PresensiCfg, hits: PresensiHit[]) {
  const head = `toggle ${cfg.enabled ? "on" : "off"} · timer ${cfg.timer ? "on" : "off"} ${cfg.hours}j ${cfg.minutes}m`
  if (!hits.length) return `${head}\nTidak ada presensi terbuka.`
  const lines = [head, ""]
  for (const h of hits) {
    const st = h.already ? "sudah hadir" : h.ready ? "siap POST" : `tunggu ${fmtWait(h.waitMs)}`
    lines.push(`${h.nama} · ${st}`)
    lines.push(`  ${JSON.stringify(h.payload)}`)
  }
  return lines.join("\n")
}

async function cmdPresensi(args: string[]) {
  const a = args[0]
  if (a === "on" || a === "off") {
    const c = loadCfg()
    c.enabled = a === "on"
    saveCfg(c)
    console.log(`toggle ${c.enabled ? "on" : "off"}`)
    return
  }
  if (a === "timer") {
    const c = loadCfg()
    const b = args[1]
    if (b === "on" || b === "off") {
      c.timer = b === "on"
      saveCfg(c)
      console.log(`timer ${c.timer ? "on" : "off"} ${c.hours}j ${c.minutes}m`)
      return
    }
    if (args.length >= 3) {
      const hours = Number(args[1])
      const minutes = Number(args[2])
      if (!Number.isInteger(hours) || hours < 0 || !Number.isInteger(minutes) || minutes < 0) {
        throw new Error("timer jam menit = angka ≥ 0")
      }
      c.timer = true
      c.hours = hours
      c.minutes = minutes
      saveCfg(c)
      console.log(`timer on ${c.hours}j ${c.minutes}m`)
      return
    }
    throw new Error("presensi timer on|off|<jam> <menit>")
  }
  const go = a === "go"
  if (a && a !== "go") throw new Error("presensi | presensi on|off | presensi timer … | presensi go")
  const cookie = loadCookie()
  const { cfg, hits } = await scanPresensi(cookie, COOKIE_FILE)
  console.log(textPresensiScan(cfg, hits))
  if (!go) return
  if (!cfg.enabled) {
    console.log("toggle off — tidak POST")
    return
  }
  const ready = hits.filter((h) => h.ready)
  if (!ready.length) {
    console.log("tidak ada yang siap POST")
    return
  }
  for (const h of ready) {
    const r = await post("/presensi/mahasiswa", h.payload, cookie, COOKIE_FILE) as { sukses?: boolean; pesan?: string }
    console.log(h.nama, r?.sukses ? "ok" : "gagal", r?.pesan ?? JSON.stringify(r))
  }
}

function selfCheck() {
  const u = apiUrl("/kuliah", { tahun: "2026", semester: "1" })
  if (u !== "https://ethol.pens.ac.id/api/kuliah?tahun=2026&semester=1") throw new Error(`url join: ${u}`)
  try {
    assertGettable("/notifikasi/mahasiswa-baca-notif")
    throw new Error("write not blocked")
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith("blocked write")) throw e
  }
  try {
    assertPostable("/presensi/buka")
    throw new Error("dosen write not blocked")
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith("blocked write")) throw e
  }
  assertPostable("/presensi/mahasiswa")
  const wait = delayMs({ enabled: false, timer: true, hours: 1, minutes: 15, seen: {} })
  if (wait !== 75 * 60 * 1000) throw new Error(`delay ${wait}`)
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
  keyboard: [[{ text: "Tugas" }, { text: "Materi" }], [{ text: "Jadwal" }]],
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
    await send(token, chat, cookie ? "Menu: Tugas, Materi, Jadwal." : LOGIN_HELP, { reply_markup: menuKb })
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
    return
  }
  if (t === "/jadwal" || t === "Jadwal") {
    await send(token, chat, "Ambil jadwal…")
    await send(token, chat, await textJadwal(cookie, file))
  }
}

async function telegramInbox(token: string) {
  mkdirSync(SESS_DIR, { recursive: true })
  await tg(token, "setMyCommands", {
    commands: [
      { command: "tugas", description: "Tugas belum dikumpulkan" },
      { command: "materi", description: "Materi (pilih matkul + link)" },
      { command: "jadwal", description: "Jadwal seminggu" },
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
else if (cmd === "presensi") {
  cmdPresensi(rest).catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
} else if (!cmd || cmd === "-h") {
  console.log(`node --experimental-strip-types ethol.ts serve
node --experimental-strip-types ethol.ts presensi
node --experimental-strip-types ethol.ts presensi on|off
node --experimental-strip-types ethol.ts presensi timer on|off|<jam> <menit>
node --experimental-strip-types ethol.ts presensi go`)
} else {
  get(cmd, parseParams(rest)).then((d) => console.log(JSON.stringify(d, null, 2)), (e) => {
    console.error(e.message)
    process.exit(1)
  })
}

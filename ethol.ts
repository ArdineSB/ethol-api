import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const BASE = "https://ethol.pens.ac.id/api"
const DIR = dirname(fileURLToPath(import.meta.url))
const COOKIE_FILE = join(DIR, ".cookie")
const SEEN_FILE = join(DIR, ".seen.json")
const PRE_FILE = join(DIR, ".presensi.json")
const LOG_FILE = join(DIR, ".ethol.log")
const LOGIN_FILE = join(DIR, ".login.json")
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

function isOwner(chat: string) {
  return chat === env("TELEGRAM_CHAT_ID")
}

function cookieFileFor(chat: string) {
  return isOwner(chat) ? COOKIE_FILE : sessionFile(chat)
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
type PresensiCfg = {
  enabled: boolean
  timer: boolean
  until: number
  hours: number
  minutes: number
  ask: "" | "tanggal" | "jam" | "menit"
  askY: number
  askM: number
  askD: number
  seen: Record<string, number>
}
type PresensiHit = {
  nama: string
  kuliah: number
  jenis_schema: number
  key: string
  already: boolean
  fresh: boolean
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
  return { enabled: false, timer: false, until: 0, hours: 0, minutes: 0, ask: "", askY: 0, askM: 0, askD: 0, seen: {} }
}

function loadCfg(): PresensiCfg {
  try {
    const j = JSON.parse(readFileSync(PRE_FILE, "utf8")) as Partial<PresensiCfg>
    const ask = j.ask === "tanggal" || j.ask === "jam" || j.ask === "menit" ? j.ask : ""
    return {
      enabled: !!j.enabled,
      timer: !!j.timer,
      until: Number.isFinite(j.until) && (j.until as number) > 0 ? Math.floor(j.until as number) : 0,
      hours: Number.isFinite(j.hours) && (j.hours as number) >= 0 ? Math.floor(j.hours as number) : 0,
      minutes: Number.isFinite(j.minutes) && (j.minutes as number) >= 0 ? Math.floor(j.minutes as number) : 0,
      ask,
      askY: Number.isFinite(j.askY) ? Math.floor(j.askY as number) : 0,
      askM: Number.isFinite(j.askM) ? Math.floor(j.askM as number) : 0,
      askD: Number.isFinite(j.askD) ? Math.floor(j.askD as number) : 0,
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

function untilMs(y: number, m: number, d: number, hh: number, mm: number) {
  const pad = (n: number) => String(n).padStart(2, "0")
  const t = Date.parse(`${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00+07:00`)
  return Number.isFinite(t) ? t : 0
}

function parseTanggal(s: string): { y: number; m: number; d: number } | null {
  const a = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/.exec(s.trim())
  if (a) return { d: +a[1], m: +a[2], y: +a[3] }
  const b = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/.exec(s.trim())
  if (b) return { y: +b[1], m: +b[2], d: +b[3] }
  return null
}

function timerExpired(cfg: PresensiCfg, now = Date.now()) {
  return cfg.timer && cfg.until > 0 && now >= cfg.until
}

function timerActive(cfg: PresensiCfg, now = Date.now()) {
  if (!cfg.timer) return true
  if (!cfg.until) return false
  return now < cfg.until
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
    const fresh = cfg.seen[sk] == null
    const riwayat = (await get("/presensi/riwayat", { kuliah: String(c.nomor), jenis_schema: String(js), nomor: String(me.nomor) }, cookie, file)) as Riwayat[]
    const already = (riwayat ?? []).some((r) => r.key === open.key)
    const firstSeen = cfg.seen[sk] ?? now
    cfg.seen[sk] = firstSeen
    const wait = 0
    hits.push({
      nama: c.matakuliah.nama,
      kuliah: c.nomor,
      jenis_schema: js,
      key: open.key,
      already,
      fresh,
      payload: {
        kuliah: c.nomor,
        jenis_schema: js,
        mahasiswa: me.nomor,
        key: open.key,
        kuliah_asal: c.kuliah_asal ?? null,
      },
      firstSeen,
      ready: !already && timerActive(cfg, now),
      waitMs: wait,
    })
  }
  cfg.seen = Object.fromEntries(Object.entries(cfg.seen).filter(([k]) => live.has(k)))
  saveCfg(cfg)
  return { cfg, hits }
}

function fmtWib(ts: number) {
  const s = new Date(ts).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  return `${s} WIB`
}

function fmtWait(ms: number) {
  const s = Math.ceil(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}j ${m}m` : `${m}m`
}

function textPresensiScan(cfg: PresensiCfg, hits: PresensiHit[], dump = false) {
  const now = Date.now()
  let timerLine = "Timer: OFF (tanpa batas, absen pas dosen buka)"
  if (cfg.timer && !cfg.until) timerLine = "Timer: ON · tanggal/jam batas belum diisi"
  else if (cfg.timer && timerExpired(cfg, now)) timerLine = `Timer: HABIS sejak ${fmtWib(cfg.until)} — auto absen berhenti`
  else if (cfg.timer) timerLine = `Timer: ON sampai ${fmtWib(cfg.until)}`
  const head = `Auto: ${cfg.enabled ? "ON" : "OFF"}\n${timerLine}`
  if (!hits.length) return `${head}\nTidak ada presensi terbuka.`
  const lines = [head, ""]
  for (const h of hits) {
    const st = h.already ? "sudah hadir" : h.ready ? "siap absen sekarang" : "timer habis, tidak auto absen"
    lines.push(`${h.nama} · ${st}`)
    if (dump) lines.push(`  ${JSON.stringify(h.payload)}`)
  }
  return lines.join("\n")
}

function presensiInline(c: PresensiCfg) {
  return {
    inline_keyboard: [[
      { text: `Auto: ${c.enabled ? "ON" : "OFF"}`, callback_data: "p:auto" },
      { text: `Timer: ${c.timer ? "ON" : "OFF"}`, callback_data: "p:timer" },
    ]],
  }
}

async function postReady(cookie: string, file: string, hits: PresensiHit[]): Promise<string[]> {
  const out: string[] = []
  for (const h of hits.filter((x) => x.ready)) {
    const r = await post("/presensi/mahasiswa", h.payload, cookie, file) as { sukses?: boolean; pesan?: string }
    const ok = !!r?.sukses
    out.push(ok
      ? `Presensi otomatis tercatat\n${h.nama}\n${r?.pesan ?? "hadir"}\n${fmtWib(Date.now())}`
      : `Presensi otomatis gagal\n${h.nama}\n${r?.pesan ?? "gagal"}`)
  }
  return out
}

async function tickPresensi(cookie: string, file: string): Promise<string[]> {
  const cfg = loadCfg()
  if (!cfg.enabled) return []
  const { hits } = await scanPresensi(cookie, file)
  const notes = await postReady(cookie, file, hits)
  for (const h of hits) {
    if (!h.already && h.fresh) {
      if (h.ready) notes.push(`Presensi buka: ${h.nama}\nAuto absen sekarang${cfg.until ? `\nBatas ${fmtWib(cfg.until)}` : ""}`)
      else notes.push(`Presensi buka: ${h.nama}\nTimer sudah habis, tidak auto absen`)
    }
  }
  return notes
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
    if (args.length >= 4) {
      const tgl = parseTanggal(args[1])
      const hours = Number(args[2])
      const minutes = Number(args[3])
      if (!tgl || !Number.isInteger(hours) || hours < 0 || hours > 23 || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
        throw new Error("presensi timer DD-MM-YYYY jam menit")
      }
      const until = untilMs(tgl.y, tgl.m, tgl.d, hours, minutes)
      if (!until) throw new Error("tanggal/jam tidak valid")
      c.timer = true
      c.hours = hours
      c.minutes = minutes
      c.until = until
      saveCfg(c)
      console.log(`timer on sampai ${fmtWib(until)}`)
      return
    }
    throw new Error("presensi timer on|off|DD-MM-YYYY jam menit")
  }
  const go = a === "go"
  if (a && a !== "go") throw new Error("presensi | presensi on|off | presensi timer … | presensi go")
  const cookie = loadCookie()
  const { cfg, hits } = await scanPresensi(cookie, COOKIE_FILE)
  console.log(textPresensiScan(cfg, hits, true))
  if (!go) return
  if (!cfg.enabled) {
    console.log("toggle off — tidak POST")
    return
  }
  const posted = await postReady(cookie, COOKIE_FILE, hits)
  console.log(posted.length ? posted.join("\n") : "tidak ada yang siap POST")
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
  const wait = delayMs({ enabled: false, timer: true, until: 0, hours: 1, minutes: 15, ask: "", askY: 0, askM: 0, askD: 0, seen: {} })
  if (wait !== 75 * 60 * 1000) throw new Error(`delay ${wait}`)
  const u2 = untilMs(2026, 9, 16, 22, 0)
  if (!u2 || !fmtWib(u2).includes("2026") || !fmtWib(u2).includes("WIB")) throw new Error("until wib")
  if (parseTanggal("16-09-2026")?.d !== 16) throw new Error("tgl")
  const own = env("TELEGRAM_CHAT_ID")
  if (own && cookieFileFor(own) !== COOKIE_FILE) throw new Error("owner file")
  if (cookieFileFor("999") !== sessionFile("999")) throw new Error("friend file")
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
  keyboard: [[{ text: "Tugas" }, { text: "Materi" }], [{ text: "Jadwal" }, { text: "Presensi" }]],
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

function logLine(msg: string) {
  const line = `${new Date().toISOString()} ${msg}`
  console.error(line)
  try { appendFileSync(LOG_FILE, line + "\n") } catch { /* disk */ }
}

function friendlyErr(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e)
  if (/refresh failed|401/.test(msg)) return `Session ETHOL mati (${msg}). Buka ethol.pens.ac.id di Zen, session perlu di-capture lagi.`
  return `Error: ${msg}`
}

let lastReport = ""
let lastReportAt = 0
async function report(token: string, chat: string, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e)
  logLine(msg)
  const now = Date.now()
  if (msg === lastReport && now - lastReportAt < 15 * 60 * 1000) return
  lastReport = msg
  lastReportAt = now
  try { await send(token, chat, friendlyErr(e)) } catch (se) {
    logLine(`tg report failed: ${se instanceof Error ? se.message : se}`)
  }
}

async function telegramTick(token: string, chat: string) {
  try {
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
    } else {
      const have = new Set(seen)
      for (const n of notifications.filter((x) => !have.has(x.idNotifikasi))) {
        await send(token, chat, [n.kodeNotifikasi, n.keterangan, n.waktuNotifikasi].filter(Boolean).join("\n") || String(n.idNotifikasi))
      }
      writeFileSync(SEEN_FILE, JSON.stringify([...new Set([...ids, ...seen])].slice(0, 500)))
    }
    for (const n of await tickPresensi(cookie, file)) await send(token, chat, n)
  } catch (e) {
    await report(token, chat, e)
  }
}

const LOGIN_HELP = `Akun ETHOL per Telegram, bukan share satu session.

Ketik /login — buka link, login ETHOL akun kamu, lalu Done.
Jangan kirim password ke chat.`

type LoginRun = { secret: string; pids: number[]; started: number; chat: string }
let loginTimer: ReturnType<typeof setTimeout> | undefined
let loginNotify: { token: string; chat: string } | undefined

function loadLogin(): LoginRun | null {
  try {
    return JSON.parse(readFileSync(LOGIN_FILE, "utf8")) as LoginRun
  } catch {
    return null
  }
}

function killPid(pid: number) {
  try { process.kill(pid, "TERM") } catch { /* gone */ }
}

function writeVncNginx(secret: string | null) {
  const p = "/etc/nginx/snippets/ethol-vnc.conf"
  if (!existsSync("/etc/nginx/snippets")) return
  const body = secret
    ? `location /v/${secret}/ {
    proxy_pass http://127.0.0.1:6080/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
`
    : "# idle\n"
  writeFileSync(p, body)
  spawn("nginx", ["-s", "reload"], { stdio: "ignore" })
}

function stopLoginProcs() {
  const run = loadLogin()
  if (run) for (const pid of run.pids) killPid(pid)
  try { fetch("http://127.0.0.1:9876/quit").catch(() => {}) } catch { /* */ }
  try { unlinkSync(LOGIN_FILE) } catch { /* */ }
  writeVncNginx(null)
  if (loginTimer) clearTimeout(loginTimer)
  loginTimer = undefined
}

async function reapDeadLogin() {
  try {
    const r = await fetch("http://127.0.0.1:9876/dump")
    if (r.ok) return
  } catch { /* down */ }
  try { unlinkSync(LOGIN_FILE) } catch { /* */ }
  writeVncNginx(null)
}

function spawnBg(cmd: string, args: string[], extra: Record<string, string> = {}) {
  const p = spawn(cmd, args, { detached: true, stdio: "ignore", env: { ...process.env, ...extra } })
  p.unref()
  if (!p.pid) throw new Error(`spawn ${cmd}`)
  return p.pid
}

function vncUrl(secret: string) {
  return `https://login.ardeen.fun/v/${secret}/vnc.html?autoconnect=1&resize=scale&path=v/${secret}/websockify`
}

function loginKb() {
  return { inline_keyboard: [[{ text: "Done", callback_data: "p:done" }]] }
}

async function waitDump(ms = 25000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch("http://127.0.0.1:9876/dump")
      if (r.ok) return
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error("browser ETHOL tidak nyala")
}

async function openVnc(token: string, chat: string) {
  mkdirSync(SESS_DIR, { recursive: true })
  const live = loadLogin()
  if (live) {
    try {
      const r = await fetch("http://127.0.0.1:9876/dump")
      if (r.ok) {
        if (live.chat === chat) {
          await send(token, chat, `Masih nyala. Login ETHOL di link ini, lalu Done.\n${vncUrl(live.secret)}`, { reply_markup: loginKb() })
        } else {
          await send(token, chat, "Sesi login sedang dipakai orang lain. Tunggu Done/timeout, lalu /login lagi.")
        }
        return
      }
    } catch { /* restart */ }
    stopLoginProcs()
  }
  await send(token, chat, "Nyalain browser login…")
  const secret = randomBytes(16).toString("hex")
  const pids: number[] = []
  pids.push(spawnBg("Xvfb", [":99", "-screen", "0", "1280x800x24", "-ac"]))
  await new Promise((r) => setTimeout(r, 400))
  pids.push(spawnBg("x11vnc", ["-display", ":99", "-localhost", "-nopw", "-forever", "-shared", "-rfbport", "5900", "-q"]))
  pids.push(spawnBg("websockify", ["--web", "/usr/share/novnc", "127.0.0.1:6080", "127.0.0.1:5900"]))
  pids.push(spawnBg("node", [join(DIR, "login-session.mjs")], { DISPLAY: ":99" }))
  writeFileSync(LOGIN_FILE, JSON.stringify({ secret, pids, started: Date.now(), chat }))
  writeVncNginx(secret)
  loginNotify = { token, chat }
  if (loginTimer) clearTimeout(loginTimer)
  loginTimer = setTimeout(() => {
    stopLoginProcs()
    send(token, chat, "Login timeout (12 menit). Browser dimatikan. /login lagi kalau perlu.").catch(() => {})
  }, 12 * 60 * 1000)
  await waitDump()
  await send(token, chat, `Buka, login ETHOL akun kamu, lalu pencet Done.\n${vncUrl(secret)}`, { reply_markup: loginKb() })
}

async function finishVnc(token: string, chat: string) {
  const run = loadLogin()
  if (!run) {
    await send(token, chat, "Tidak ada sesi login. Ketik /login.")
    return
  }
  if (run.chat && run.chat !== chat) {
    await send(token, chat, "Ini sesi login orang lain. Tunggu selesai, lalu /login.")
    return
  }
  let cookies: { name: string; value: string }[] = []
  try {
    const r = await fetch("http://127.0.0.1:9876/dump")
    if (r.ok) cookies = await r.json() as { name: string; value: string }[]
  } catch { /* dump dead */ }
  const tokenC = cookies.find((c) => c.name === "token")
  const refreshC = cookies.find((c) => c.name === "refresh_token")
  if (!tokenC?.value || !refreshC?.value) {
    stopLoginProcs()
    await send(token, chat, "Login batal — belum ada session ETHOL. Browser dimatikan.")
    return
  }
  const file = cookieFileFor(chat)
  mkdirSync(SESS_DIR, { recursive: true })
  writeCookie(file, `refresh_token=${refreshC.value}; token=${tokenC.value}`)
  stopLoginProcs()
  const me = (await get("/auth/validasi-token", {}, readFileSync(file, "utf8").trim(), file)) as Me
  await send(token, chat, `Terhubung: ${me.nama ?? "ok"}`)
}

async function sendPresensiPanel(token: string, chat: string, cookie: string, file: string) {
  await send(token, chat, "Cek presensi…")
  const { cfg, hits } = await scanPresensi(cookie, file)
  await send(token, chat, textPresensiScan(cfg, hits), { reply_markup: presensiInline(cfg) })
}

async function handlePresensiCb(token: string, chat: string, cookie: string, file: string, data: string) {
  const c = loadCfg()
  if (data === "p:auto") {
    c.enabled = !c.enabled
    c.ask = ""
    saveCfg(c)
    await send(token, chat, `Auto ${c.enabled ? "ON" : "OFF"}`, { reply_markup: presensiInline(c) })
    if (c.enabled) {
      for (const n of await tickPresensi(cookie, file)) await send(token, chat, n)
    }
    return
  }
  if (data === "p:timer") {
    c.timer = !c.timer
    if (c.timer) {
      c.ask = "tanggal"
      saveCfg(c)
      await send(token, chat, "Tanggal batas? (contoh 16-09-2026)", { reply_markup: presensiInline(c) })
      return
    }
    c.ask = ""
    saveCfg(c)
    await send(token, chat, "Timer OFF", { reply_markup: presensiInline(c) })
  }
}

async function handleMsg(token: string, chat: string, text: string) {
  const t = text.trim()
  const cookie = cookieFor(chat)
  const file = cookie && chat === env("TELEGRAM_CHAT_ID") ? COOKIE_FILE : sessionFile(chat)
  if (t === "/start" || t === "/menu") {
    await send(token, chat, cookie ? "Menu: Tugas, Materi, Jadwal." : "Ketik /login buat hubungkan ETHOL (akun kamu sendiri).", { reply_markup: menuKb })
    return
  }
  if (t === "/login") {
    const file = cookieFileFor(chat)
    const ck = cookieFor(chat)
    if (ck) {
      try {
        const me = (await get("/auth/validasi-token", {}, ck, file)) as Me
        await send(token, chat, `Terhubung: ${me.nama ?? "ok"}`, {
          reply_markup: { inline_keyboard: [[{ text: "Login ulang", callback_data: "p:vnc" }]] },
        })
        return
      } catch { /* recapture */ }
    }
    await openVnc(token, chat)
    return
  }
  if (t === "/logout") {
    const live = loadLogin()
    if (live?.chat === chat) stopLoginProcs()
    try { unlinkSync(cookieFileFor(chat)) } catch { /* none */ }
    await send(token, chat, "Session ETHOL dihapus. /login lagi kalau perlu.")
    return
  }
  if (!cookie) {
    await send(token, chat, LOGIN_HELP)
    return
  }
  const owner = chat === env("TELEGRAM_CHAT_ID")
  const cfg = loadCfg()
  if (owner && (cfg.ask === "tanggal" || cfg.ask === "jam" || cfg.ask === "menit") && !t.startsWith("/") && t !== "Tugas" && t !== "Materi" && t !== "Jadwal" && t !== "Presensi") {
    if (cfg.ask === "tanggal") {
      const tgl = parseTanggal(t)
      if (!tgl || tgl.m < 1 || tgl.m > 12 || tgl.d < 1 || tgl.d > 31) {
        await send(token, chat, "Format tanggal: 16-09-2026")
        return
      }
      cfg.askY = tgl.y
      cfg.askM = tgl.m
      cfg.askD = tgl.d
      cfg.ask = "jam"
      saveCfg(cfg)
      await send(token, chat, "Jam batas? (0–23, angka saja)")
      return
    }
    if (!/^\d+$/.test(t)) {
      await send(token, chat, "Angka saja.")
      return
    }
    const n = Number(t)
    if (cfg.ask === "jam") {
      if (n > 23) {
        await send(token, chat, "Jam 0–23.")
        return
      }
      cfg.hours = n
      cfg.ask = "menit"
      saveCfg(cfg)
      await send(token, chat, "Menit batas? (0–59, angka saja)")
      return
    }
    if (n > 59) {
      await send(token, chat, "Menit 0–59.")
      return
    }
    cfg.minutes = n
    cfg.until = untilMs(cfg.askY, cfg.askM, cfg.askD, cfg.hours, cfg.minutes)
    cfg.ask = ""
    cfg.timer = true
    saveCfg(cfg)
    if (!cfg.until) {
      await send(token, chat, "Tanggal/jam tidak valid. Timer ON lagi.")
      return
    }
    await send(token, chat, `Timer ON sampai\n${fmtWib(cfg.until)}`, { reply_markup: presensiInline(cfg) })
    return
  }
  if (t === "/tugas" || t === "Tugas") {
    const c = loadCfg()
    if (c.ask) {
      c.ask = ""
      saveCfg(c)
    }
    await send(token, chat, "Ambil tugas belum…")
    await send(token, chat, await textTugas(cookie, file))
    return
  }
  if (t === "/materi" || t === "Materi") {
    const c = loadCfg()
    if (c.ask) {
      c.ask = ""
      saveCfg(c)
    }
    const cs = await courses(cookie, file)
    const buttons = cs.map((c0) => [{
      text: c0.matakuliah.nama.slice(0, 60),
      callback_data: `m:${c0.nomor}:${c0.jenisSchema}`,
    }])
    await send(token, chat, "Pilih matakuliah:", { reply_markup: { inline_keyboard: buttons } })
    return
  }
  if (t === "/jadwal" || t === "Jadwal") {
    const c = loadCfg()
    if (c.ask) {
      c.ask = ""
      saveCfg(c)
    }
    await send(token, chat, "Ambil jadwal…")
    await send(token, chat, await textJadwal(cookie, file))
    return
  }
  if (t === "/presensi" || t === "Presensi") {
    if (!owner) {
      await send(token, chat, "Presensi cuma di chat owner.")
      return
    }
    const c = loadCfg()
    c.ask = ""
    saveCfg(c)
    await sendPresensiPanel(token, chat, cookie, file)
  }
}

async function telegramInbox(token: string) {
  mkdirSync(SESS_DIR, { recursive: true })
  await tg(token, "setMyCommands", {
    commands: [
      { command: "tugas", description: "Tugas belum dikumpulkan" },
      { command: "materi", description: "Materi (pilih matkul + link)" },
      { command: "jadwal", description: "Jadwal seminggu" },
      { command: "presensi", description: "Auto-presensi (toggle + timer)" },
      { command: "login", description: "Hubungkan ETHOL" },
      { command: "logout", description: "Hapus session ETHOL" },
      { command: "menu", description: "Menu" },
    ],
  })
  let offset = 0
  for (;;) {
    try {
      const r = await fetch(`${TG}${token}/getUpdates?timeout=50&offset=${offset}`)
      if (!r.ok) throw new Error(`telegram getUpdates ${r.status} ${(await r.text()).slice(0, 120)}`)
      const data = (await r.json()) as { result?: any[] }
      for (const u of data.result ?? []) {
        offset = u.update_id + 1
        const msg = u.message
        const cb = u.callback_query
        if (msg?.text) {
          try {
            await handleMsg(token, String(msg.chat.id), msg.text)
          } catch (e) {
            await report(token, String(msg.chat.id), e)
          }
        }
        if (cb?.data) {
          const chat = String(cb.message?.chat?.id ?? "")
          try {
            await tg(token, "answerCallbackQuery", { callback_query_id: cb.id })
            if (cb.data === "p:vnc" || cb.data === "p:done") {
              if (cb.data === "p:vnc") await openVnc(token, chat)
              else await finishVnc(token, chat)
              continue
            }
            const cookie = cookieFor(chat)
            if (!cookie) {
              await send(token, chat, LOGIN_HELP)
              continue
            }
            const file = chat === env("TELEGRAM_CHAT_ID") ? COOKIE_FILE : sessionFile(chat)
            if (cb.data === "p:auto" || cb.data === "p:timer") {
              if (chat !== env("TELEGRAM_CHAT_ID")) {
                await send(token, chat, "Presensi cuma di chat owner.")
                continue
              }
              await handlePresensiCb(token, chat, cookie, file, cb.data)
              continue
            }
            const m = /^m:(\d+):(\d+)$/.exec(cb.data)
            if (m) await send(token, chat, await textMateri(cookie, file, m[1], m[2]))
          } catch (e) {
            await report(token, chat, e)
          }
        }
      }
    } catch (e) {
      logLine(`inbox ${e instanceof Error ? e.message : e}`)
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
    reapDeadLogin().catch((e) => logLine(`reap ${e instanceof Error ? e.message : e}`))
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

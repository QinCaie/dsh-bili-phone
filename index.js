/**
 * dsh-bili-phone —— 每天在谷时随机时间，让她用手机刷 B 站，然后按自己的人格 @ 你
 * ============================================================================
 * 分工：
 *   插件   → 决定"今天几点"（谷时窗口里随机）、到点叫醒她、把"该刷 B 站了"这段任务
 *            注入给她那一轮
 *   她的工具 → mcp__phone__*（开 B 站、截图、滑动、看内容）、mcp__snowluma__qq_send_message（@ 他）
 *
 * 为什么要注入任务而不是只叫醒：她被唤醒时如果只收到"你有机会说话"，很可能就随便
 * 说句话——那和"刷完 B 站再分享"是两回事。
 * ============================================================================
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadHostDeps } from './lib/hostdeps.mjs'

let hostDeps = { z: null, defineTool: null }
try { hostDeps = await loadHostDeps() } catch (e) {
  console.log(`[bili-phone] 取宿主依赖失败：${e?.message ?? e}`)
}
const defineTool = hostDeps.defineTool || ((o) => o)

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))

export const name = 'bili-phone'
export const inject = ['tools', 'webServer', 'agents']

const DEFAULTS = {
  enabled: true,
  bridgeUrl: 'http://127.0.0.1:3100',
  consoleTokenFile: 'D:\\Ayu\\qq-bridge\\state\\console-token',
  targets: ['private:2463543687'],
  // B 站评论区 @ 谁：填的是**B 站昵称**，不是 QQ 号。
  // 评论工具的 @ 搜索按昵称找人（打 "QinCaie" 只会命中「芹菜QinCaie」）。
  biliNick: 'QinCaie',
  biliPackage: 'tv.danmaku.bili',
  stateFile: 'D:\\Ayu\\qq-bridge\\state\\bili-phone.json',

  // 谷时窗口（可多个；支持跨零点）
  windows: [
    { start: '12:00', end: '14:00' },
    { start: '01:00', end: '07:30' },
  ],
  dailyMax: 1,
  browseMinutes: 10,

  // 内容红线：既约束"挑什么视频"，也约束"评论怎么写"。
  // 放在配置里 ⇒ 设置页随时能改，改完下一轮就生效，不用重启。
  contentRules: [
    '只挑轻松的看：萌宠、搞笑、美食、游戏、音乐、科普、手工。',
    '不点：政治、社会新闻、灾难事故、医疗疾病、擦边、骂战、扒人隐私这类。',
    '【绝对不提他】评论里不许出现任何跟他有关的内容：不提他这个人、不提你们的对话、不提他的隐私、住址、样貌、工作、家人。评论区里只有你和视频，没有他。',
    '评论只说视频本身，一到两句，总共不超过 30 个字。',
    '不写需要费力琢磨的长评论；想不出来就写一句大白话，写不出就不用 @ 他。',
    '最多只发一条评论。别人的评论一律不回复——真要回也只回一条，不超过 20 字，不回第二条。',
    '不碰地域、性别、民族、宗教、职业、收入、身材外貌、年龄这些话题。',
    '不写广告、不引流、不带节奏、不玩烂梗。',
    '只 @ 他一个人，不要 @ 别人。',
    'emoji 最多一个；不要“哈哈哈哈哈”堆一排。',
    '用词温和，不阴阳怪气，不装专家。',
    '拿不准该不该评论，就换一个视频；还是拿不准，今天就不发。',
  ],
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch === undefined ? base : patch
  const out = Array.isArray(base) ? [...base] : { ...base }
  for (const [k, v] of Object.entries(patch)) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k]))
      ? deepMerge(base[k], v)
      : v
  }
  return out
}

const pad = (n) => String(n).padStart(2, '0')
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hhmm = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const minutesOf = (hhmmStr) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmmStr || ''))
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

export function apply(ctx) {
  const log = (m) => console.log(`[bili-phone] ${m}`)

  let cfg = deepMerge(DEFAULTS, {})
  const cfgFile = join(PLUGIN_DIR, 'config.json')
  function loadCfg() {
    try { if (existsSync(cfgFile)) cfg = deepMerge(DEFAULTS, JSON.parse(readFileSync(cfgFile, 'utf8'))) } catch {}
  }
  function saveCfg(patch) {
    const next = deepMerge(cfg, patch || {})
    try { writeFileSync(cfgFile, JSON.stringify(next, null, 2), 'utf8') } catch {}
    cfg = next
    return cfg
  }
  loadCfg()

  let st = { day: '', firedAt: 0, nextAt: 0, history: [] }
  try { if (existsSync(cfg.stateFile)) st = { ...st, ...JSON.parse(readFileSync(cfg.stateFile, 'utf8')) } } catch {}
  const saveState = () => {
    try { mkdirSync(dirname(cfg.stateFile), { recursive: true }); writeFileSync(cfg.stateFile, JSON.stringify(st, null, 2), 'utf8') } catch {}
  }

  /** 今天/明天，在谷时窗口里随机取一个时刻（毫秒） */
  function pickNextFire(now = Date.now()) {
    const wins = Array.isArray(cfg.windows) ? cfg.windows : []
    const candidates = []
    for (const w of wins) {
      const s = minutesOf(w.start)
      const e = minutesOf(w.end)
      if (s === null || e === null || s === e) continue
      const span = e > s ? e - s : (1440 - s) + e
      const offset = Math.floor(Math.random() * Math.max(1, span))
      const startOfDay = new Date(now)
      startOfDay.setHours(0, 0, 0, 0)
      let at = startOfDay.getTime() + (s + offset) * 60000
      // 跨零点的窗口：超过 24 点要顺延
      if (at <= now) at += 24 * 3600 * 1000
      candidates.push(at)
    }
    return candidates.length ? Math.min(...candidates) : null
  }

  let timer = null
  function scheduleNext() {
    if (timer) { clearTimeout(timer); timer = null }
    if (!cfg.enabled) { st.nextAt = 0; saveState(); return }
    const next = pickNextFire()
    if (!next) { log('没有可用的谷时窗口，跳过排期'); return }
    st.nextAt = next
    saveState()
    const waitMs = Math.max(5000, next - Date.now())
    log(`下次刷 B 站：${new Date(next).toLocaleString('zh-CN')}（${Math.round(waitMs / 60000)} 分钟后）`)
    timer = setTimeout(fire, waitMs)
  }

  async function fireWake(reason) {
    const targets = Array.isArray(cfg.targets) ? cfg.targets : []
    const target = targets[0]
    if (!target) return { ok: false, error: '没有配置 targets' }
    let token = ''
    try { token = readFileSync(cfg.consoleTokenFile, 'utf8').trim() } catch { return { ok: false, error: '读不到 console-token' } }
    const url = `${String(cfg.bridgeUrl).replace(/\/$/, '')}/api/socialV2/wake`
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-console-token': token },
        body: JSON.stringify({ key: target, reason: reason || 'bili-phone' }),
      })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      return { ok: true, target }
    } catch (e) { return { ok: false, error: e?.message ?? String(e) } }
  }

  async function fire() {
    timer = null
    try {
      loadCfg()
      if (!cfg.enabled) return
      const today = dayKey()
      if (st.day === today && st.firedAt) { scheduleNext(); return }

      st.day = today
      st.firedAt = Date.now()
      st.browseUntil = Date.now() + Number(cfg.browseMinutes ?? 10) * 60000
      st.history = [...(st.history || []).slice(-19), { at: st.firedAt }]
      saveState()

      log('到点了，叫醒她去刷 B 站')
      const r = await fireWake('bili-phone')
      if (!r.ok) log(`唤醒失败：${r.error}`)
    } catch (e) {
      log(`出错：${e?.message ?? e}`)
    }
    scheduleNext()
  }

  // ── 把任务注入给她那一轮 ───────────────────────────────────
  // 这套步骤是 2026-10-21 在真机上一步步跑通并验证过的（含一次真实评论发布）。
  //
  // 省 token 的三条原则：
  //   ① 整个「搜索→开视频→进评论→@→发布」已经做成服务端工具 mcp__phone__bili_comment，
  //      她调一次就够（以前一步步手动操作要 16 次往返，光上下文重发就上万 token）；
  //   ② 别用 screenshot 逐屏看 —— 工具会自己返回一张带确认的图；
  //   ③ 任务书本身也要短。
  const buildTask = () => {
    // 群里 @ 用固定的管理员 QQ；B 站评论区 @ 用的是昵称（设置页里那一项）。
    const ownerQQ = '2463543687'
    const nick = String(cfg.biliNick || 'QinCaie').trim()
    const mins = Number(cfg.browseMinutes ?? 10)
    const target = (Array.isArray(cfg.targets) ? cfg.targets[0] : '') || ''
    const isGroup = target.startsWith('group:')
    return [
      '【今天该刷会儿 B 站了】',
      `你还有点自己的时间，最多 ${mins} 分钟。`,
      '',
      '整套操作已经做成一个工具，调一次就行：',
      `  mcp__phone__bili_comment(comment: "你写的话", keyword: "想搜的词", atName: "${nick}")`,
      '  · 它会自己开 B 站、搜视频、进评论、@ 他、发布，最后回一张确认图。',
      `  · atName 是他在 B 站的昵称（${nick}），照原样传，别改成别的写法。`,
      '  · 失败会告诉你卡在哪一步（返回里的 step 字段），照它说的原因判断，别反复重试。',
      '  · 想先看看效果不想真发，加 dryRun: true。',
      '',
      '写什么：结合视频内容，一两句，≤30 字，用你平时说话的语气。',
      isGroup ? `发完去群里 @他：qq_send_message 的 atUserId=${ownerQQ}。` : '发完回 QQ 说一句：刷到什么、评论写了什么。',
      '',
      '规矩：',
      '- 一轮只调一次，失败就跟他说明天再试——别连着重试，会被风控。',
      '- 一天就这一条评论。',
      '',
      '【内容红线（必须守）】',
      ...(Array.isArray(cfg.contentRules) ? cfg.contentRules : []).map((r, i) => `${i + 1}. ${r}`),
    ].filter(Boolean).join('\n')
  }

  function attachInjection(agent) {
    const agentCtx = agent?.ctx
    if (!agentCtx?.on) return
    try {
      agentCtx.on('agent/pre-step', async (_payload, next) => {
        const decision = await next()
        try {
          if (decision?.kind !== 'enter') return decision
          const h = agent?.session?.header ?? {}
          const isQq = /qq-bridge/i.test(String(h.cwd ?? '')) || /^qq-chat/.test(String(h.agentPreset ?? ''))
          if (!isQq) return decision
          if (!st.browseUntil || Date.now() > st.browseUntil) return decision

          st.browseUntil = 0
          saveState()
          const msg = Object.freeze({
            id: randomUUID(),
            role: 'user',
            content: [{ type: 'text', text: buildTask() }],
            source: { kind: 'bili-phone', form: 'notice', summary: '刷 B 站任务' },
          })
          log('任务已注入给她')
          return { ...decision, messages: [...decision.messages, msg] }
        } catch { return decision }
      }, { prepend: true })
    } catch {}
  }

  try {
    for (const a of ctx.agents?.list?.() ?? []) attachInjection(a)
    ctx.on('agent/created', (p) => { const a = p?.agent ?? p; if (a) attachInjection(a) })
  } catch (e) { log(`注入挂载失败：${e?.message ?? e}`) }

  scheduleNext()
  ctx.effect(() => () => { if (timer) clearTimeout(timer) }, 'bili-phone: 调度器')

  // ── 工具 ───────────────────────────────────────────────────
  const textOutput = {
    schema: { type: 'object', properties: {}, additionalProperties: true },
    render: (_a, v) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }],
  }
  const tool = (spec) => ctx.tools.register(defineTool({ ...spec, output: textOutput }))

  tool({
    name: 'bili_phone_status',
    description: '看"每天刷 B 站"的排期：今天刷过没、下次几点、谷时窗口是什么。',
    parameters: {},
    async execute() {
      return {
        ok: true,
        enabled: cfg.enabled,
        windows: (cfg.windows || []).map((w) => `${w.start}–${w.end}`),
        dailyMax: cfg.dailyMax,
        todayFired: st.day === dayKey() && Boolean(st.firedAt),
        firedAt: st.firedAt ? new Date(st.firedAt).toLocaleString('zh-CN') : null,
        nextAt: st.nextAt ? new Date(st.nextAt).toLocaleString('zh-CN') : null,
        nextInMinutes: st.nextAt ? Math.max(0, Math.round((st.nextAt - Date.now()) / 60000)) : null,
        biliPackage: cfg.biliPackage,
        biliNick: cfg.biliNick,
        history: (st.history || []).slice(-5),
      }
    },
  })

  tool({
    name: 'bili_phone_now',
    description: '现在就来一次"刷 B 站"（立刻叫醒并注入任务，不等排期）。',
    parameters: {},
    async execute() {
      st.day = dayKey()
      st.firedAt = Date.now()
      st.browseUntil = Date.now() + Number(cfg.browseMinutes ?? 10) * 60000
      saveState()
      return fireWake('bili-phone')
    },
  })

  // ── HTTP（设置页） ────────────────────────────────────────
  const sendJson = (res, code, body) => {
    try { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)) } catch {}
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/api/bili-phone',
    handler: async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      try {
        if (req.method === 'GET' && url.pathname === '/api/bili-phone/config') {
          return sendJson(res, 200, { ok: true, config: cfg, defaults: DEFAULTS })
        }
        if (req.method === 'POST' && url.pathname === '/api/bili-phone/config') {
          const chunks = []
          for await (const c of req) chunks.push(c)
          saveCfg(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
          scheduleNext()
          return sendJson(res, 200, { ok: true, config: cfg })
        }
        if (req.method === 'GET' && url.pathname === '/api/bili-phone/status') {
          return sendJson(res, 200, {
            ok: true,
            state: st,
            nextInMinutes: st.nextAt ? Math.max(0, Math.round((st.nextAt - Date.now()) / 60000)) : null,
          })
        }
        if (req.method === 'POST' && url.pathname === '/api/bili-phone/now') {
          const r = await fireWake('bili-phone')
          return sendJson(res, 200, r)
        }
        return sendJson(res, 404, { ok: false, error: 'not found' })
      } catch (e) { return sendJson(res, 500, { ok: false, error: e?.message ?? String(e) }) }
    },
  }), 'bili-phone: /api/bili-phone 路由')

  log(`已挂载：谷时 ${(cfg.windows || []).map((w) => `${w.start}-${w.end}`).join(' / ')}，每天 ${cfg.dailyMax} 次`)
}

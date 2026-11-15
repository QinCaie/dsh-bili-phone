/**
 * dsh-bili-phone —— 设置页「刷 B 站（手机）」
 *
 * 这版重做的点：
 *   · 状态卡片说清楚三件事：今天刷没刷、下次几点、还剩几分钟
 *   · 时间窗改成时间选择器（不用手打 "01:00"）
 *   · 改动后底部出现「未保存」提示，避免改完忘保存
 *   · 数值都带单位（次/分钟），不再是一个光秃秃的输入框
 *   · 内容红线加条数统计，方便判断是不是写太多了
 *   · 把「@谁」「包名」折进独立的高级卡片，日常不用看
 */
window.__ModuleLoader__.load({
  id: 'dsh-bili-phone',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/api/bili-phone'

    const CSS = `
[data-bp-page]{display:flex;flex-direction:column;gap:14px;padding:4px 2px 12px;max-width:760px;}
[data-bp-card]{border:1px solid rgba(127,127,127,.22);border-radius:12px;padding:14px 16px;background:rgba(127,127,127,.03);}
[data-bp-card] > h4{margin:0 0 4px;font-size:13px;font-weight:600;opacity:.9;display:flex;align-items:center;gap:6px;}
[data-bp-sub]{font-size:12px;opacity:.55;line-height:1.7;margin:0 0 10px;}
[data-bp-row]{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 0;font-size:13px;border-top:1px dashed rgba(127,127,127,.15);}
[data-bp-row]:first-of-type{border-top:none;}
[data-bp-row] > span:first-child{display:flex;flex-direction:column;gap:2px;}
[data-bp-hint]{font-size:11px;opacity:.5;}
[data-bp-num]{display:flex;align-items:center;gap:6px;}
[data-bp-num] input{width:72px;}
[data-bp-unit]{font-size:12px;opacity:.55;}
[data-bp-note]{font-size:12px;opacity:.6;line-height:1.7;}
[data-bp-actions]{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
[data-bp-ok]{color:#3a9a55;font-size:12px;}
[data-bp-err]{color:#c0392b;font-size:12px;}
[data-bp-dirty]{color:#c08b2b;font-size:12px;}
[data-bp-badge]{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;background:rgba(58,154,85,.14);color:#3a9a55;}
[data-bp-badge][data-off]{background:rgba(127,127,127,.14);color:inherit;opacity:.6;}
[data-bp-stat]{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-top:6px;}
[data-bp-kv]{border:1px solid rgba(127,127,127,.16);border-radius:9px;padding:8px 10px;}
[data-bp-kv] b{display:block;font-size:15px;font-weight:600;margin-top:2px;}
[data-bp-ta]{width:100%;min-height:180px;margin-top:8px;font-family:inherit;font-size:13px;line-height:1.75;padding:10px;border-radius:10px;border:1px solid rgba(127,127,127,.28);background:transparent;color:inherit;resize:vertical;}
[data-bp-foot]{position:sticky;bottom:0;display:flex;gap:10px;align-items:center;padding:10px 0 2px;background:linear-gradient(to top,rgba(127,127,127,.06),transparent);}
`

    const asJson = async (res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json() }
    const jget = async (p) => asJson(await fetch(API + p, { credentials: 'same-origin' }))
    const jpost = async (p, body) => asJson(await fetch(API + p, {
      method: 'POST', credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }))

    function Row({ label, hint, children }) {
      return h('div', { 'data-bp-row': '' },
        h('span', null, label, hint ? h('span', { 'data-bp-hint': '' }, hint) : null),
        children)
    }
    const NumWrap = ({ value, onChange, min, max, unit }) => h('span', { 'data-bp-num': '' },
      h('input', {
        type: 'number', min: min ?? 0, max, value: value ?? 0,
        onChange: (e) => onChange(Number(e.target.value)),
      }),
      unit ? h('span', { 'data-bp-unit': '' }, unit) : null)
    const Box = ({ value, onChange }) => h('input', {
      type: 'checkbox', checked: !!value, onChange: (e) => onChange(e.target.checked),
    })
    const Text = ({ value, onChange, placeholder }) => h('input', {
      type: 'text', value: value ?? '', placeholder, onChange: (e) => onChange(e.target.value),
      style: { width: '150px' },
    })
    const Time = ({ value, onChange }) => h('input', {
      type: 'time', value: value ?? '', onChange: (e) => onChange(e.target.value),
      style: { width: '120px' },
    })

    function Panel() {
      const [cfg, setCfg] = React.useState(null)
      const [status, setStatus] = React.useState(null)
      const [msg, setMsg] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [dirty, setDirty] = React.useState(false)

      const load = async () => {
        try {
          const c = await jget('/config'); setCfg(c.config)
          const s = await jget('/status'); setStatus(s)
          setMsg(null); setDirty(false)
        } catch (e) { setMsg({ err: String(e.message || e) }) }
      }
      React.useEffect(() => { load() }, [])

      const patch = (p) => { setCfg({ ...cfg, ...p }); setDirty(true) }

      const save = async () => {
        setBusy(true); setMsg(null)
        try {
          const r = await jpost('/config', cfg)
          setCfg(r.config)
          setDirty(false)
          setMsg({ ok: '已保存，排期已重算' })
          await load()
        } catch (e) { setMsg({ err: String(e.message || e) }) }
        setBusy(false)
      }
      const act = async (p, label) => {
        setBusy(true); setMsg(null)
        try {
          const r = await jpost(p)
          setMsg(r.ok ? { ok: label + '：已叫醒她' } : { err: label + '失败：' + (r.error || '未知错误') })
          await load()
        } catch (e) { setMsg({ err: String(e.message || e) }) }
        setBusy(false)
      }

      if (!cfg) return h('div', { 'data-bp-page': '' }, h('div', { 'data-bp-note': '' }, '读取配置中…'))

      const setWin = (i, key, v) => {
        const wins = (cfg.windows || []).map((w, j) => (j === i ? { ...w, [key]: v } : w))
        patch({ windows: wins })
      }
      const st = status?.state
      const today = new Date()
      const pad = (n) => String(n).padStart(2, '0')
      const dayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
      const firedToday = st?.day === dayKey && st?.firedAt
      const nextAt = st?.nextAt ? new Date(st.nextAt) : null
      const rules = cfg.contentRules || []

      return h('div', { 'data-bp-page': '' },

        // ── 状态 ──────────────────────────────────────────────
        h('div', { 'data-bp-card': '' },
          h('h4', null, '现在什么情况',
            h('span', { 'data-bp-badge': '', 'data-off': cfg.enabled ? undefined : '' }, cfg.enabled ? '已启用' : '已停用')),
          h('div', { 'data-bp-stat': '' },
            h('div', { 'data-bp-kv': '' }, '今天',
              h('b', null, firedToday ? `刷过了（${new Date(st.firedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}）` : '还没刷')),
            h('div', { 'data-bp-kv': '' }, '下次',
              h('b', null, nextAt ? nextAt.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '暂无排期')),
            h('div', { 'data-bp-kv': '' }, '还有',
              h('b', null, status?.nextInMinutes != null ? `${status.nextInMinutes} 分钟` : '—'))),
          h('div', { 'data-bp-actions': '', style: { marginTop: '12px' } },
            h('button', { disabled: busy, onClick: () => act('/now', '立刻来一次') }, '现在就来一次'),
            h('button', { disabled: busy, onClick: load }, '刷新状态')),
          st?.history?.length
            ? h('div', { 'data-bp-note': '', style: { marginTop: '8px' } },
                '最近几次：' + st.history.slice(-5).map((x) =>
                  new Date(x.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })).join('、'))
            : null),

        // ── 什么时候刷 ────────────────────────────────────────
        h('div', { 'data-bp-card': '' },
          h('h4', null, '什么时候刷'),
          h('p', { 'data-bp-sub': '' }, '每天在这些时间段里随机挑一个时刻，不会像闹钟一样固定。支持跨零点，比如 01:00 → 07:30。'),
          h(Row, { label: '启用这个任务', hint: '关掉后不会再自动叫她' },
            h(Box, { value: cfg.enabled, onChange: (v) => patch({ enabled: v }) })),
          (cfg.windows || []).map((w, i) => h(Row, { key: i, label: `时间窗 ${i + 1}` },
            h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
              h(Time, { value: w.start, onChange: (v) => setWin(i, 'start', v) }),
              h('span', { 'data-bp-unit': '' }, '→'),
              h(Time, { value: w.end, onChange: (v) => setWin(i, 'end', v) })))),
          h('div', { 'data-bp-actions': '', style: { marginTop: '8px' } },
            h('button', { onClick: () => patch({ windows: [...(cfg.windows || []), { start: '12:00', end: '14:00' }] }) }, '加一个窗口'),
            (cfg.windows || []).length > 1
              ? h('button', { onClick: () => patch({ windows: cfg.windows.slice(0, -1) }) }, '删掉最后一个')
              : null)),

        // ── 刷多久 / 刷几次 ───────────────────────────────────
        h('div', { 'data-bp-card': '' },
          h('h4', null, '刷多少'),
          h(Row, { label: '每天最多几次' },
            h(NumWrap, { value: cfg.dailyMax, min: 1, unit: '次', onChange: (v) => patch({ dailyMax: v }) })),
          h(Row, { label: '一次最多刷多久', hint: '超过这个时间她就该收尾了' },
            h(NumWrap, { value: cfg.browseMinutes, min: 1, unit: '分钟', onChange: (v) => patch({ browseMinutes: v }) }))),

        // ── 内容红线 ──────────────────────────────────────────
        h('div', { 'data-bp-card': '' },
          h('h4', null, '内容红线',
            h('span', { 'data-bp-badge': '', 'data-off': '' }, `${rules.length} 条`)),
          h('p', { 'data-bp-sub': '' }, '一行一条。既约束她挑什么视频，也约束评论怎么写。保存后下一轮就生效。'),
          h('textarea', {
            'data-bp-ta': '',
            value: rules.join('\n'),
            onChange: (e) => patch({
              contentRules: e.target.value.split('\n').map((x) => x.replace(/\s+$/, '')).filter((x) => x.length > 0),
            }),
          })),

        // ── 高级（日常不用动） ────────────────────────────────
        h('details', { 'data-bp-card': '', style: { cursor: 'pointer' } },
          h('summary', { style: { fontSize: '13px', fontWeight: 600, opacity: .85 } }, '高级设置（一般不用动）'),
          h(Row, { label: 'B 站昵称', hint: '评论区 @ 谁 —— 填 B 站上的昵称，不是 QQ 号' },
            h(Text, { value: cfg.biliNick, onChange: (v) => patch({ biliNick: v }) })),
          h(Row, { label: 'B 站包名', hint: '一般不用改' },
            h(Text, { value: cfg.biliPackage, onChange: (v) => patch({ biliPackage: v }) })),
          h(Row, { label: '唤醒目标', hint: '私聊或群，形如 private:123 / group:456' },
            h(Text, {
              value: (cfg.targets || [])[0] || '',
              onChange: (v) => patch({ targets: v ? [v] : [] }),
            }))),

        // ── 底部 ──────────────────────────────────────────────
        h('div', { 'data-bp-foot': '' },
          h('button', { disabled: busy || !dirty, onClick: save }, dirty ? '保存修改' : '已保存'),
          h('button', { disabled: busy || !dirty, onClick: load }, '放弃修改'),
          dirty ? h('span', { 'data-bp-dirty': '' }, '有未保存的修改') : null,
          msg?.ok ? h('span', { 'data-bp-ok': '' }, msg.ok) : null,
          msg?.err ? h('span', { 'data-bp-err': '' }, msg.err) : null),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-bili-phone')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-bili-phone: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'bili-phone', order: 42, label: '刷B站（手机）' },
          () => h(Panel)))
      },
    }
  },
})

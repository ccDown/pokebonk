/*!
 * PokéBonk 离线版 · 存档管理
 * 游戏的真实进度由本地服务写入 _save/profile.json，
 * 浏览器 localStorage 只存语言、主题等少量偏好。
 * 因此导出时会把「服务端档案 + 浏览器偏好」一起打包成单个 .json，
 * 导入时再分别写回，实现跨设备 / 跨浏览器迁移。
 */
(function () {
  'use strict';
  if (window.__PB_SAVE_MANAGER__) return;
  window.__PB_SAVE_MANAGER__ = true;

  var ACCENT = '#e94756';
  var PANEL_ID = 'pb-save-panel';
  var BTN_ID = 'pb-save-btn';

  /* ---------------- 样式 ---------------- */
  var css = ''
    + '#' + BTN_ID + '{position:fixed;right:10px;bottom:10px;z-index:2147483400;'
    + 'display:flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;'
    + 'border:1px solid rgba(255,255,255,.30);border-radius:50%;background:rgba(255,255,255,.16);'
    + 'color:#fff;font-size:15px;line-height:1;cursor:pointer;backdrop-filter:blur(6px);'
    + 'box-shadow:0 2px 10px rgba(0,0,0,.18);'
    + 'opacity:.55;transition:opacity .18s,transform .18s,background .18s}'
    + 'html[data-theme="light"] #' + BTN_ID + '{background:rgba(36,31,61,.80);'
    + 'border-color:rgba(255,255,255,.16);opacity:.5}'
    + '#' + BTN_ID + ':hover{opacity:1;transform:scale(1.08);background:rgba(233,71,86,.92)}'

    /* 变量：默认深色（游戏 data-theme="dark"） */
    + '#pb-save-panel{--pb-mask:rgba(10,8,22,.66);--pb-card:#1a1630;--pb-line:rgba(255,255,255,.08);'
    + '--pb-fg:#fff;--pb-sub:#9b93c4;--pb-stat:rgba(255,255,255,.05);--pb-label:#8b83b4;'
    + '--pb-code:rgba(255,255,255,.08);--pb-codefg:#cfc8ea;--pb-name:#cfc8ea;'
    + '--pb-ghost:rgba(255,255,255,.09);--pb-ghost-h:rgba(255,255,255,.15);--pb-faint:#6f678f}'
    /* 浅色主题（游戏默认）：白卡片、深字 */
    + 'html[data-theme="light"] #pb-save-panel{--pb-mask:rgba(28,24,48,.42);--pb-card:#fff;'
    + '--pb-line:rgba(36,31,61,.08);--pb-fg:#241f3d;--pb-sub:#6d6790;--pb-stat:#f5f4fa;'
    + '--pb-label:#8580a3;--pb-code:#efedf7;--pb-codefg:#4a4370;--pb-name:#4a4370;'
    + '--pb-ghost:#efedf7;--pb-ghost-h:#e5e2f2;--pb-faint:#8c86a8}'

    + '#pb-save-panel{position:fixed;inset:0;z-index:2147483500;display:none;'
    + 'align-items:center;justify-content:center;background:var(--pb-mask);backdrop-filter:blur(4px);'
    + "font-family:'Segoe UI',system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif}"
    + '#pb-save-panel.on{display:flex}'
    + '.pb-card{width:min(420px,calc(100vw - 32px));background:var(--pb-card);color:var(--pb-fg);'
    + 'border-radius:20px;padding:22px 22px 18px;box-shadow:0 24px 64px rgba(0,0,0,.28);'
    + 'border:1px solid var(--pb-line);animation:pb-in .18s ease-out}'
    + '@keyframes pb-in{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}'
    + '.pb-card h2{margin:0 0 4px;font-size:17px;font-weight:800;letter-spacing:.01em}'
    + '.pb-card .pb-sub{margin:0 0 16px;font-size:12px;line-height:1.6;color:var(--pb-sub)}'
    + '.pb-card .pb-sub code{font:600 11px ui-monospace,Consolas,monospace;background:var(--pb-code);'
    + 'padding:1px 5px;border-radius:5px;color:var(--pb-codefg)}'
    + '.pb-meta{display:flex;gap:8px;margin-bottom:10px}'
    + '.pb-stat{flex:1;background:var(--pb-stat);border-radius:12px;padding:9px 11px}'
    + '.pb-stat b{display:block;font-size:15px;font-weight:800;color:var(--pb-fg)}'
    + '.pb-stat span{font-size:10.5px;color:var(--pb-label);letter-spacing:.03em}'
    + '.pb-name{font-size:12px;color:var(--pb-name);margin:0 0 14px;padding:7px 11px;'
    + 'background:rgba(233,71,86,.10);border-radius:9px;border:1px solid rgba(233,71,86,.22)}'
    + '.pb-row{display:flex;gap:10px;margin-bottom:9px}'
    + '.pb-row button{flex:1;border:0;border-radius:12px;padding:11px 10px;font:700 13px/1 inherit;'
    + 'font-family:inherit;cursor:pointer;transition:transform .12s,filter .12s}'
    + '.pb-row button:hover{transform:translateY(-1px);filter:brightness(1.08)}'
    + '.pb-primary{background:' + ACCENT + ';color:#fff}'
    + '.pb-ghost{background:var(--pb-ghost);color:var(--pb-fg)}'
    + '.pb-ghost:hover{background:var(--pb-ghost-h)}'
    + '.pb-foot{display:flex;justify-content:space-between;align-items:center;margin-top:14px}'
    + '.pb-hint{font-size:11px;color:var(--pb-faint);line-height:1.5;max-width:250px}'
    + '.pb-close{background:transparent;border:0;color:var(--pb-sub);font:600 12px inherit;'
    + 'font-family:inherit;cursor:pointer;padding:6px 8px;border-radius:8px}'
    + '.pb-close:hover{color:var(--pb-fg);background:var(--pb-ghost)}'
    + '.pb-toast{position:fixed;left:50%;bottom:64px;transform:translateX(-50%) translateY(8px);'
    + 'z-index:2147483600;background:#2a2450;color:#fff;padding:9px 16px;border-radius:999px;'
    + 'font:600 12.5px "Segoe UI",system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4);'
    + 'opacity:0;pointer-events:none;transition:opacity .2s,transform .2s}'
    + '.pb-toast.on{opacity:1;transform:translateX(-50%) translateY(0)}';

  var style = document.createElement('style');
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  /* ---------------- 工具 ---------------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function stamp() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  }

  function collect() {
    var data = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k == null) continue;
        var v = localStorage.getItem(k);
        if (v != null) data[k] = v;
      }
    } catch (e) { /* storage blocked */ }
    return data;
  }

  function toast(msg) {
    var t = document.getElementById('pb-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'pb-toast';
      t.className = 'pb-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(t.__timer);
    t.__timer = setTimeout(function () { t.classList.remove('on'); }, 2200);
  }

  /* ---------------- 面板 ---------------- */
  function buildPanel() {
    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = ''
      + '<div class="pb-card" role="dialog" aria-modal="true" aria-label="存档管理">'
      + '  <h2>存档管理</h2>'
      + '  <p class="pb-sub">进度保存在本机 <code>_save</code> 目录，由本地服务托管。导出成文件后，可以在别的电脑上导入接着玩。</p>'
      + '  <div class="pb-meta">'
      + '    <div class="pb-stat"><b id="pb-stat-keys">-</b><span>联盟成员</span></div>'
      + '    <div class="pb-stat"><b id="pb-stat-size">-</b><span>星光</span></div>'
      + '    <div class="pb-stat"><b id="pb-stat-bonk">-</b><span>邦币</span></div>'
      + '  </div>'
      + '  <div class="pb-name" id="pb-stat-name">训练家</div>'
      + '  <div class="pb-row">'
      + '    <button class="pb-primary" id="pb-export">导出存档</button>'
      + '    <button class="pb-ghost" id="pb-import">导入存档</button>'
      + '  </div>'
      + '  <input type="file" id="pb-file" accept=".json,application/json" hidden>'
      + '  <div class="pb-foot">'
      + '    <span class="pb-hint">导入会覆盖当前进度，建议先导出一份备份。</span>'
      + '    <button class="pb-close" id="pb-close">关闭</button>'
      + '  </div>'
      + '</div>';
    document.body.appendChild(panel);

    panel.querySelector('#pb-close').onclick = function () { panel.classList.remove('on'); };
    panel.addEventListener('click', function (e) { if (e.target === panel) panel.classList.remove('on'); });

    panel.querySelector('#pb-export').onclick = doExport;
    panel.querySelector('#pb-import').onclick = function () { panel.querySelector('#pb-file').click(); };
    panel.querySelector('#pb-file').onchange = doImport;

    return panel;
  }

  function refreshStats() {
    var data = collect();
    var el1 = document.getElementById('pb-stat-keys');
    var el2 = document.getElementById('pb-stat-size');
    var el3 = document.getElementById('pb-stat-bonk');
    var name = document.getElementById('pb-stat-name');

    fetch('/save/export', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (s) {
        var p = (s && s.profile) || {};
        if (el1) el1.textContent = (p.league || []).length;
        if (el2) el2.textContent = p.stardust || 0;
        if (el3) el3.textContent = p.bonk || 0;
        if (name) {
          var nm = (s && s.account && s.account.name) || p.name || '训练家';
          var started = p.starter ? '已选伙伴' : '未选伙伴';
          name.textContent = nm + ' · ' + started;
        }
      })
      .catch(function () {
        if (el1) el1.textContent = Object.keys(data).length;
        if (el2) el2.textContent = '浏览器模式';
        if (el3) el3.textContent = '-';
        if (name) name.textContent = '未连接本地服务，进度无法写入文件';
      });
  }

  function openPanel() {
    var p = document.getElementById(PANEL_ID) || buildPanel();
    refreshStats();
    p.classList.add('on');
  }

  /* ---------------- 导出 ---------------- */
  function doExport() {
    Promise.resolve()
      .then(function () { return fetch('/save/export').then(function (r) { return r.json(); }); })
      .catch(function () { return null; })
      .then(function (server) {
        var payload = {
          app: 'PokebonkOffline',
          format: 1,
          exportedAt: new Date().toISOString(),
          note: 'PokéBonk 离线版存档快照（本地档案 + 浏览器数据）',
          server: server,
          localStorage: collect()
        };
        var text = JSON.stringify(payload, null, 2);
        var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'pokebonk-save-' + stamp() + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        toast('存档已导出');
      });
  }

  /* ---------------- 导入 ---------------- */
  function doImport(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function () {
      var payload;
      try {
        payload = JSON.parse(String(reader.result));
      } catch (err) {
        toast('文件格式不对，无法解析');
        return;
      }
      var ls = payload && payload.localStorage ? payload.localStorage : null;
      var server = payload && payload.server ? payload.server : null;
      if (!payload || (typeof payload !== 'object')) { toast('这不是有效的存档文件'); return; }
      if (!ls && !server && !payload.profile) { toast('存档内容为空'); return; }

      var sp = (server && server.profile) || payload.profile || {};
      var who = (server && server.account && server.account.name) || sp.name || '未知训练家';
      var when = (server && server.exportedAt) || payload.exportedAt;
      var whenText = when ? new Date(when).toLocaleString() : '未知时间';
      var summary = who + ' · 星光 ' + (sp.stardust || 0) + ' · 邦币 ' + (sp.bonk || 0)
        + ' · 联盟 ' + ((sp.league || []).length) + ' 只';

      if (!confirm('确定导入这份存档？\n\n' + summary + '\n导出时间：' + whenText
        + '\n\n当前进度会被覆盖，建议先导出一份备份。')) return;

      var done = function () {
        try {
          if (ls) {
            for (var k in ls) {
              if (typeof ls[k] === 'string') localStorage.setItem(k, ls[k]);
            }
          }
        } catch (err) { /* ignore */ }
        toast('导入成功，正在重新载入…');
        setTimeout(function () { location.reload(); }, 800);
      };

      var body = server || (payload.profile ? { profile: payload.profile, account: payload.account } : null);
      if (body) {
        fetch('/save/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }).then(function () { done(); }).catch(function () {
          toast('写入档案失败');
        });
      } else {
        done();
      }
    };
    reader.readAsText(file);
  }

  /* ---------------- 按钮与快捷键 ---------------- */
  function buildButton() {
    var btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.title = '存档管理（Ctrl+Shift+S）';
    btn.setAttribute('aria-label', '存档管理');
    btn.innerHTML = '<span>💾</span>';
    btn.onclick = function (e) { e.stopPropagation(); openPanel(); };
    document.body.appendChild(btn);
  }

  function boot() {
    if (!document.body) { setTimeout(boot, 120); return; }
    buildButton();
    addEventListener('keydown', function (e) {
      if (e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) {
        e.preventDefault();
        openPanel();
      } else if (e.key === 'Escape') {
        var p = document.getElementById(PANEL_ID);
        if (p) p.classList.remove('on');
      }
    });
  }

  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot);
  else boot();
})();

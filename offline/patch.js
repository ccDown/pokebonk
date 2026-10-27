/*!
 * PokéBonk 离线版引导补丁
 * 作用：
 *   1. 拦截一切跨域网络请求，强制游戏走 local（本地存档）模式；
 *   2. 桩掉 Cloudflare Turnstile 人机验证，避免加载远程脚本；
 *   3. 暴露 __PB_OFFLINE__ 标记供其他脚本判断。
 * 必须在所有 module 之前执行。
 */
(function () {
  'use strict';

  var OFFLINE = true;
  window.__PB_OFFLINE__ = OFFLINE;

  function isExternal(url) {
    try {
      var u = new URL(String(url), location.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      return u.origin !== location.origin;
    } catch (e) {
      return false;
    }
  }

  // 调试开关：?pb-online=1 时放行远程请求（仅用于抓包核对接口，正式使用请勿开启）
  var ALLOW_REMOTE = /[?&]pb-online=1/.test(location.search);
  if (ALLOW_REMOTE) {
    window.__PB_OFFLINE__ = false;
    console.info('[offline] 调试模式：已放行远程请求');
    return;
  }

  /* ---------- fetch 拦截 ---------- */
  var nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (isExternal(url)) {
        return Promise.reject(new TypeError('[offline] blocked cross-origin request: ' + url));
      }
      return nativeFetch.apply(this, arguments);
    };
  }

  /* ---------- XHR 拦截 ---------- */
  var nativeOpen = XMLHttpRequest.prototype.open;
  var nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__pbExternal = isExternal(url);
    this.__pbUrl = url;
    return nativeOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__pbExternal) {
      var self = this;
      setTimeout(function () {
        try {
          self.dispatchEvent(new Event('error'));
          self.dispatchEvent(new Event('loadend'));
        } catch (e) { /* ignore */ }
      }, 0);
      return;
    }
    return nativeSend.apply(this, arguments);
  };

  /* ---------- sendBeacon / WebSocket 兜底 ---------- */
  if (navigator.sendBeacon) {
    var nativeBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      if (isExternal(url)) return false;
      return nativeBeacon(url, data);
    };
  }

  /* ---------- Cloudflare Turnstile 桩 ---------- */
  var TOKEN = 'offline-pass';
  window.turnstile = {
    render: function (el, opts) {
      if (opts && typeof opts.callback === 'function') {
        setTimeout(function () { opts.callback(TOKEN); }, 0);
      }
      return 'pb-offline-widget';
    },
    execute: function (id, opts) {
      var cb = (opts && opts.callback) || (id && id.callback);
      if (typeof cb === 'function') setTimeout(function () { cb(TOKEN); }, 0);
      return Promise.resolve(TOKEN);
    },
    reset: function () {},
    remove: function () {},
    isExpired: function () { return false; },
    getResponse: function () { return TOKEN; }
  };

  /* ---------- 阻断外部 <script>/<img> 注入 ---------- */
  var nativeCreate = document.createElement.bind(document);
  document.createElement = function (tag) {
    var el = nativeCreate(tag);
    var t = String(tag).toLowerCase();
    if (t === 'script') {
      var desc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
      if (desc && desc.set) {
        Object.defineProperty(el, 'src', {
          configurable: true,
          get: function () { return desc.get.call(el); },
          set: function (v) {
            if (isExternal(v)) { el.setAttribute('data-blocked-src', v); return; }
            desc.set.call(el, v);
          }
        });
      }
    }
    return el;
  };

  /* ---------- 控制台提示 ---------- */
  try {
    console.info(
      '%cPokéBonk 离线版%c 已启用本地模式 · 所有资源来自本机 · 存档保存在此浏览器',
      'background:#e94756;color:#fff;padding:2px 6px;border-radius:4px;font-weight:700',
      'color:#9b93c4'
    );
  } catch (e) { /* ignore */ }
})();

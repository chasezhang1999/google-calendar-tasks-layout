// ==UserScript==
// @name         Google 日历 Tasks 侧边栏
// @namespace    chase.google-calendar-tasks-layout
// @version      0.1.0
// @description  Google 日历「Tasks」页的左侧边栏改成点左上角菜单按钮后从上往下展开的下拉，平时不占宽度；点图钉可以固定在左边，固定时拖右边缘调宽度。
// @license      MIT
// @match        https://calendar.google.com/calendar/*
// @match        https://tasks.google.com/embed/fullscreen/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';
  // 日历的 Tasks 页是两层拼起来的：顶栏（含左上角菜单按钮）在 calendar.google.com，
  // 侧边栏和任务列表在内嵌的 tasks.google.com/embed/fullscreen 里，菜单按钮靠 Google 自己的跨框架消息开关侧边栏。
  // 实测切换视图后一秒内发的这条消息常被吞掉，按钮和侧边栏的开关就对不上了（按钮发的是「设成开/关」，不是「切换」）。
  // 所以下拉模式下不让 Google 开关：侧边栏原生一直开着，显示与否全由脚本的样式决定；
  // 日历层拦下菜单按钮，改成通知内嵌层。固定模式下菜单按钮照原样工作。
  const CALENDAR = 'https://calendar.google.com';
  const TASKS = 'https://tasks.google.com';
  const TAG = 'gct';

  if (location.origin === CALENDAR) {
    if (window.top === window) calendarSide();
  } else if (location.origin === TASKS) {
    // 只管日历嵌进来的那份。切换视图后地址里的 origin 参数会没，所以先看 ancestorOrigins
    const embedder = location.ancestorOrigins?.[0] ?? new URLSearchParams(location.search).get('origin');
    if (embedder === CALENDAR) tasksSide();
  }

  function calendarSide() {
    // 内嵌层报来的状态；aliveFrame 是已经确认装着脚本的那个内嵌框
    let state = { dropdown: false, visible: false };
    let aliveFrame = null;
    let passThrough = false;
    const tasksFrame = () => document.querySelector('iframe[src^="https://tasks.google.com/embed/fullscreen"]');
    // 日历视图里同一个位置是日历自己的主菜单，只在 Tasks 内嵌框看得见时才管
    const frameVisible = frame => !!frame && frame.getBoundingClientRect().width > 0;
    const menuButton = () =>
      document.querySelector('header [role="button"][aria-expanded] path[d^="M3 18h18v-2H3v2z"]')?.closest('[role="button"]');
    const isMenu = target => target instanceof Element && !!menuButton()?.contains(target);
    // 下拉模式、内嵌层的脚本在、Tasks 视图看得见，才接管菜单按钮
    function inCharge() {
      const frame = tasksFrame();
      return state.dropdown && !!frame && frame === aliveFrame && frameVisible(frame);
    }
    function send(type) {
      const frame = tasksFrame();
      if (frame && frame === aliveFrame) frame.contentWindow?.postMessage({ [TAG]: 1, type }, TASKS);
    }
    // 脚本自己点菜单按钮时不拦
    function press(button) {
      passThrough = true;
      try {
        button.click();
      } finally {
        passThrough = false;
      }
    }
    // 让 Tasks 的侧边栏原生开着。按钮已经是「开」、侧边栏却关着，说明上次的消息丢了：先点成「关」再点回「开」，重发一次。
    // 按钮的 aria-expanded 要过一会儿才变，所以点之前读
    function ensureNativeOpen() {
      const button = menuButton();
      if (!button || !frameVisible(tasksFrame())) return;
      const alreadyOpen = button.getAttribute('aria-expanded') === 'true';
      press(button);
      if (alreadyOpen) setTimeout(() => press(button), 300);
    }

    window.addEventListener('message', event => {
      const frame = tasksFrame();
      if (event.origin !== TASKS || !frame || event.source !== frame.contentWindow) return;
      const data = event.data;
      if (!data || data[TAG] !== 1) return;
      if (data.type === 'state') {
        state = { dropdown: !!data.dropdown, visible: !!data.visible };
        if (aliveFrame !== frame) {
          aliveFrame = frame;
          send('hello');
        }
      } else if (data.type === 'native-open') {
        ensureNativeOpen();
      }
    });

    // 菜单按钮的按下、抬起、点击都拦（不确定日历听的是哪一个）；点击时通知内嵌层开关下拉。
    // 点到日历这层的别处就收起下拉；点在内嵌框里的由内嵌层自己管
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      window.addEventListener(type, event => {
        if (passThrough || !inCharge()) return;
        if (isMenu(event.target)) {
          event.stopImmediatePropagation();
          event.preventDefault();
          if (type === 'click') send('toggle');
        } else if (type === 'click' && state.visible) {
          send('dismiss');
        }
      }, true);
    }
    // 焦点在菜单按钮上按回车或空格，日历在 keydown/keyup 里切换，也拦下；Esc 收起下拉
    for (const type of ['keydown', 'keyup']) {
      window.addEventListener(type, event => {
        if (!inCharge()) return;
        if ((event.key === 'Enter' || event.key === ' ') && isMenu(event.target)) {
          event.stopImmediatePropagation();
          event.preventDefault();
          if (type === 'keydown' && !event.repeat) send('toggle');
        } else if (type === 'keydown' && event.key === 'Escape' && state.visible) {
          send('dismiss');
        }
      }, true);
    }
  }

  function tasksSide() {
    const STYLE_ID = 'gct-style';
    if (document.getElementById(STYLE_ID)) return;
    const DEFAULT_WIDTH = 256;
    const MIN_WIDTH = 160;
    const MAX_WIDTH = 600;
    // 类名取自 2026-10 的 Tasks 内嵌页（Material 3 导航抽屉）
    const WRAP = '.Pj9zVe';                     // 侧边栏外层，和右边的任务区并排
    const DRAWER = '.FatJCf-yXBf7b-QA0Szd';     // 抽屉，原生开着时带 OPEN
    const OPEN = 'FatJCf-yXBf7b-QA0Szd-OWXEXe-llTnze';
    const NAV = '.FatJCf-yXBf7b-xCUyXc';        // 导航本体：原生收起时宽 0、不可见
    const PANEL = '.UVq0Gb';                    // 里面带底色的那层
    // Material Icons 的 push_pin：外框版 = 没固定，实心版 = 已固定
    const PIN_ICON = {
      off: 'M14 4v5c0 1.12.37 2.16 1 3H9c.65-.86 1-1.9 1-3V4h4m3-2H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3V4h1c.55 0 1-.45 1-1s-.45-1-1-1z',
      on: 'M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z',
    };

    const settings = { pinned: false, width: DEFAULT_WIDTH };
    try {
      const saved = typeof GM_getValue === 'function' ? GM_getValue('sidebar', {}) : {};
      if (typeof saved?.pinned === 'boolean') settings.pinned = saved.pinned;
      const width = Number(saved?.width);
      if (width >= MIN_WIDTH && width <= MAX_WIDTH) settings.width = Math.round(width);
    } catch (error) {
      console.warn('[Tasks 侧边栏]', error);
    }
    function save() {
      try {
        if (typeof GM_setValue === 'function') GM_setValue('sidebar', { ...settings });
      } catch (error) {
        console.warn('[Tasks 侧边栏]', error);
      }
    }
    // 窗口很窄时给任务区至少留 240
    const clamp = width => Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width, window.innerWidth - 240)));

    const root = document.documentElement;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
:root { --gct-width: ${DEFAULT_WIDTH}px; }
/* 固定：照原样停在左边，宽度用自己的；拖动时去掉宽度过渡，跟手 */
html.gct-pinned ${DRAWER}.${OPEN} ${NAV} { width: var(--gct-width) !important; }
html.gct-resizing ${NAV} { transition: none !important; }
html.gct-resizing, html.gct-resizing * { cursor: col-resize !important; user-select: none !important; }
/* 下拉：外层脱离排版、不占宽度，任务区铺满；展开时从上往下露出，高度随内容。
   显示与否只看 gct-visible，不管原生开没开。每列卡片的标题是 sticky、z-index 3000，要压过它 */
html.gct-dropdown ${WRAP} {
  position: absolute; top: 0; left: 0; z-index: 3002; height: auto !important; max-height: 100%;
  border-right: 0 !important; pointer-events: none;
}
html.gct-dropdown ${DRAWER} { max-height: 100%; }
html.gct-dropdown ${NAV} {
  width: var(--gct-width) !important; max-height: 100%; border-radius: 0 0 16px 0;
  box-shadow: 0 6px 16px rgba(0, 0, 0, .18);
  visibility: hidden; clip-path: inset(0 -30px 100% -30px);
  transition: clip-path .15s ease-in, visibility 0s .15s !important;
}
/* clip-path 连阴影一起裁，左右下各多留 30px */
html.gct-dropdown.gct-visible ${NAV} {
  visibility: visible; pointer-events: auto; clip-path: inset(0 -30px -30px -30px);
  transition: clip-path .18s ease-out, visibility 0s !important;
}
html.gct-dropdown ${PANEL} { height: auto !important; padding-bottom: 8px !important; }
/* 图钉和拖动条是固定定位的独立元素，挂在应用根节点 #yDmH0d 的最后（不插进侧边栏里面）。
   根节点整体 z-index 1；里面任务区那层是 1、Google 的弹窗是 2001，所以取 2：盖得住侧边栏，又在弹窗遮罩下面 */
#gct-pin {
  position: fixed; top: 24px; left: calc(var(--gct-width) - 44px); z-index: 2;
  width: 32px; height: 32px; padding: 0; border: 0; border-radius: 50%; background: transparent;
  color: var(--gm3-sys-color-on-surface-variant, #444746); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; visibility: hidden; transition: opacity .15s, visibility 0s .15s;
}
#gct-pin:hover { background: rgba(68, 71, 70, .08); }
#gct-pin svg { width: 20px; height: 20px; fill: currentColor; }
html.gct-open #gct-pin { opacity: 1; visibility: visible; transition: opacity .15s .1s, visibility 0s; }
#gct-handle {
  position: fixed; top: 0; bottom: 0; left: calc(var(--gct-width) - 4px); width: 9px; z-index: 2;
  cursor: col-resize; touch-action: none; display: none;
}
html.gct-pinned.gct-open #gct-handle { display: block; }
#gct-handle::after { content: ''; position: absolute; top: 0; bottom: 0; left: 3px; width: 3px; transition: background .15s; }
#gct-handle:hover::after, html.gct-resizing #gct-handle::after { background: var(--gm3-sys-color-primary, #0b57d0); }
`;
    (document.head || root).append(style);

    function setWidth(width) {
      root.style.setProperty('--gct-width', `${width}px`);
    }
    setWidth(clamp(settings.width));
    window.addEventListener('resize', () => setWidth(clamp(settings.width)));

    let drawer = null;
    let visible = false;       // 下拉模式下展没展开：脚本自己的状态
    let parentAlive = false;   // 日历层的脚本在不在
    let nativeTimer = null;
    let nativeTries = 0;
    const isOpen = () => !!drawer?.isConnected && drawer.classList.contains(OPEN);

    function post(message) {
      try {
        window.parent.postMessage({ [TAG]: 1, ...message }, CALENDAR);
      } catch (error) {
        console.warn('[Tasks 侧边栏]', error);
      }
    }
    function render() {
      root.classList.toggle('gct-pinned', settings.pinned);
      root.classList.toggle('gct-dropdown', !settings.pinned);
      root.classList.toggle('gct-visible', !settings.pinned && visible);
      root.classList.toggle('gct-open', settings.pinned ? isOpen() : visible);
      setPinIcon();
      post({ type: 'state', dropdown: !settings.pinned, visible: !settings.pinned && visible, nativeOpen: isOpen() });
      keepNativeOpen();
    }
    function setVisible(next) {
      if (visible === next) return;
      visible = next;
      render();
    }
    // 下拉模式下原生侧边栏要一直开着：被关上了就请日历层打开，没打开就过一会儿再请，最多 5 次
    function keepNativeOpen() {
      if (settings.pinned || !parentAlive || !drawer || isOpen()) {
        clearTimeout(nativeTimer);
        nativeTimer = null;
        nativeTries = 0;
        return;
      }
      if (nativeTimer || nativeTries >= 5) return;
      nativeTries++;
      post({ type: 'native-open' });
      nativeTimer = setTimeout(() => {
        nativeTimer = null;
        keepNativeOpen();
      }, 1200);
    }

    window.addEventListener('message', event => {
      if (event.origin !== CALENDAR || event.source !== window.parent) return;
      const data = event.data;
      if (!data || data[TAG] !== 1) return;
      if (!parentAlive) {
        // 日历层接管了菜单按钮：下拉从收起开始，以后的开关听它的
        parentAlive = true;
        visible = false;
        render();
      }
      if (settings.pinned) return;
      if (data.type === 'toggle') setVisible(!visible);
      else if (data.type === 'dismiss') setVisible(false);
    });

    // 盯住抽屉的原生开关；抽屉要是被 Tasks 重新渲染了，换成新的接着盯
    function watch() {
      attachControls();
      const found = document.querySelector(DRAWER);
      if (!found || found === drawer) return;
      drawer = found;
      let wasOpen = isOpen();
      new MutationObserver(() => {
        if (found !== drawer) return;
        const open = isOpen();
        if (open === wasOpen) return;
        wasOpen = open;
        // 日历层的脚本不在时退回原样：Google 的开关就是下拉的开关
        if (!parentAlive && !settings.pinned) visible = open;
        render();
      }).observe(found, { attributes: true, attributeFilter: ['class'] });
      render();
    }
    setInterval(watch, 1500);

    let pin = null;
    let pinPath = null;
    let handle = null;
    function setPinIcon() {
      if (!pin) return;
      pinPath.setAttribute('d', settings.pinned ? PIN_ICON.on : PIN_ICON.off);
      const label = settings.pinned ? '取消固定（改成下拉）' : '固定侧边栏';
      pin.title = label;
      pin.setAttribute('aria-label', label);
      pin.setAttribute('aria-pressed', String(settings.pinned));
    }
    // 改成固定：刚才展开着的下拉直接变成停靠的侧边栏；改回下拉就是要把地方让出来，先收起
    function togglePinned() {
      settings.pinned = !settings.pinned;
      save();
      visible = false;
      render();
    }
    function resetWidth() {
      settings.width = DEFAULT_WIDTH;
      setWidth(clamp(DEFAULT_WIDTH));
      save();
    }
    function startResize(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = clamp(settings.width);
      let width = startWidth;
      handle.setPointerCapture?.(event.pointerId);
      root.classList.add('gct-resizing');
      const move = moveEvent => {
        width = clamp(startWidth + moveEvent.clientX - startX);
        setWidth(width);
      };
      const end = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
        root.classList.remove('gct-resizing');
        if (width !== startWidth) {
          settings.width = width;
          save();
        }
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    }
    function buildControls() {
      if (pin || !document.body) return;
      const svgNS = 'http://www.w3.org/2000/svg';
      pin = document.createElement('button');
      pin.id = 'gct-pin';
      pin.type = 'button';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      pinPath = document.createElementNS(svgNS, 'path');
      svg.append(pinPath);
      pin.append(svg);
      pin.addEventListener('click', event => {
        event.stopPropagation();
        togglePinned();
      });
      handle = document.createElement('div');
      handle.id = 'gct-handle';
      handle.title = '拖动调整宽度，双击恢复默认';
      handle.addEventListener('pointerdown', startResize);
      handle.addEventListener('dblclick', resetWidth);
      setPinIcon();
      attachControls();
    }
    // 等页面加载完才挂，不在 Tasks 初始化的时候动它的根节点；被重新渲染掉了就再挂回去
    function attachControls() {
      const host = document.getElementById('yDmH0d') || document.body;
      if (!pin || !host || pin.parentElement === host || document.readyState !== 'complete') return;
      host.append(pin, handle);
    }

    // 下拉开着时：选了一项（所有任务、已加星标、新建任务列表、创建）、点到菜单外、按 Esc 都收起；
    // 勾选要显示的列表、折叠「任务列表」时不收，方便连着勾几个
    document.addEventListener('click', event => {
      if (settings.pinned || !visible) return;
      const target = event.target;
      if (!(target instanceof Element) || target.closest('#gct-pin')) return;
      if (target.closest(NAV) && !target.closest('[role="menuitem"], button:not([aria-expanded])')) return;
      setTimeout(() => setVisible(false), 0);
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !settings.pinned && visible) setVisible(false);
    }, true);

    render();
    const onReady = () => {
      buildControls();
      watch();
    };
    // 油猴偶尔晚于这两个事件才注入内嵌框，错过了就直接做
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once: true });
    else onReady();
    if (document.readyState === 'complete') onReady();
    else window.addEventListener('load', onReady, { once: true });

    if (typeof GM_registerMenuCommand === 'function') {
      try {
        GM_registerMenuCommand('侧边栏：固定 / 下拉', togglePinned);
        GM_registerMenuCommand('侧边栏宽度恢复默认', resetWidth);
      } catch (error) {
        console.warn('[Tasks 侧边栏]', error);
      }
    }
  }
})();

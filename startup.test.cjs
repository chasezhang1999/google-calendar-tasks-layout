const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');
const script = readFileSync(`${__dirname}/google-calendar-tasks-layout.user.js`, 'utf8');

const TASKS_URL = 'https://tasks.google.com/embed/fullscreen/?gm3=enabled&origin=https%3A%2F%2Fcalendar.google.com&hl=zh-CN';
const CALENDAR_URL = 'https://calendar.google.com/calendar/u/0/r/tasks';
const CALENDAR = 'https://calendar.google.com';
const OPEN = 'FatJCf-yXBf7b-QA0Szd-OWXEXe-llTnze';
const MENU_ICON = 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// 模拟油猴环境。jsdom 不做排版，这里只测脚本逻辑，不测下拉和拖动的实际样子。
// calendar 是内嵌层上面那个日历层：'opens' 收到 native-open 就把原生侧边栏打开，'ignores' 不理
function setup(t, { url = TASKS_URL, values = {}, gm = 'working', calendar = 'opens' } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url,
    runScripts: 'outside-only',
  });
  const w = dom.window;
  // 与 Trusted Types 一样拒绝 HTML 字符串；jsdom 自己关窗口时要用 innerHTML，先还原
  const innerHTML = Object.getOwnPropertyDescriptor(w.Element.prototype, 'innerHTML');
  Object.defineProperty(w.Element.prototype, 'innerHTML', {
    set() { throw new TypeError('TrustedHTML required'); },
    configurable: true,
  });
  t.after(() => {
    Object.defineProperty(w.Element.prototype, 'innerHTML', innerHTML);
    w.close();
  });
  const log = { stored: [], menu: {}, posts: [] };
  const store = { ...values };
  if (gm !== 'missing') {
    w.GM_getValue = (key, fallback) => {
      if (gm === 'broken') throw new Error('storage unavailable');
      return key in store ? store[key] : fallback;
    };
    // 存进来的对象属于 jsdom 的 realm，转成普通对象再比较
    w.GM_setValue = (key, value) => {
      store[key] = JSON.parse(JSON.stringify(value));
      log.stored.push([key, store[key]]);
    };
    w.GM_registerMenuCommand = (name, fn) => { log.menu[name] = fn; };
  }
  w.console.warn = () => {};
  // 像油猴 document-start 那样：脚本跑的时候文档还在加载
  let readyState = 'loading';
  Object.defineProperty(w.document, 'readyState', { get: () => readyState, configurable: true });
  const loadPage = () => {
    readyState = 'interactive';
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    readyState = 'complete';
    w.dispatchEvent(new w.Event('load'));
  };
  // 顶层的 jsdom 里 window.parent 就是自己，内嵌层往上发的消息都落到这里
  w.postMessage = (message, origin) => {
    const copy = JSON.parse(JSON.stringify(message));
    log.posts.push({ ...copy, origin });
    if (copy.type === 'native-open' && calendar === 'opens') {
      setTimeout(() => w.document.querySelector('.FatJCf-yXBf7b-QA0Szd')?.classList.add(OPEN), 20);
    }
  };
  // 日历层发给内嵌层的消息
  const fromCalendar = (data, origin = CALENDAR) =>
    w.dispatchEvent(new w.MessageEvent('message', { data, origin, source: w }));
  const count = type => log.posts.filter(post => post.type === type).length;
  const lastState = () => log.posts.filter(post => post.type === 'state').at(-1);
  const cls = name => w.document.documentElement.classList.contains(name);
  return {
    w, log, store, loadPage, fromCalendar, count, lastState, cls,
    run: () => w.eval(script),
    style: () => w.document.getElementById('gct-style'),
    width: () => w.document.documentElement.style.getPropertyValue('--gct-width'),
  };
}

// 仿 Tasks 内嵌页的侧边栏（2026-10 的结构，只留脚本用到的）
function tasksDom(w, { open = true } = {}) {
  const doc = w.document;
  const el = (tag, className) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    return node;
  };
  const item = (role, text) => {
    const li = el('li', 'aqdrmf-rymPhb-ibnC6b');
    li.setAttribute('role', role);
    li.append(el('span'));
    li.firstChild.textContent = text;
    return li;
  };
  const row = el('div', 'ERuXW');
  const wrap = el('div', 'Pj9zVe');
  const drawer = el('div', `FatJCf-yXBf7b-QA0Szd${open ? ` ${OPEN}` : ''}`);
  const nav = el('div', 'FatJCf-yXBf7b-xCUyXc');
  nav.setAttribute('role', 'navigation');
  const inner = el('div', 'FatJCf-yXBf7b-dPpuff');
  const panel = el('div', 'UVq0Gb');
  const create = el('button');
  create.textContent = '创建';
  const views = el('ul');
  const all = item('menuitem', '所有任务');
  const starred = item('menuitem', '已加星标');
  views.append(all, starred);
  const chevron = el('button');
  chevron.setAttribute('aria-expanded', 'true');
  const lists = el('ul');
  const list = item('option', '我的任务');
  const box = el('input');
  box.type = 'checkbox';
  list.prepend(box);
  const newList = item('menuitem', '新建任务列表');
  lists.append(list, newList);
  panel.append(create, views, chevron, lists);
  inner.append(panel);
  nav.append(inner);
  drawer.append(nav);
  wrap.append(drawer);
  const main = el('div', 'AZ2Tsb');
  main.append(el('div'));
  row.append(wrap, main);
  // Google 应用的根节点，弹窗也挂在这里面
  const appRoot = el('div', 'MCcOAc');
  appRoot.id = 'yDmH0d';
  appRoot.append(row);
  doc.body.append(appRoot);
  return { drawer, nav, create, all, chevron, list, box, newList, main, appRoot };
}
const click = (w, node) => node.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const press = (w, key, node = w.document) =>
  node.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
// jsdom 没有 PointerEvent 时用 MouseEvent 顶替，脚本只读 button 和 clientX
const pointer = (w, node, type, clientX) => {
  const Ctor = w.PointerEvent || w.MouseEvent;
  node.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, button: 0, clientX }));
};

// 加载页面，日历层打个招呼（真实情况下它回应内嵌层的第一条 state）
async function ready(env) {
  env.loadPage();
  env.fromCalendar({ gct: 1, type: 'hello' });
  await wait(10);
}

test('Tasks frame: style goes in once, dropdown by default, starts hidden', t => {
  const env = setup(t);
  env.w.document.head.remove();
  env.run();
  env.run();
  assert.equal(env.w.document.querySelectorAll('#gct-style').length, 1);
  assert.equal(env.style().parentElement, env.w.document.documentElement);
  assert.ok(env.cls('gct-dropdown'));
  assert.equal(env.cls('gct-visible') || env.cls('gct-pinned') || env.cls('gct-open'), false);
  assert.equal(env.width(), '256px');
  const css = env.style().textContent;
  assert.match(css, /html\.gct-dropdown \.Pj9zVe \{\s*position: absolute; top: 0; left: 0; z-index: 3002;/);
  assert.match(css, /html\.gct-dropdown\.gct-visible \.FatJCf-yXBf7b-xCUyXc \{\s*visibility: visible;/);
  assert.match(css, /html\.gct-pinned \.FatJCf-yXBf7b-QA0Szd\.FatJCf-yXBf7b-QA0Szd-OWXEXe-llTnze \.FatJCf-yXBf7b-xCUyXc \{ width: var\(--gct-width\) !important; \}/);
  assert.deepEqual(env.lastState(), { gct: 1, type: 'state', dropdown: true, visible: false, nativeOpen: false, origin: CALENDAR });
});

for (const gm of ['missing', 'broken']) {
  test(`GM storage ${gm}: defaults still apply`, t => {
    const env = setup(t, { gm });
    assert.doesNotThrow(env.run);
    assert.ok(env.cls('gct-dropdown'));
    assert.equal(env.width(), '256px');
  });
}

test('saved settings are used when valid and ignored when not', t => {
  const good = setup(t, { values: { sidebar: { pinned: true, width: 300 } } });
  good.run();
  assert.ok(good.cls('gct-pinned'));
  assert.equal(good.width(), '300px');
  const bad = setup(t, { values: { sidebar: { pinned: 'yes', width: 50 } } });
  bad.run();
  assert.ok(bad.cls('gct-dropdown'));
  assert.equal(bad.width(), '256px');
});

test('Tasks embedded somewhere other than Calendar is left alone', t => {
  const env = setup(t, { url: 'https://tasks.google.com/embed/fullscreen/?origin=https%3A%2F%2Fmail.google.com' });
  env.run();
  assert.equal(env.style(), null);
  assert.deepEqual(env.log.menu, {});
});

test('the calendar layer toggles and dismisses the dropdown; the native sidebar stays as it is', async t => {
  const env = setup(t);
  env.run();
  const dom = tasksDom(env.w);
  await ready(env);
  assert.ok(dom.drawer.classList.contains(OPEN));
  env.fromCalendar({ gct: 1, type: 'toggle' });
  assert.ok(env.cls('gct-visible') && env.cls('gct-open'));
  assert.equal(env.lastState().visible, true);
  env.fromCalendar({ gct: 1, type: 'toggle' });
  assert.equal(env.cls('gct-visible'), false);
  env.fromCalendar({ gct: 1, type: 'toggle' });
  env.fromCalendar({ gct: 1, type: 'dismiss' });
  assert.equal(env.cls('gct-visible'), false);
  assert.equal(env.lastState().visible, false);
  assert.ok(dom.drawer.classList.contains(OPEN), 'the dropdown never closes the native sidebar');
  assert.equal(env.count('native-open'), 0);
  // 别的来源、没带标记的消息不理
  env.fromCalendar({ gct: 1, type: 'toggle' }, 'https://evil.example');
  env.fromCalendar({ type: 'toggle' });
  assert.equal(env.cls('gct-visible'), false);
});

test('without the calendar layer, the native open state drives the dropdown', async t => {
  const env = setup(t);
  env.run();
  const dom = tasksDom(env.w, { open: false });
  env.loadPage();
  await wait(10);
  dom.drawer.classList.add(OPEN);
  await wait(10);
  assert.ok(env.cls('gct-visible'));
  dom.drawer.classList.remove(OPEN);
  await wait(10);
  assert.equal(env.cls('gct-visible'), false);
  assert.equal(env.count('native-open'), 0, 'nobody to ask for it');
  // 日历层迟到了：从收起开始，原生开关不再左右下拉
  dom.drawer.classList.add(OPEN);
  await wait(10);
  env.fromCalendar({ gct: 1, type: 'hello' });
  assert.equal(env.cls('gct-visible'), false);
  dom.drawer.classList.remove(OPEN);
  await wait(10);
  dom.drawer.classList.add(OPEN);
  await wait(10);
  assert.equal(env.cls('gct-visible'), false);
});

test('dropdown closes after picking an item, clicking outside or pressing Escape', async t => {
  const env = setup(t);
  env.run();
  const dom = tasksDom(env.w);
  await ready(env);
  for (const [name, act] of [
    ['view item', () => click(env.w, dom.all.firstChild)],
    ['new list', () => click(env.w, dom.newList)],
    ['create', () => click(env.w, dom.create)],
    ['outside', () => click(env.w, dom.main.firstChild)],
    ['Escape', () => press(env.w, 'Escape')],
  ]) {
    env.fromCalendar({ gct: 1, type: 'toggle' });
    assert.ok(env.cls('gct-visible'), name);
    act();
    await wait(10);
    assert.equal(env.cls('gct-visible'), false, name);
    assert.equal(env.lastState().visible, false, name);
  }
  assert.ok(dom.drawer.classList.contains(OPEN));
});

test('dropdown stays open while ticking lists or folding the list group', async t => {
  const env = setup(t);
  env.run();
  const dom = tasksDom(env.w);
  await ready(env);
  env.fromCalendar({ gct: 1, type: 'toggle' });
  click(env.w, dom.box);
  click(env.w, dom.list);
  click(env.w, dom.chevron);
  press(env.w, 'Enter');
  await wait(10);
  assert.ok(env.cls('gct-visible'));
});

test('a native sidebar that got closed is reopened through the calendar layer, with retries', async t => {
  const env = setup(t);
  env.run();
  const dom = tasksDom(env.w, { open: false });
  env.loadPage();
  await wait(10);
  assert.equal(env.count('native-open'), 0, 'not before the calendar layer says hello');
  env.fromCalendar({ gct: 1, type: 'hello' });
  await wait(60);
  assert.equal(env.count('native-open'), 1);
  assert.ok(dom.drawer.classList.contains(OPEN));
  assert.equal(env.cls('gct-visible'), false, 'opening it natively does not show the dropdown');
  // 日历层不理：1.2 秒一次，最多 5 次
  const deaf = setup(t, { calendar: 'ignores' });
  deaf.run();
  tasksDom(deaf.w, { open: false });
  await ready(deaf);
  assert.equal(deaf.count('native-open'), 1);
  await wait(1300);
  assert.equal(deaf.count('native-open'), 2);
  await wait(4000);
  assert.equal(deaf.count('native-open'), 5);
});

test('pin: pinning docks the open dropdown, unpinning hides it again', async t => {
  const env = setup(t);
  env.run();
  const dom = tasksDom(env.w);
  await ready(env);
  env.fromCalendar({ gct: 1, type: 'toggle' });
  const pin = env.w.document.getElementById('gct-pin');
  const path = () => pin.querySelector('path').getAttribute('d');
  assert.equal(pin.getAttribute('aria-pressed'), 'false');
  const unpinnedIcon = path();
  click(env.w, pin);
  await wait(10);
  assert.deepEqual(env.store.sidebar, { pinned: true, width: 256 });
  assert.ok(env.cls('gct-pinned') && env.cls('gct-open') && !env.cls('gct-dropdown'));
  assert.equal(pin.getAttribute('aria-pressed'), 'true');
  assert.notEqual(path(), unpinnedIcon);
  assert.deepEqual(env.lastState(), { gct: 1, type: 'state', dropdown: false, visible: false, nativeOpen: true, origin: CALENDAR });
  // 固定时：日历层的开关消息、点外面、Esc 都不管；侧边栏跟着原生开关
  env.fromCalendar({ gct: 1, type: 'dismiss' });
  click(env.w, dom.main.firstChild);
  press(env.w, 'Escape');
  await wait(10);
  assert.ok(env.cls('gct-open'));
  dom.drawer.classList.remove(OPEN);
  await wait(10);
  assert.equal(env.cls('gct-open'), false);
  assert.equal(env.count('native-open'), 0, 'pinned: a closed sidebar is left closed');
  dom.drawer.classList.add(OPEN);
  await wait(10);
  click(env.w, pin);
  await wait(10);
  assert.deepEqual(env.store.sidebar, { pinned: false, width: 256 });
  assert.ok(env.cls('gct-dropdown'));
  assert.equal(env.cls('gct-visible') || env.cls('gct-open'), false);
});

test('pinned: the handle drags the width within limits, saves on release, double-click resets', async t => {
  const env = setup(t, { values: { sidebar: { pinned: true, width: 256 } } });
  env.run();
  const dom = tasksDom(env.w);
  await ready(env);
  assert.ok(dom.drawer.classList.contains(OPEN) && env.cls('gct-open'));
  const handle = env.w.document.getElementById('gct-handle');
  pointer(env.w, handle, 'pointerdown', 256);
  assert.ok(env.cls('gct-resizing'));
  pointer(env.w, handle, 'pointermove', 356);
  assert.equal(env.width(), '356px');
  assert.equal(env.log.stored.length, 0, 'nothing is saved mid-drag');
  pointer(env.w, handle, 'pointerup', 356);
  assert.equal(env.cls('gct-resizing'), false);
  assert.deepEqual(env.store.sidebar, { pinned: true, width: 356 });
  // jsdom 的窗口宽 1024：最宽 600（再宽就给任务区留不到 240），最窄 160
  for (const [x, expected] of [[5000, 600], [-5000, 160]]) {
    pointer(env.w, handle, 'pointerdown', 300);
    pointer(env.w, handle, 'pointermove', x);
    pointer(env.w, handle, 'pointerup', x);
    assert.equal(env.store.sidebar.width, expected);
  }
  handle.dispatchEvent(new env.w.MouseEvent('dblclick', { bubbles: true }));
  assert.deepEqual(env.store.sidebar, { pinned: true, width: 256 });
  assert.equal(env.width(), '256px');
});

test('controls wait for the page to finish loading, and come back if Tasks drops them', async t => {
  const env = setup(t);
  env.run();
  const dom = tasksDom(env.w);
  env.w.document.dispatchEvent(new env.w.Event('DOMContentLoaded'));
  assert.equal(env.w.document.getElementById('gct-pin'), null, 'nothing is added while Tasks is still starting up');
  await ready(env);
  const pin = env.w.document.getElementById('gct-pin');
  assert.equal(pin.parentElement, dom.appRoot);
  assert.equal(env.w.document.getElementById('gct-handle').parentElement, dom.appRoot);
  pin.remove();
  env.w.document.getElementById('gct-handle').remove();
  await wait(1600);
  assert.equal(pin.parentElement, dom.appRoot);
  assert.equal(env.w.document.querySelectorAll('#gct-pin, #gct-handle').length, 2);
  // 没有应用根节点时退回 body
  const bare = setup(t);
  bare.run();
  bare.loadPage();
  assert.equal(bare.w.document.getElementById('gct-pin').parentElement, bare.w.document.body);
});

test('menu commands live in the Tasks frame only', async t => {
  const tasks = setup(t);
  tasks.run();
  assert.deepEqual(Object.keys(tasks.log.menu), ['侧边栏：固定 / 下拉', '侧边栏宽度恢复默认']);
  tasksDom(tasks.w);
  await ready(tasks);
  tasks.log.menu['侧边栏：固定 / 下拉']();
  assert.ok(tasks.cls('gct-pinned'));
  assert.deepEqual(tasks.store.sidebar, { pinned: true, width: 256 });
  const calendar = setup(t, { url: CALENDAR_URL });
  calendar.run();
  assert.deepEqual(calendar.log.menu, {});
  assert.equal(calendar.style(), null);
});

// 仿日历层：顶栏的菜单按钮 + Tasks 内嵌框。日历自己的处理：点击或回车时过一会儿才翻转 aria-expanded（实测是异步的）
function calendarDom(w, { visible = true } = {}) {
  const doc = w.document;
  const header = doc.createElement('header');
  const button = doc.createElement('div');
  button.setAttribute('role', 'button');
  button.setAttribute('aria-expanded', 'true');
  button.tabIndex = 0;
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', MENU_ICON);
  svg.append(path);
  button.append(svg);
  const native = [];
  const flip = how => {
    native.push(how);
    setTimeout(() => button.setAttribute('aria-expanded', String(button.getAttribute('aria-expanded') !== 'true')), 5);
  };
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) button.addEventListener(type, () => native.push(type));
  button.addEventListener('click', () => flip('click'));
  button.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') flip('key'); });
  const title = doc.createElement('span');
  title.textContent = '日历';
  header.append(button, title);
  const frame = doc.createElement('iframe');
  frame.src = 'https://tasks.google.com/embed/fullscreen/?gm3=enabled&origin=https%3A%2F%2Fcalendar.google.com';
  doc.body.append(header, frame);
  frame.getBoundingClientRect = () => ({ width: visible ? 1254 : 0, height: visible ? 716 : 0 });
  const toFrame = [];
  frame.contentWindow.postMessage = (message, origin) => toFrame.push({ ...JSON.parse(JSON.stringify(message)), origin });
  const fromFrame = (data, { origin = 'https://tasks.google.com', source = frame.contentWindow } = {}) =>
    w.dispatchEvent(new w.MessageEvent('message', { data, origin, source }));
  const state = (dropdown, shown) => fromFrame({ gct: 1, type: 'state', dropdown, visible: shown, nativeOpen: true });
  const sent = () => toFrame.map(message => message.type);
  return { button, path, title, frame, native, toFrame, fromFrame, state, sent };
}
const mouse = (w, node, type) => node.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true }));
const key = (w, node, type, k) => node.dispatchEvent(new w.KeyboardEvent(type, { key: k, bubbles: true, cancelable: true }));

test('calendar: says hello once to a Tasks frame that runs the script; ignores everything else', t => {
  const env = setup(t, { url: CALENDAR_URL });
  env.run();
  const cal = calendarDom(env.w);
  cal.fromFrame({ gct: 1, type: 'state', dropdown: true, visible: false }, { origin: 'https://evil.example' });
  cal.fromFrame({ gct: 1, type: 'state', dropdown: true, visible: false }, { source: env.w });
  cal.fromFrame({ type: 'state', dropdown: true, visible: false });
  cal.fromFrame('!_{"s":"__cb"}');
  assert.deepEqual(cal.toFrame, []);
  cal.state(true, false);
  cal.state(true, false);
  assert.deepEqual(cal.toFrame, [{ gct: 1, type: 'hello', origin: 'https://tasks.google.com' }]);
});

test('calendar: in dropdown mode the menu button toggles the dropdown instead of the native sidebar', async t => {
  const env = setup(t, { url: CALENDAR_URL });
  env.run();
  const cal = calendarDom(env.w);
  cal.state(true, false);
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) mouse(env.w, cal.path, type);
  key(env.w, cal.button, 'keydown', 'Enter');
  key(env.w, cal.button, 'keyup', 'Enter');
  key(env.w, cal.button, 'keydown', ' ');
  await wait(20);
  assert.deepEqual(cal.native, [], 'Calendar never sees the press');
  assert.equal(cal.button.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(cal.sent(), ['hello', 'toggle', 'toggle', 'toggle']);
});

test('calendar: clicking elsewhere or pressing Escape dismisses an open dropdown', t => {
  const env = setup(t, { url: CALENDAR_URL });
  env.run();
  const cal = calendarDom(env.w);
  cal.state(true, false);
  click(env.w, cal.title);
  press(env.w, 'Escape');
  assert.deepEqual(cal.sent(), ['hello'], 'nothing to dismiss while it is closed');
  cal.state(true, true);
  click(env.w, cal.title);
  press(env.w, 'Escape');
  assert.deepEqual(cal.sent(), ['hello', 'dismiss', 'dismiss']);
});

test('calendar: pinned, hidden or script-less Tasks frames leave the menu button alone', async t => {
  for (const [name, visible, report] of [['pinned', true, cal => cal.state(false, false)], ['calendar view', false, cal => cal.state(true, false)], ['no script', true, () => {}]]) {
    const env = setup(t, { url: CALENDAR_URL });
    env.run();
    const cal = calendarDom(env.w, { visible });
    report(cal);
    click(env.w, cal.path);
    key(env.w, cal.button, 'keydown', 'Enter');
    await wait(20);
    assert.deepEqual(cal.native, ['click', 'key'], name);
    assert.deepEqual(cal.sent().filter(type => type !== 'hello'), [], name);
  }
});

test('calendar: native-open presses the menu button once, or twice when it already says open', async t => {
  const env = setup(t, { url: CALENDAR_URL });
  env.run();
  const cal = calendarDom(env.w);
  cal.state(true, false);
  cal.button.setAttribute('aria-expanded', 'false');
  cal.fromFrame({ gct: 1, type: 'native-open' });
  await wait(400);
  assert.deepEqual(cal.native, ['click']);
  assert.equal(cal.button.getAttribute('aria-expanded'), 'true');
  // 按钮已经是「开」、侧边栏却关着：点成「关」再点回「开」
  cal.fromFrame({ gct: 1, type: 'native-open' });
  await wait(100);
  assert.deepEqual(cal.native, ['click', 'click']);
  await wait(300);
  assert.deepEqual(cal.native, ['click', 'click', 'click']);
  assert.equal(cal.button.getAttribute('aria-expanded'), 'true');
});

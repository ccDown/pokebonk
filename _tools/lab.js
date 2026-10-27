const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:8730';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Users/DELL/AppData/Local/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--window-size=1280,800'],
    defaultViewport: { width: 1280, height: 800 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0, 130)));
  page.on('console', m => { if (m.type() === 'error') errs.push('C ' + m.text().slice(0, 110)); });

  let lastAct = null;
  page.on('request', r => {
    if (r.url().includes('/profile/actions') && r.postData()) {
      try { lastAct = JSON.parse(r.postData()).actions; } catch (e) {}
    }
  });

  const has = (t) => page.evaluate((x) => (document.body.innerText || '').includes(x), t);
  const clickText = async (t) => {
    const p = await page.evaluate((txt) => {
      const norm = s => (s || '').replace(/\s+/g, '');
      const el = [...document.querySelectorAll('button,.btn,a,[role=button]')].find(e => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && norm(e.textContent).includes(norm(txt));
      });
      if (!el) return null; const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, t);
    if (p) await page.mouse.click(p.x, p.y);
    return !!p;
  };

  await page.goto(BASE + '/?lang=zh', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(7000);
  if (await has('以游客身份游玩')) { await clickText('以游客身份游玩'); await sleep(5000); }
  if (await has('跳过')) { await clickText('跳过'); await sleep(1200); }

  await clickText('研究所');
  await sleep(2500);

  const screen = await page.evaluate(() => (document.querySelector('#ui')?.innerText || '').replace(/\s+/g, ' ').slice(0, 600));
  console.log('研究所界面:', screen);
  await page.screenshot({ path: 'C:/Users/DELL/WorkBuddy/rea/pokebonk/_lab1.png' });

  // 列出所有可点的按钮
  const btns = await page.evaluate(() => [...document.querySelectorAll('button')]
    .filter(e => e.getBoundingClientRect().width > 0)
    .map(e => ({ t: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 26), c: e.className }))
    .slice(0, 30));
  console.log('按钮:', JSON.stringify(btns));

  const before = await page.evaluate(async () => {
    const s = (await (await fetch('/save/export', { cache: 'no-store' })).json()).profile;
    return { stardust: s.stardust, lab: s.lab };
  });
  console.log('升级前:', JSON.stringify(before));

  // 点第一个“升级”类按钮
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(e => /升级| mejorar|Mejorar|购买/i.test(e.textContent || '') && e.getBoundingClientRect().width > 0);
    if (!b) return null;
    b.click();
    return b.textContent.replace(/\s+/g, ' ').trim().slice(0, 30);
  });
  console.log('点击:', clicked, '| action:', JSON.stringify(lastAct));
  await sleep(2500);

  const after = await page.evaluate(async () => {
    const s = (await (await fetch('/save/export', { cache: 'no-store' })).json()).profile;
    return { stardust: s.stardust, lab: s.lab };
  });
  console.log('升级后:', JSON.stringify(after));
  console.log('生效:', JSON.stringify(before) !== JSON.stringify(after) ? '是' : '否（被回滚）');
  console.log('异常:', errs.length ? [...new Set(errs)].slice(0, 4).join(' | ') : '无');

  await page.screenshot({ path: 'C:/Users/DELL/WorkBuddy/rea/pokebonk/_lab2.png' });
  await browser.close();
})().catch(e => console.error('FAIL', e.message));

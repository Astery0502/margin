import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const browserDirectory = new URL('../extension/', import.meta.url);

test('discussion windows retain independent positions across host visibility changes', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'margin-window-'));
  let browser;
  try {
    browser = await chromium.launchPersistentContext(profile, {
      headless: true,
      executablePath: process.env.BROWSER_BIN || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      viewport: { width: 1200, height: 900 },
    });
    const page = await browser.newPage();
    await page.setContent('<style>[hidden]{display:none!important}section{box-sizing:border-box}button{height:24px}</style>');
    for (const file of ['passage-ui.js', 'discussion-host.js']) {
      await page.addScriptTag({ path: new URL(file, browserDirectory).pathname });
    }
    const results = await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = discussionWindow.styles;
      document.head.append(style);
      function create(detach, top, anchor) {
        const section = document.createElement('section');
        const handle = document.createElement('button');
        section.append(handle);
        document.body.append(section);
        const controller = discussionWindow.bind(section, handle, { top, anchor });
        const record = { window: controller, frame: { setOpen(open) {
          section.hidden = !open;
          if (detach) { if (open) document.body.append(section); else section.remove(); }
        } } };
        const host = { render() {}, changed() {} };
        return { section, handle, controller,
          toggle(open) { PiSourceDiscussions.prototype.setOpen.call(host, record, open); },
          coords() { const { left, top } = section.getBoundingClientRect(); return { left, top }; },
        };
      }
      const anchor = { right: 100, bottom: 100 };
      const otherAnchor = { right: 400, bottom: 300 };
      window.testWindows = [];
      return [false, true].map(detach => {
        let currentAnchor = anchor;
        const first = create(detach, detach ? 52 : 8, () => currentAnchor);
        first.controller.place();
        const initial = first.coords();
        currentAnchor = otherAnchor;
        first.toggle(false);
        first.toggle(true);
        first.controller.place();
        const reopened = first.coords();
        first.handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        const moved = first.coords();
        first.toggle(false);
        first.controller.place(); // Layout while hidden must not erase position.
        first.toggle(true);
        first.controller.place();
        const movedReopened = first.coords();
        const second = create(detach, detach ? 52 : 8, () => otherAnchor);
        second.controller.place();
        const independent = second.coords();
        first.section.querySelector('.discussion-resize').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        const resizedWidth = first.section.getBoundingClientRect().width;
        const resized = first.coords();
        first.toggle(false);
        first.toggle(true);
        first.controller.place();
        const resizedReopened = first.coords();
        const reopenedWidth = first.section.getBoundingClientRect().width;
        first.controller.dock();
        const docked = first.coords();
        window.testWindows.push(first);
        first.toggle(false);
        first.toggle(true);
        first.controller.place();
        return { initial, reopened, moved, movedReopened, independent, resized, resizedReopened, resizedWidth, reopenedWidth, docked, dockedReopened: first.coords() };
      });
    });
    for (const result of results) {
      assert.deepEqual(result.reopened, result.initial);
      assert.equal(result.moved.left, result.initial.left + 10);
      assert.deepEqual(result.movedReopened, result.moved);
      assert.deepEqual(result.independent, { left: 406, top: 306 });
      assert.deepEqual(result.resizedReopened, result.resized);
      assert.equal(result.resizedWidth, 510);
      assert.equal(result.reopenedWidth, result.resizedWidth);
      assert.deepEqual(result.dockedReopened, result.docked);
    }
    await page.setViewportSize({ width: 600, height: 550 });
    const constrained = await page.evaluate(() => {
      const { section, controller } = window.testWindows[1];
      controller.place();
      const { left, top, right, bottom } = section.getBoundingClientRect();
      return { left, top, right, bottom };
    });
    assert.ok(constrained.left >= 8 && constrained.top >= 52);
    assert.ok(constrained.right <= 592 && constrained.bottom <= 542);
  } finally {
    await browser?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

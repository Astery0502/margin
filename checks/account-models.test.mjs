import assert from 'node:assert/strict';
import test from 'node:test';
import { accountGeneration, directories } from '../extension/providers/grant.js';

const { account, cachedAccount, invalidateAccount } = directories.openai;

test('account listings remain browsable during refresh and sends use the verified login', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  let generation = 1, connected = true, gate, fetching;
  const calls = [];
  const storage = {};
  globalThis.chrome = {
    runtime: { async sendNativeMessage(_host, { op }) {
      op = op.replace(/^v2-/, '');
      calls.push(op);
      if (op === 'status') return { selected: 'reader', connected, generation };
      fetching?.resolve();
      await gate?.promise;
      return { connected, modelIds: ['model-' + generation], names: {} };
    } },
    storage: { local: {
      async get(key) { return { [key]: storage[key] }; },
      async set(value) { Object.assign(storage, value); },
      async remove(key) { delete storage[key]; },
    } },
  };
  try {
    await invalidateAccount();
    assert.deepEqual((await account()).modelIds, ['model-1']);
    calls.length = 0;
    assert.equal(await accountGeneration('model-1'), 1);
    assert.deepEqual(calls, []);
    await assert.rejects(accountGeneration('missing'), { code: 'MODEL_UNAVAILABLE' });

    now += 60 * 60 * 1000;
    gate = Promise.withResolvers();
    const refresh = account(true);
    const send = accountGeneration('model-1');
    assert.deepEqual((await cachedAccount()).modelIds, ['model-1']);
    gate.resolve();
    await refresh;
    assert.equal(await send, 1);
    assert.equal(calls.filter(op => op === 'models').length, 1);

    generation++;
    await account(true);
    await assert.rejects(accountGeneration('model-1'), { code: 'MODEL_UNAVAILABLE' });
    assert.equal(await accountGeneration('model-2'), 2);

    // Discard the result of a refresh that was already in flight at logout.
    now += 60 * 60 * 1000;
    gate = Promise.withResolvers();
    fetching = Promise.withResolvers();
    const lateRequest = account(true);
    await fetching.promise;
    await invalidateAccount();
    gate.resolve();
    await assert.rejects(lateRequest, /account changed/);
    assert.equal(await cachedAccount(), undefined);

    connected = false;
    assert.equal(await account(true), null);
    assert.equal(await cachedAccount(), undefined);
    await assert.rejects(accountGeneration('model-2'), /Reconnect/);
  } finally { delete globalThis.chrome; }
});

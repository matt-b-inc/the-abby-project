const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const pluginSource = fs.readFileSync(path.join(root,
  'unity/AbbyCamp/Assets/Plugins/WebGL/AbbyBrowserSession.jslib'), 'utf8');
const storageSource = fs.readFileSync(path.join(root,
  'frontend/src/constants/storage.js'), 'utf8');
const keys = vm.runInNewContext(storageSource.replace('export const ', 'const ')
  + '\nSTORAGE_KEYS;');

// Synthetic tokens only. No HTTP requests or access to a real browser profile.
const firstToken = 'a'.repeat(40);
const secondToken = 'b'.repeat(40);

function loadBridge(initial = {}, options = {}) {
  const values = new Map(Object.entries(initial));
  const removed = [];
  const navigations = [];
  const allocations = [];
  const heap = Buffer.alloc(8192);
  let nextAddress = 8;
  const storage = {
    getItem(key) {
      if (options.readError) throw new Error('Storage unavailable');
      return values.get(key) ?? null;
    },
    removeItem(key) {
      if (options.removeError) throw new Error('Storage unavailable');
      removed.push(key);
      values.delete(key);
    },
  };
  const window = {
    get localStorage() {
      if (options.accessError) throw new Error('Storage denied');
      return storage;
    },
    location: { assign: (target) => navigations.push(target) },
  };
  function allocate(size) {
    const address = nextAddress;
    nextAddress += size;
    allocations.push({ address, size });
    assert.ok(nextAddress < heap.length, 'Test heap has enough space');
    return address;
  }
  function writeString(value, address, size) {
    const bytes = Buffer.from(value, 'utf8');
    assert.ok(bytes.length < size, 'Allocation includes a null terminator');
    bytes.copy(heap, address);
    heap[address + bytes.length] = 0;
  }
  function readString(address) {
    return heap.toString('utf8', address, heap.indexOf(0, address));
  }
  const library = {};
  const context = vm.createContext({
    window,
    LibraryManager: { library },
    mergeInto: Object.assign,
    lengthBytesUTF8: (value) => Buffer.byteLength(value, 'utf8'),
    _malloc: allocate,
    stringToUTF8: writeString,
    UTF8ToString: readString,
  });
  const originalGlobals = Object.keys(context);
  vm.runInContext(pluginSource, context, { filename: 'AbbyBrowserSession.jslib' });
  return {
    library, values, removed, navigations, allocations,
    readToken: () => readString(library.AbbySession_ReadToken()),
    clearToken(expected) {
      if (expected === null) return library.AbbySession_ClearToken(0);
      const size = Buffer.byteLength(expected, 'utf8') + 1;
      const address = allocate(size);
      writeString(expected, address, size);
      library.AbbySession_ClearToken(address);
    },
    checkNoGlobals: () => assert.deepEqual(Object.keys(context), originalGlobals),
  };
}

test('bridge uses the frontend token and cached-user keys', () => {
  assert.equal(keys.AUTH_TOKEN, 'abby_auth_token');
  assert.equal(keys.CACHED_USER, 'auth:last-user');
  const bridge = loadBridge({
    [keys.AUTH_TOKEN]: firstToken,
    [keys.CACHED_USER]: '{"id":123}',
  });
  assert.equal(bridge.readToken(), firstToken);
  bridge.clearToken(firstToken);
  assert.deepEqual(bridge.removed, [keys.AUTH_TOKEN, keys.CACHED_USER]);
});

test('missing token returns an allocated, null-terminated empty string', () => {
  const bridge = loadBridge();
  assert.equal(bridge.readToken(), '');
  assert.equal(bridge.allocations.length, 1);
  assert.equal(bridge.allocations[0].size, 1);
  assert.deepEqual(bridge.removed, []);
});

test('valid token is copied into a fresh malloc buffer on each read', () => {
  const bridge = loadBridge({ [keys.AUTH_TOKEN]: firstToken });
  assert.equal(bridge.readToken(), firstToken);
  assert.equal(bridge.readToken(), firstToken);
  assert.deepEqual(bridge.allocations.map(({ size }) => size), [41, 41]);
  assert.notEqual(bridge.allocations[0].address, bridge.allocations[1].address);
  assert.deepEqual(bridge.removed, []);
  bridge.checkNoGlobals();
});

test('malformed token values are rejected without mutating browser state', () => {
  const malformed = ['', 'a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40),
    ` ${firstToken}`, `${firstToken}\n`, `Token ${firstToken}`, '{"token":"x"}'];
  for (const value of malformed) {
    const bridge = loadBridge({ [keys.AUTH_TOKEN]: value });
    assert.equal(bridge.readToken(), '');
    assert.deepEqual(bridge.removed, []);
    assert.equal(bridge.values.get(keys.AUTH_TOKEN), value);
  }
});

test('hexadecimal token shape allows uppercase letters', () => {
  const token = 'ABCDEF0123'.repeat(4);
  const bridge = loadBridge({ [keys.AUTH_TOKEN]: token });
  assert.equal(bridge.readToken(), token);
});

test('inaccessible storage and read failures return an empty session', () => {
  for (const options of [{ accessError: true }, { readError: true }]) {
    const bridge = loadBridge({ [keys.AUTH_TOKEN]: firstToken }, options);
    assert.equal(bridge.readToken(), '');
    assert.doesNotThrow(() => bridge.clearToken(firstToken));
    assert.deepEqual(bridge.removed, []);
  }
});

test('logout or account switching is visible on the next read', () => {
  const bridge = loadBridge({ [keys.AUTH_TOKEN]: firstToken });
  assert.equal(bridge.readToken(), firstToken);
  bridge.values.delete(keys.AUTH_TOKEN);
  assert.equal(bridge.readToken(), '');
  bridge.values.set(keys.AUTH_TOKEN, secondToken);
  assert.equal(bridge.readToken(), secondToken);
  bridge.checkNoGlobals();
});

test('clearing a matching rejected token removes only its auth state', () => {
  const bridge = loadBridge({
    [keys.AUTH_TOKEN]: firstToken,
    [keys.CACHED_USER]: '{"id":123}',
    'some-other-setting': 'preserved',
  });
  bridge.clearToken(firstToken);
  assert.equal(bridge.readToken(), '');
  assert.equal(bridge.values.has(keys.CACHED_USER), false);
  assert.equal(bridge.values.get('some-other-setting'), 'preserved');
  assert.deepEqual(bridge.removed, [keys.AUTH_TOKEN, keys.CACHED_USER]);
});

test('a late rejection cannot clear the session of a newly signed-in account', () => {
  const bridge = loadBridge({ [keys.AUTH_TOKEN]: firstToken });
  const rejected = bridge.readToken();
  bridge.values.set(keys.AUTH_TOKEN, secondToken);
  bridge.values.set(keys.CACHED_USER, '{"id":456}');
  bridge.clearToken(rejected);
  assert.equal(bridge.readToken(), secondToken);
  assert.equal(bridge.values.get(keys.CACHED_USER), '{"id":456}');
  assert.deepEqual(bridge.removed, []);
});

test('missing, malformed, or different expected token cannot clear cached identity', () => {
  for (const expected of [null, '', 'invalid', secondToken]) {
    const bridge = loadBridge({
      [keys.AUTH_TOKEN]: firstToken,
      [keys.CACHED_USER]: '{"id":123}',
    });
    bridge.clearToken(expected);
    assert.equal(bridge.readToken(), firstToken);
    assert.deepEqual(bridge.removed, []);
  }
  const bridge = loadBridge({ [keys.CACHED_USER]: '{"id":123}' });
  bridge.clearToken(firstToken);
  assert.deepEqual(bridge.removed, []);
  assert.equal(bridge.values.has(keys.CACHED_USER), true);
});

test('failed storage removal is best effort and does not escape to Unity', () => {
  const bridge = loadBridge({ [keys.AUTH_TOKEN]: firstToken }, { removeError: true });
  assert.doesNotThrow(() => bridge.clearToken(firstToken));
  assert.deepEqual(bridge.removed, []);
});

test('journal navigation uses the same-origin root with no credentials or query', () => {
  const bridge = loadBridge({ [keys.AUTH_TOKEN]: firstToken });
  bridge.library.AbbySession_OpenJournal();
  assert.deepEqual(bridge.navigations, ['/']);
  assert.deepEqual(bridge.removed, []);
  bridge.checkNoGlobals();
});

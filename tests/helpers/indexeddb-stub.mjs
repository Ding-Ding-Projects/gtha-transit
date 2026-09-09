// A hand-written, minimal in-memory stand-in for IndexedDB, just sufficient for
// `lib/record-history.ts`'s `indexedDbBackend()` and nothing more.
//
// What it supports: `indexedDB.open(name, version)`, `onupgradeneeded` /
// `onsuccess` / `onerror` callback properties (not `addEventListener`, since
// that is the style the adapter under test uses), `db.objectStoreNames`,
// `db.createObjectStore(name, { keyPath })`, `store.createIndex(name,
// keyPath)` for a single string keyPath, `db.transaction(storeNames, mode)`,
// and on the resulting store: `get`, `put`, `delete`, `getAll()`, and
// `index(name).getAll(query)` for an equality match against that index's
// keyPath.
//
// What it deliberately does not support, because the adapter never asks for
// it: cursors, `IDBKeyRange` and range queries of any kind, compound
// (array) keyPaths, out-of-line keys, versioned upgrades past a single
// `onupgradeneeded` pass, transaction `oncomplete`/`onabort`, `count()`,
// `openCursor()`, `deleteDatabase`, and any notion of durability — every
// "database" lives only in the `Map` this module holds in memory and is gone
// the moment `uninstall()` runs or the process exits. A test that wants
// something this stub does not do needs a real browser, not a bigger stub.
//
// Callbacks fire on a microtask, not synchronously, matching real IndexedDB
// closely enough that code written against the real thing (including
// `onupgradeneeded` running to completion before `onsuccess` fires) behaves
// the same way here.

function makeRequest(work) {
  const request = { result: undefined, error: null, onsuccess: null, onerror: null };
  queueMicrotask(() => {
    try {
      request.result = work();
      if (request.onsuccess) request.onsuccess({ target: request });
    } catch (error) {
      request.error = error;
      if (request.onerror) request.onerror({ target: request });
    }
  });
  return request;
}

function makeStoreHandle(storeEntry) {
  return {
    get(key) {
      return makeRequest(() => storeEntry.records.get(String(key)));
    },
    put(value) {
      return makeRequest(() => {
        const key = value[storeEntry.keyPath];
        storeEntry.records.set(String(key), value);
        return key;
      });
    },
    delete(key) {
      return makeRequest(() => {
        storeEntry.records.delete(String(key));
        return undefined;
      });
    },
    getAll(query) {
      return makeRequest(() => {
        const all = [...storeEntry.records.values()];
        return query === undefined ? all : all.filter((record) => record[storeEntry.keyPath] === query);
      });
    },
    index(name) {
      const keyPath = storeEntry.indexes.get(name);
      if (keyPath === undefined) throw new Error(`No such index: ${name}`);
      return {
        getAll(query) {
          return makeRequest(() => {
            const all = [...storeEntry.records.values()];
            return query === undefined ? all : all.filter((record) => record[keyPath] === query);
          });
        },
      };
    },
  };
}

function makeDbHandle(dbEntry) {
  return {
    objectStoreNames: {
      contains: (name) => dbEntry.stores.has(name),
    },
    createObjectStore(name, options = {}) {
      const storeEntry = { keyPath: options.keyPath, records: new Map(), indexes: new Map() };
      dbEntry.stores.set(name, storeEntry);
      return {
        createIndex(indexName, keyPath) {
          if (Array.isArray(keyPath)) throw new Error('indexeddb-stub: compound keyPath indexes are not supported');
          storeEntry.indexes.set(indexName, keyPath);
        },
      };
    },
    transaction(storeNames, _mode) {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      for (const name of names) {
        if (!dbEntry.stores.has(name)) throw new Error(`indexeddb-stub: no such object store: ${name}`);
      }
      return {
        objectStore(name) {
          return makeStoreHandle(dbEntry.stores.get(name));
        },
      };
    },
  };
}

function makeIndexedDb(databases) {
  return {
    open(name, version) {
      const request = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      queueMicrotask(() => {
        try {
          let entry = databases.get(name);
          const oldVersion = entry ? entry.version : 0;
          const newVersion = version ?? (entry ? entry.version : 1);
          const isNew = !entry;
          if (isNew) {
            entry = { name, version: newVersion, stores: new Map() };
            databases.set(name, entry);
          }
          // The handle is on the request before onupgradeneeded fires, matching
          // real IndexedDB: the handler reads the (upgrading) database off
          // `request.result`, not off some value handed to it separately.
          request.result = makeDbHandle(entry);
          if (isNew || newVersion > oldVersion) {
            entry.version = newVersion;
            if (request.onupgradeneeded) request.onupgradeneeded({ target: request, oldVersion, newVersion });
          }
          if (request.onsuccess) request.onsuccess({ target: request });
        } catch (error) {
          // A bug in a caller's onupgradeneeded should surface as a rejected
          // promise on the next `await`, not as a permanently pending one: the
          // first version of this stub fired onupgradeneeded before setting
          // `result`, and the resulting throw vanished into an unhandled
          // microtask rejection, hanging every test that touched it.
          request.error = error;
          if (request.onerror) request.onerror({ target: request });
        }
      });
      return request;
    },
  };
}

/**
 * Install the stub as `globalThis.indexedDB` and return a handle to control
 * it. Call `reset()` between tests that want a clean, empty set of databases
 * without re-requiring the module; call `uninstall()` to remove
 * `globalThis.indexedDB` entirely, for a test that specifically wants to
 * exercise the "no IndexedDB on this origin" path.
 */
export function installIndexedDbStub() {
  let databases = new Map();
  globalThis.indexedDB = makeIndexedDb(databases);
  return {
    reset() {
      databases = new Map();
      globalThis.indexedDB = makeIndexedDb(databases);
    },
    uninstall() {
      delete globalThis.indexedDB;
    },
  };
}

// worker.ts is bundled by wrangler and the Nitro app by Nitro, so each holds
// its own copy of any module they share. State that must cross between the
// two bundles lives on globalThis under these registry keys.

export interface SeedStep {
  done: number;
  total: number;
  finished: boolean;
}

export interface DemoOperations {
  prepare(now: Date): Promise<{ seeded: boolean }>;
  seedStep(startedAt: Date): Promise<SeedStep>;
  tick(now: Date): Promise<void>;
}

const STORAGE = Symbol.for("tetanus.demo.storage");
const OPERATIONS = Symbol.for("tetanus.demo.operations");

type Registry = {
  [STORAGE]?: DurableObjectStorage;
  [OPERATIONS]?: DemoOperations;
};

const registry = globalThis as Registry;

export function bindStorage(storage: DurableObjectStorage) {
  registry[STORAGE] = storage;
}

export function boundStorage(): DurableObjectStorage {
  const storage = registry[STORAGE];
  if (!storage) throw new Error("Durable Object storage is not bound yet");
  return storage;
}

export function publishOperations(operations: DemoOperations) {
  registry[OPERATIONS] = operations;
}

export function demoOperations(): DemoOperations {
  const operations = registry[OPERATIONS];
  if (!operations)
    throw new Error("Nitro app has not published demo operations");
  return operations;
}

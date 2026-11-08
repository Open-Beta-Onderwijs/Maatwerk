// SPDX-License-Identifier: AGPL-3.0-or-later

// The grade rules in Rust (maatwerk-grades, ADR-0011), compiled to WebAssembly. The module is
// inlined in the bundle (ui/vite/grades-wasm.ts): the CSP allows no fetch of it, and needs only
// 'wasm-unsafe-eval'.
// Compiling is async (Chromium refuses a big synchronous compile on the main thread), so
// `initCore` runs once at start; after that every call is synchronous.

import wasmBase64 from 'virtual:maatwerk-grades-wasm';

interface Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  call(namePtr: number, nameLen: number, argsPtr: number, argsLen: number): bigint;
  round1(x: number): number;
  round0(x: number): number;
  clean(x: number): number;
  is_fail(grade: number): number;
}

let core: Exports | null = null;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Loads the module; safe to call more than once. */
export async function initCore(): Promise<void> {
  if (core) return;
  const bytes = Uint8Array.from(atob(wasmBase64), (c) => c.charCodeAt(0));
  const { instance } = await WebAssembly.instantiate(bytes);
  core = instance.exports as unknown as Exports;
}

function exports(): Exports {
  if (!core) throw new Error('initCore() has not run');
  return core;
}

function write(c: Exports, text: string): [number, number] {
  const bytes = encoder.encode(text);
  const ptr = c.alloc(bytes.length);
  new Uint8Array(c.memory.buffer, ptr, bytes.length).set(bytes);
  return [ptr, bytes.length];
}

/** Calls a rule by name. `undefined` arguments reach Rust as `null`. */
export function coreCall<T>(name: string, ...args: unknown[]): T {
  const c = exports();
  const [namePtr, nameLen] = write(c, name);
  const [argsPtr, argsLen] = write(c, JSON.stringify(args.map((a) => a ?? null)));
  const packed = c.call(namePtr, nameLen, argsPtr, argsLen);
  c.dealloc(namePtr, nameLen);
  c.dealloc(argsPtr, argsLen);
  const ptr = Number(packed >> 32n);
  const len = Number(packed & 0xffffffffn);
  // Read after the call: the call can grow memory and detach any earlier view.
  const text = decoder.decode(new Uint8Array(c.memory.buffer, ptr, len));
  c.dealloc(ptr, len);
  const reply = JSON.parse(text) as { ok?: T; error?: string };
  if (reply.error !== undefined) throw new Error(`${name}: ${reply.error}`);
  return reply.ok as T;
}

/** One decimal, exact half-up: every grade, mean and SD (decision 3). */
export const round1 = (x: number): number => exports().round1(x);

/** A whole number, exact half-up: every percentage. */
export const round0 = (x: number): number => exports().round0(x);

/** Without floating-point noise: point totals. */
export const clean = (x: number): number => exports().clean(x);

/** Below 5,5 after rounding. */
export const isFail = (grade: number): boolean => exports().is_fail(grade) !== 0;

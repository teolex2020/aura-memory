import { Blob as NodeBlob } from "node:buffer"
import { randomFillSync, webcrypto } from "node:crypto"
import { createRequire } from "node:module"
import {
  ReadableStream as NodeReadableStream,
  TransformStream as NodeTransformStream,
  WritableStream as NodeWritableStream
} from "node:stream/web"

const require = createRequire(import.meta.url)

type NodeFetchModule = {
  default?: unknown
  Headers?: unknown
  Request?: unknown
  Response?: unknown
} & ((input: unknown, init?: unknown) => Promise<unknown>)

const nodeFetch = require("node-fetch") as NodeFetchModule

/**
 * Node 16 Vitest worker Web Crypto fallback.
 * 中文说明：仅用于测试 worker；生产运行时由 Bun/宿主环境提供 Web Crypto。
 */
const getRandomValues = <T extends ArrayBufferView>(array: T): T => {
  randomFillSync(array as unknown as NodeJS.ArrayBufferView)
  return array
}

/**
 * Define a missing Web API global inside Vitest's Node sandbox.
 * 中文说明：只补缺失的全局 API，避免覆盖新版 Node/Bun 自带实现。
 */
const defineMissingGlobal = (name: PropertyKey, value: unknown): void => {
  if ((globalThis as Record<PropertyKey, unknown>)[name] === undefined) {
    Object.defineProperty(globalThis, name, { configurable: true, value })
  }
}

if (globalThis.crypto === undefined || typeof globalThis.crypto.getRandomValues !== "function") {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto ?? { getRandomValues }
  })
}

defineMissingGlobal("fetch", nodeFetch.default ?? nodeFetch)
defineMissingGlobal("Headers", nodeFetch.Headers)
defineMissingGlobal("Request", nodeFetch.Request)
defineMissingGlobal("Response", nodeFetch.Response)
defineMissingGlobal("Blob", NodeBlob)
defineMissingGlobal("ReadableStream", NodeReadableStream)
defineMissingGlobal("TransformStream", NodeTransformStream)
defineMissingGlobal("WritableStream", NodeWritableStream)

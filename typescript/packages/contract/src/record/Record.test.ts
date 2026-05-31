import { describe, expect, it } from "vitest"
import {
  DEFAULT_NAMESPACE,
  DEFAULT_SEMANTIC_TYPE,
  DEFAULT_SOURCE_TYPE,
  MAX_CONTENT_SIZE_BYTES,
  MAX_TAGS,
  defaultConfidenceForSource,
  validateRecordNamespace,
  validateRecordSemanticType,
  validateRecordSourceType,
  validateRecordStoreInput,
} from "./Record"

describe("Record contract helpers", () => {
  it("exposes Rust record defaults and confidence mapping", () => {
    expect(DEFAULT_NAMESPACE).toBe("default")
    expect(DEFAULT_SOURCE_TYPE).toBe("recorded")
    expect(DEFAULT_SEMANTIC_TYPE).toBe("fact")
    expect(defaultConfidenceForSource("recorded")).toBe(0.9)
    expect(defaultConfidenceForSource("retrieved")).toBe(0.75)
    expect(defaultConfidenceForSource("inferred")).toBe(0.6)
    expect(defaultConfidenceForSource("generated")).toBe(0.5)
    expect(defaultConfidenceForSource("unknown")).toBe(0.5)
  })

  it("validates namespace/source_type/semantic_type like Rust record.rs", () => {
    expect(validateRecordNamespace("default")).toBeUndefined()
    expect(validateRecordNamespace("project-x")).toBeUndefined()
    expect(validateRecordNamespace("test_ns")).toBeUndefined()
    expect(validateRecordNamespace("")).toMatchObject({ _tag: "RecordValidationError" })
    expect(validateRecordNamespace("ns/path")).toMatchObject({ field: "namespace" })
    expect(validateRecordNamespace("a".repeat(65))).toMatchObject({ field: "namespace" })

    expect(validateRecordSourceType("recorded")).toBeUndefined()
    expect(validateRecordSourceType("retrieved")).toBeUndefined()
    expect(validateRecordSourceType("user")).toMatchObject({ field: "source_type" })

    expect(validateRecordSemanticType("fact")).toBeUndefined()
    expect(validateRecordSemanticType("decision")).toBeUndefined()
    expect(validateRecordSemanticType("memory")).toMatchObject({ field: "semantic_type" })
  })

  it("validates Aura::store_with_channel input limits", () => {
    const valid = {
      content: "hello",
      tags: ["a"],
      source_type: "recorded",
      semantic_type: "fact",
      namespace: "default",
    }
    expect(validateRecordStoreInput(valid)).toBeUndefined()
    expect(validateRecordStoreInput({ ...valid, content: "" })).toMatchObject({ field: "content" })
    expect(validateRecordStoreInput({
      ...valid,
      content: "a".repeat(MAX_CONTENT_SIZE_BYTES + 1),
    })).toMatchObject({ field: "content" })
    expect(validateRecordStoreInput({
      ...valid,
      tags: Array.from({ length: MAX_TAGS + 1 }, (_, i) => `t${i}`),
    })).toMatchObject({ field: "tags" })
  })
})

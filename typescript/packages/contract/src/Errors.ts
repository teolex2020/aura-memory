import { Data } from "effect"

export class UnimplementedError extends Data.TaggedError("UnimplementedError")<{
  readonly feature: string
}> {}

export class FileReadError extends Data.TaggedError("FileReadError")<{
  readonly path: string
  readonly cause: unknown
}> {}

export class FileWriteError extends Data.TaggedError("FileWriteError")<{
  readonly path: string
  readonly cause: unknown
}> {}

export class JsonParseError extends Data.TaggedError("JsonParseError")<{
  readonly path: string
  readonly cause: unknown
}> {}

export class CryptoError extends Data.TaggedError("CryptoError")<{
  readonly op: string
  readonly cause: unknown
}> {}

export class FileFormatError extends Data.TaggedError("FileFormatError")<{
  readonly path: string
  readonly message: string
}> {}

export class EmbeddingQueryError extends Data.TaggedError("EmbeddingQueryError")<{
  readonly cause: unknown
}> {}

export class RerankError extends Data.TaggedError("RerankError")<{
  readonly cause: unknown
}> {}

export class FinalizeError extends Data.TaggedError("FinalizeError")<{
  readonly cause: unknown
}> {}

export class RecordValidationError extends Data.TaggedError("RecordValidationError")<{
  readonly field: string
  readonly message: string
  readonly rustReference: string
}> {}

export class RecordNotFoundError extends Data.TaggedError("RecordNotFoundError")<{
  readonly recordId: string
  readonly rustReference: string
}> {}

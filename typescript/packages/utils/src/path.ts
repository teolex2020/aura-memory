import path from "path";

/**
 * Validate that a resolved file path stays within the project root.
 * Prevents path traversal attacks (e.g. node.filePath = "../../etc/passwd").
 *
 * @param projectRoot - The project root directory
 * @param filePath - The relative file path to validate
 * @returns The resolved absolute path, or null if it escapes the root
 */
export function validatePathWithinRoot(
  projectRoot: string,
  filePath: string,
): string | null {
  const resolved = path.resolve(projectRoot, filePath);
  const normalizedRoot = path.resolve(projectRoot);

  if (
    !resolved.startsWith(normalizedRoot + path.sep) &&
    resolved !== normalizedRoot
  ) {
    return null;
  }
  return resolved;
}

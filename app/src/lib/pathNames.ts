/** 生成 Windows 可用的单级路径名称，并按 Unicode 字符而非 UTF-16 单元截断。 */
export function sanitizePathSegment(
  value: string,
  maxChars: number,
  fallback: string,
): string {
  const normalized = Array.from(value)
    .map((char) =>
      char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char,
    )
    .join('')
    .replace(/\s+/g, '_');
  const truncated = Array.from(normalized)
    .slice(0, maxChars)
    .join('')
    .replace(/[. ]+$/g, '');
  return truncated || fallback;
}

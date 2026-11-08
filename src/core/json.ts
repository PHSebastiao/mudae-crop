/** JSON helpers shared by the persisted config and the API payloads. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/** Parse without throwing; a malformed body is just `null` to the caller. */
export function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

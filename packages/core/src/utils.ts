export const nowIso = (): string => new Date().toISOString();

export const createId = (prefix: string): string =>
  `${prefix}_${Math.random().toString(36).slice(2, 10)}`;


export const replaceLiteralCaseInsensitive = (
  value: string,
  search: string,
  replacement: string,
): string => {
  const needle = search.trim();
  if (!needle) {
    return value;
  }

  const lowerValue = value.toLocaleLowerCase();
  const lowerNeedle = needle.toLocaleLowerCase();
  let cursor = 0;
  let result = "";

  while (cursor < value.length) {
    const matchIndex = lowerValue.indexOf(lowerNeedle, cursor);
    if (matchIndex === -1) {
      result += value.slice(cursor);
      break;
    }

    result += value.slice(cursor, matchIndex);
    result += replacement;
    cursor = matchIndex + needle.length;
  }

  return result;
};

export const removeLiteralPrefixCaseInsensitive = (
  value: string,
  prefix: string,
): string => {
  const needle = prefix.trim();
  if (!needle) {
    return value;
  }

  const lowerValue = value.toLocaleLowerCase();
  const lowerNeedle = needle.toLocaleLowerCase();
  if (!lowerValue.startsWith(lowerNeedle)) {
    return value;
  }

  return value.slice(needle.length).trimStart();
};

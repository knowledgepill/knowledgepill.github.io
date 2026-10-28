export function dedup(arr: string[]) {
  const sorted = arr.sort();

  const deduped: string[] = [];
  for (let i = 0; i < sorted.length; i++) {

    const v = sorted[i];
    if (v !== sorted[i - 1]) deduped.push(v);
  }

  return deduped;

}
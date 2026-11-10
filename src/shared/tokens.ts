export type TokenRef = { var: string } | { raw: string | number; reason: string };

function distance(a: string, b: string): number {
  let prev: number[] = [];
  for (let j = 0; j <= b.length; j++) prev.push(j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function nearestNames(target: string, names: string[], n = 3): string[] {
  return names
    .map((name) => ({ name, d: distance(target, name) }))
    .sort((x, y) => x.d - y.d || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0))
    .slice(0, n)
    .map((x) => x.name);
}

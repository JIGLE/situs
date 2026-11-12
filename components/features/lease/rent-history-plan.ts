/** "2025-02" … "2025-05", both ends included. */
export function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let year = Number(first.slice(0, 4));
  let month = Number(first.slice(5, 7));
  for (;;) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    if (key > last) return out;
    out.push(key);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
}

const next = (key: string) => monthsBetween(key, "9999-12")[1];

/**
 * The month each payment, oldest first, starts filling: the ledger's waterfall fills the oldest
 * month still owing, then goes on to the months ahead at the lease's rent. A preview only; the
 * server allocates.
 */
export function plannedMonths(
  open: { month: string; outstanding: number }[],
  amounts: number[],
  rent: number,
  from: string,
): string[] {
  const queue = open.map((m) => ({ ...m }));
  let last = queue.length > 0 ? queue[queue.length - 1].month : null;
  const take = () => {
    if (queue.length === 0) {
      const month = last ? next(last) : from;
      last = month;
      queue.push({ month, outstanding: rent });
    }
    return queue[0];
  };
  return amounts.map((amount) => {
    const first = take().month;
    let left = amount;
    while (left > 0.005 && rent > 0) {
      const head = take();
      const paid = Math.min(left, head.outstanding);
      head.outstanding -= paid;
      left -= paid;
      if (head.outstanding <= 0.005) queue.shift();
    }
    return first;
  });
}

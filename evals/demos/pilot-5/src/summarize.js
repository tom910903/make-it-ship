/** Total per name. */
export const summarize = (rows) => {
  const out = {};
  for (const r of rows) out[r.name] = (out[r.name] ?? 0) + r.amount;
  return out;
};

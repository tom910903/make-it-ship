/** One line per name: "name: total", sorted by name. */
export const render = (totals) => Object.keys(totals).sort().map((k) => `${k}: ${totals[k]}`).join('\n');

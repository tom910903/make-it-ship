/** "name,amount" lines → [{name, amount}] (amount as number). */
export const parse = (text) => text.trim().split('\n').slice(1).map((l) => { const [name, amount] = l.split(','); return { name, amount: Number(amount) }; });

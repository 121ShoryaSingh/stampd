import pg from "pg";

// Prisma's pg adapter sends a query's relation lookups in parallel on a transaction's single connection.
// Postgres runs them one after another anyway, but pg warns (and pg@9 will refuse), so each connection
// waits for its previous query before sending the next.
export function serialPool(config: pg.PoolConfig) {
  const pool = new pg.Pool(config);
  pool.on("connect", (client) => {
    const query = client.query.bind(client) as (...args: unknown[]) => unknown;
    let last: Promise<unknown> = Promise.resolve();
    (client as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
      // Callback style and streaming (submittable) queries keep pg's own handling.
      const first = args[0] as { submit?: unknown } | undefined;
      if (typeof args[args.length - 1] === "function" || typeof first?.submit === "function") return query(...args);
      const run = last.then(() => query(...args));
      last = run.catch(() => {});
      return run;
    };
  });
  return pool;
}

# Neon "SQL over HTTP" Client

This is an (experimental) alternate implementation of the [@neondatabase/serverless](https://www.npmjs.com/package/@neondatabase/serverless) package that uses the [postgres](https://www.npmjs.com/package/postgres) api instead of the [pg](https://www.npmjs.com/package/pg) api.
At the moment, this only supports the sql-over-http protocol. I may add support for sql-over-websockets in the future.

-   One benefit of this approach is that the library size is very small (only 2.75KB gzip compared to 41.1KB ).

## Getting Started

### Simple Queries

```ts
import { neon } from "@nicksrandall/neon-postgres";

const sql = neon("postgres://user:password@localhost:5432/dbname"); // your connection string

const result = await sql`SELECT * FROM users WHERE id = ${1}`;
```

### Complex Queries

```ts
import { neon } from "@nicksrandall/neon";

const sql = neon("postgres://user:password@localhost:5432/dbname"); // your connection string

const olderThan = x => sql`and age > ${ x }`

const filterAge = true

await sql`
  select
   *
  from users
  where name is not null ${
    filterAge
      ? olderThan(50)
      : sql``
  }
`
// Which results in:
select * from users where name is not null
// Or
select * from users where name is not null and age > 50
```

### Transactions

```ts
import { neon } from "@nicksrandall/neon";

const sql = neon("postgres://user:password@localhost:5432/dbname"); // your connection string

const results = await sql.begin([
  await sql`INSERT INTO users (name, age) VALUES (${ "John" }, ${ 30 })`;
  await sql`INSERT INTO users (name, age) VALUES (${ "Jane" }, ${ 40 })`;
  await sql`INSERT INTO users (name, age) VALUES (${ "Joe" }, ${ 50 })`;
]);
```

> NOTE: interactive transactions are not supported at the moment.

## Notes

-   Due to a limitation of Neon's sql-over-http protocol endpoint, argument types are always passed as string and must be casted in the query.
-   This is a work in progress and is not ready for production use.

## License

MIT

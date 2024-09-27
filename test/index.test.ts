import { describe, it, expect, beforeAll } from "bun:test";
import { neon } from "../src";

describe("Working version", () => {
  let sql;
  beforeAll(() => {
    sql = neon(process.env.PG_CONNECTION_STRING || "postgres://localhost:5432");
  });

  it("basic structure", async () => {
    const data = await sql`SELECT 1 as x`;
    expect(data).toEqual([[1]]);
    expect(data.command).toEqual("SELECT");
    expect(data.count).toEqual(1);
  });

  it("should handle number arguments", async () => {
    const data = await sql`SELECT ${1}::int as x`;
    expect(data).toEqual([[1]]);
  });

  it("should handle string arguments", async () => {
    const data = await sql`SELECT ${"hello"} as x`;
    expect(data).toEqual([["hello"]]);
  });

  it("should handle boolean arguments", async () => {
    const data = await sql`SELECT ${true}::bool as x`;
    expect(data).toEqual([[true]]);
  });

  it("should handle date arguments", async () => {
    const data = await sql`SELECT ${new Date(0)}::timestamptz as x`;
    expect(data).toEqual([[new Date(0)]]);
  });

  // json
  it("should handle json arguments", async () => {
    const data = await sql`SELECT ${{ x: 1 }}::jsonb as x`;
    expect(data).toEqual([[{ x: 1 }]]);
  });

  it("should handle json return values", async () => {
    const data =
      await sql`SELECT JSONB_BUILD_OBJECT('key', 2 + ${2}) AS \"data\"`;
    expect(data).toEqual([[{ key: 4 }]]);
  });

  it("pass ported tests", async () => {
    const now = new Date();
    await sql`SELECT ${1} AS int_uncast`;
    await sql`SELECT ${1}::int AS int`;
    await sql`SELECT ${1}::int8 AS int8num`;
    await sql`SELECT ${1}::decimal AS decimalnum`;
    await sql`SELECT ${"[1,4)"}::int4range AS int4range`;
    await sql`SELECT ${"hello"} AS str`;
    await sql`SELECT ${["a", "b", "c"]} AS arrstr_uncast`;
    await sql`SELECT ${[[2], [4]]}::int[][] AS arrnumnested`;
    await sql`SELECT ${now}::timestamptz AS timestamptznow`;
    await sql`SELECT ${"16:17:18+01:00"}::timetz AS timetz`;
    await sql`SELECT ${"17:18:19"}::time AS time`;
    await sql`SELECT ${now}::date AS datenow`;
    await sql`SELECT ${{ x: "y" }} AS obj_uncast`;
    await sql`SELECT ${"11:22:33:44:55:66"}::macaddr AS macaddr`;
    await sql`SELECT ${"\\xDEADBEEF"}::bytea AS bytea`;
    await sql`SELECT ${"(2, 3)"}::point AS point`;
    await sql`SELECT ${"<(2, 3), 1>"}::circle AS circle`;
    await sql`SELECT ${"10.10.10.0/24"}::cidr AS cidr`;
    await sql`SELECT ${true} AS bool_uncast`; // 'true'
    await sql`SELECT ${"hello"} || ' ' || ${"world"} AS greeting`;
    await sql`SELECT ${[1, 2, 3]}::int[] AS arrnum`;
    await sql`SELECT ${["a", "b", "c"]}::text[] AS arrstr`;
    await sql`SELECT ${{ x: "y" }}::jsonb AS jsonb_obj`;
    await sql`SELECT ${{ x: "y" }}::json AS json_obj`;
    await sql`SELECT ${["11:22:33:44:55:66"]}::macaddr[] AS arrmacaddr`;
    await sql`SELECT ${["10.10.10.0/24"]}::cidr[] AS arrcidr`;
    await sql`SELECT ${true}::boolean AS bool`;
    await sql`SELECT ${[now]}::timestamptz[] AS arrtstz`;
    // await sql`SELECT ${["(2, 3)"]}::point[] AS arrpoint`;
    // await sql`SELECT ${["<(2, 3), 1>"]}::circle[] AS arrcircle`; // pg has no parser for this
    await sql`SELECT ${["\\xDEADBEEF", "\\xDEADBEEF"]}::bytea[] AS arrbytea`;
    await sql`SELECT null AS null`;
    await sql`SELECT ${null} AS null`; // us: "null", pg: null
    await sql`SELECT ${"NULL"} AS null_str`;
    await sql`SELECT ${[1, 2, 3]} AS arrnum_uncast`; // us: '{1,2,3}', pg: '{"1","2","3"}' <-- pg imagines strings?
    await sql`SELECT ${[[2], [4]]} AS arrnumnested_uncast`; // us: '{{1,2},{3,4}}', pg: '{{"1","2"},{"3","4"}}' <-- pg imagines strings?
    await sql`SELECT ${now} AS timenow_uncast`; // us: '2023-05-26T13:35:22.616Z', pg: '2023-05-26T14:35:22.616+01:00' <-- different representations
    await sql`SELECT ${now}::timestamp AS timestampnow`; // us: 2023-05-26T12:35:22.696Z, pg: 2023-05-26T13:35:22.696Z <-- different TZs

    // non-template usage
    await sql.execute({
      query: "SELECT $1::timestamp AS timestampnow",
      params: [now],
    });
    await sql.execute({
      query: "SELECT $1 || ' ' || $2 AS greeting",
      params: ["hello", "world"],
    });
  });

  it("should handle array helpers", async () => {
    const data = await sql`select ${sql.array([
      [1, 2],
      [3, 4],
    ])}::int[][] as x`;
    expect(data).toEqual([
      [
        [
          [1, 2],
          [3, 4],
        ],
      ],
    ]);
  });

  it("should handle complex queries", async () => {
    const olderThan = (x) => sql`and age > ${x}`;
    const filterAge = true;
    const query =
      sql`select * from users where name is not null ${filterAge ? olderThan(50) : sql``}`.prepare();
    expect(query.query).toEqual(
      "select * from users where name is not null and age > $1",
    );
    expect(query.params).toEqual(["50"]);
  });
});

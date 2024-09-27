export interface Payload {
  query: string;
  params: string[];
  types?: number[];
}

interface Field {
  name: string;
  tableID: number;
  columnID: number;
  dataTypeID: number;
  dataTypeSize: number;
  dataTypeModifier: number;
  format: string;
}

export interface Result {
  command: string;
  rowCount: number;
  rows: string[][];
  fields: Field[];
}

type ResultSet<T extends any[]> = T[] & { command: string; count: number };
function processResult<T extends any[]>(result: Result) {
  const set = result.rows.map((row) => {
    return row.map((value, index) => {
      const dataTypeId = result.fields[index].dataTypeID ?? -1;
      return deserialize(value, dataTypeId);
    }) as T;
  }) as ResultSet<T>;
  set.command = result.command;
  set.count = result.rowCount;
  return set;
}

/*
const postgresTypeOIDtoName = {
  16: "bool",
  17: "bytea",
  20: "int8",
  21: "int2",
  23: "int4",
  25: "text",
  26: "oid",
  700: "float4",
  701: "float8",
  1082: "date",
  1184: "timestamptz",
  1114: "timestamp",
  114: "jsonb",
  3802: "json",
};
*/

function deserialize(value: string, dataTypeId: number) {
  switch (dataTypeId) {
    case 0: // numbers
    case 21:
    case 23:
    case 26:
    case 700:
    case 701:
      return +value;
    case 17: // bytea
      return Buffer.from(value.slice(2), "hex");
    case 16: // bool
      return value === "t";
    case 20: // bigint
      return BigInt(value);
    case 25: // text
      return value;
    case 1184: // dates
    case 1082:
    case 1114:
      return new Date(value);
    case 3802: // json
    case 114: // jsonb
      return JSON.parse(value);
    case 1007: // arrays
      const v = arrayParser(value, (x: any) => deserialize(x, 0), 0).flat();
      return v;
    default:
      return value;
  }
}

function transformPayload(payload: Payload) {
  return {
    query: payload.query,
    params: payload.params,
    arrayMode: true,
  };
}

export interface SQL {
  (strings: TemplateStringsArray, ...args: any[]): Promise<any[][]>;
  begin: (
    itemsOrFn: Promise<Payload>[] | ((sql: SQL) => Promise<Payload>[]),
  ) => Promise<any>;
  execute: <T extends Array<any>>(payload: Payload) => Promise<T>;
  array: (x: any) => Parameter;
}

export function neon(connectionString: string) {
  const parsed = parseUrl(connectionString);
  async function execute<T extends Array<any>>(
    payload: Payload[],
  ): Promise<T[]>;
  async function execute<T extends Array<any>>(payload: Payload): Promise<T>;
  async function execute<T extends Array<any>>(
    payload: Payload | Payload[],
  ): Promise<T | T[]> {
    const isTransaction = Array.isArray(payload);
    const response = await fetch(`https://${parsed.url.hostname}/sql`, {
      method: "POST",
      headers: {
        "Neon-Connection-String": connectionString,
        "Neon-Raw-Text-Output": "true", // because we do our own parsing with node-postgres
        "Neon-Array-Mode": "true", // this saves data and post-processing even if we return objects, not arrays
      },
      body: JSON.stringify(
        isTransaction
          ? { queries: payload.map(transformPayload) }
          : transformPayload(payload),
      ),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const data = await response.json();
    if (isTransaction) {
      return (data as { results: Result[] }).results.map(processResult) as any;
    }
    return processResult(data as Result) as any;
  }
  function sql(strings: any, ...args: any[]) {
    const query =
      strings && Array.isArray(strings.raw)
        ? new Query(strings, args, execute)
        : typeof strings === "string" && !args.length
          ? new Identifier(strings)
          : new Builder(strings, args);
    return query;
  }

  sql.begin = async function (
    itemsOrFn: Promise<Payload>[] | ((_sql: typeof sql) => Promise<Payload>[]),
  ) {
    const items = typeof itemsOrFn === "function" ? itemsOrFn(sql) : itemsOrFn;
    if (items instanceof Promise) {
      throw new Error(
        "Invalid transaction, interactive transactions are not supported",
      );
    }
    if (!Array.isArray(items)) {
      throw new Error("Invalid transaction, expected an array of queries");
    }
    const queries = items.map((item) => {
      if (item instanceof Query) {
        return item.prepare();
      }
      throw new Error("Invalid query, expected a Query object");
    });
    return execute(queries);
  };
  sql.execute = execute;
  sql.array = (x: Array<any>) =>
    new Parameter(x, x.length ? inferType(x) || 25 : 0);
  return sql as unknown as SQL;
}

class NotTagged {
  then() {
    notTagged();
  }
  catch() {
    notTagged();
  }
  finally() {
    notTagged();
  }
}

function notTagged() {
  throw new Error("Query not called as a tagged template literal");
}

class Query extends Promise<Payload> {
  strings: any;
  fragment?: boolean;
  args: any[];
  resolve: (value: Payload | PromiseLike<Payload>) => void;
  reject: (reason?: any) => void;
  handler: (payload: Payload) => any;
  constructor(strings: any, args: any[], handler: (payload: Payload) => any) {
    let resolve, reject;
    super((a, b) => {
      resolve = a;
      reject = b;
    });
    this.strings = strings;
    this.args = args.map((x) => {
      return x instanceof Parameter
        ? x
        : x instanceof Identifier
          ? x
          : x instanceof Query
            ? x
            : x instanceof Builder
              ? x
              : new Parameter(x);
    });
    this.resolve = resolve!;
    this.reject = reject!;
    this.handler = handler;
  }
  static get [Symbol.species]() {
    return Promise;
  }
  prepare() {
    let parameters: any[] = [],
      types: any[] = [];
    const query = stringify(
      this,
      this.strings[0],
      this.args[0],
      parameters,
      types,
      {},
    );
    const payload: Payload = {
      query,
      params: parameters.map(serialize),
      types: types,
    };
    return payload;
  }
  handle() {
    this.handler(this.prepare()).then(this.resolve).catch(this.reject);
  }
  // @ts-ignore
  then() {
    this.handle();
    super.then.apply(this, arguments as any);
  }
  // @ts-ignore
  catch() {
    this.handle();
    super.catch.apply(this, arguments as any);
  }
  // @ts-ignore
  finally() {
    this.handle();
    super.finally.apply(this, arguments as any);
  }
}

class Identifier extends NotTagged {
  value: any;
  constructor(value: any) {
    super();
    this.value = escapeIdentifier(value);
  }
}

class Parameter extends NotTagged {
  value: any;
  type: number;
  array: any[] | null;
  constructor(value: any, type = inferType(value)) {
    super();
    this.value = value;
    this.type = type;
    this.array = Array.isArray(value) ? value.map(inferType) : null;
  }
}

//
class Builder extends NotTagged {
  first: any;
  rest: any;
  constructor(first: any, rest: any) {
    super();
    this.first = first;
    this.rest = rest;
  }

  build(before: any, parameters: any, types: any, options: any = {}) {
    const keyword = builders
      .map(([x, fn]) => ({ fn, i: before.search(x) }))
      .sort((a, b) => a.i - b.i)
      .pop()!;
    return keyword.i === -1
      ? escapeIdentifiers(this.first, options)
      : (keyword as any).fn(this.first, this.rest, parameters, types, options);
  }
}

function stringify(
  q: Query,
  string: string,
  value: any,
  parameters: any[],
  types: any[],
  options: any = {},
) {
  // eslint-disable-line
  for (let i = 1; i < q.strings.length; i++) {
    string +=
      stringifyValue(string, value, parameters, types, options) + q.strings[i];
    value = q.args[i];
  }

  return string;
}

function stringifyValue(
  string: string,
  value: any,
  parameters: any[],
  types: any[],
  o = {},
) {
  return value instanceof Builder
    ? value.build(string, parameters, types, o)
    : value instanceof Query
      ? fragment(value, parameters, types, o)
      : value instanceof Identifier
        ? value.value
        : value && value[0] instanceof Query
          ? value.reduce(
              (acc, x) => acc + " " + fragment(x, parameters, types, o),
              "",
            )
          : handleValue(value, parameters, types, o);
}

function fragment(
  q: Query,
  parameters: any[],
  types: any[],
  options: any = {},
) {
  q.fragment = true;
  return stringify(q, q.strings[0], q.args[0], parameters, types, options);
}

function firstIsString(x: any) {
  if (Array.isArray(x)) return firstIsString(x[0]);
  return typeof x === "string" ? 1009 : 0;
}

function handleValue(
  x: any,
  parameters: any[],
  types: any[],
  options: any = {},
) {
  let value = x instanceof Parameter ? x.value : x;
  if (value === undefined) {
    x instanceof Parameter
      ? (x.value = options.transform.undefined)
      : (value = x = options.transform.undefined);

    if (value === undefined)
      throw new Error("Undefined values are not allowed");
  }
  const idx = types.push(
    x instanceof Parameter
      ? (parameters.push(x.value),
        x.array
          ? x.array[x.type || inferType(x.value)] ||
            x.type ||
            firstIsString(x.value)
          : x.type)
      : (parameters.push(x), inferType(x)),
  );

  return "$" + idx;
}

function inferType(x: any): number {
  return x instanceof Parameter
    ? x.type
    : x instanceof Date
      ? 1184
      : x instanceof Uint8Array
        ? 17
        : x === true || x === false
          ? 16
          : typeof x === "bigint"
            ? 20
            : Array.isArray(x)
              ? inferType(x[0])
              : inferScalarType(x);
}

const inferScalarType = function inferScalarType(x: any): number {
  if (x === null) return 0;
  switch (typeof x) {
    case "string":
      return 25;
    case "number":
      return x % 1 === 0 ? 23 : 700;
    case "boolean":
      return 16;
    case "object":
      return 114;
  }
  return 0;
};

const serialize = (value: any) => {
  const x = value instanceof Parameter ? value.value : value;
  switch (typeof x) {
    case "string":
      return x;
    case "number":
      return "" + x;
    case "boolean":
      return x ? "t" : "f";
    case "bigint":
      return x.toString();
    case "object":
      if (x instanceof Date) {
        return x.toISOString();
      }
      if (Array.isArray(x)) {
        return "{" + x.map(serialize).join(",") + "}";
      }
      return JSON.stringify(x);
  }
};

function escapeIdentifiers(xs: any[], { transform: { column } }) {
  return xs
    .map((x) => escapeIdentifier(column.to ? column.to(x) : x))
    .join(",");
}

const escapeIdentifier = function escape(str: string) {
  return '"' + str.replace(/"/g, '""').replace(/\./g, '"."') + '"';
};

function parseUrl(url: string) {
  if (!url || typeof url !== "string")
    return { url: { searchParams: new Map() } };

  let host = url;
  host = host.slice(host.indexOf("://") + 3).split(/[?/]/)[0];
  host = decodeURIComponent(host.slice(host.indexOf("@") + 1));

  const urlObj = new URL(url.replace(host, host.split(",")[0]));

  return {
    url: {
      username: decodeURIComponent(urlObj.username),
      password: decodeURIComponent(urlObj.password),
      host: urlObj.host,
      hostname: urlObj.hostname,
      port: urlObj.port,
      pathname: urlObj.pathname,
      searchParams: urlObj.searchParams,
    },
    multihost: host.indexOf(",") > -1 && host,
  };
}
const arrayParserState = {
  i: 0,
  p: null,
  char: null,
  str: "",
  quoted: false,
  last: 0,
};

const arrayParser = function arrayParser(
  x: any,
  parser: any,
  typarray: number,
) {
  arrayParserState.i = arrayParserState.last = 0;
  return arrayParserLoop(arrayParserState, x, parser, typarray);
};

function arrayParserLoop(
  s: typeof arrayParserState,
  x: any,
  parser: any,
  typarray: number,
) {
  const xs: any[] = [];
  // Only _box (1020) has the ';' delimiter for arrays, all other types use the ',' delimiter
  const delimiter = typarray === 1020 ? ";" : ",";
  for (; s.i < x.length; s.i++) {
    s.char = x[s.i];
    if (s.quoted) {
      if (s.char === "\\") {
        s.str += x[++s.i];
      } else if (s.char === '"') {
        xs.push(parser ? parser(s.str) : s.str);
        s.str = "";
        s.quoted = x[s.i + 1] === '"';
        s.last = s.i + 2;
      } else {
        s.str += s.char;
      }
    } else if (s.char === '"') {
      s.quoted = true;
    } else if (s.char === "{") {
      s.last = ++s.i;
      xs.push(arrayParserLoop(s, x, parser, typarray));
    } else if (s.char === "}") {
      s.quoted = false;
      s.last < s.i &&
        xs.push(parser ? parser(x.slice(s.last, s.i)) : x.slice(s.last, s.i));
      s.last = s.i + 1;
      break;
    } else if (s.char === delimiter && s.p !== "}" && s.p !== '"') {
      xs.push(parser ? parser(x.slice(s.last, s.i)) : x.slice(s.last, s.i));
      s.last = s.i + 1;
    }
    s.p = s.char;
  }
  s.last < s.i &&
    xs.push(
      parser ? parser(x.slice(s.last, s.i + 1)) : x.slice(s.last, s.i + 1),
    );
  return xs;
}

function values(first, rest, parameters, types, options) {
  const multi = Array.isArray(first[0]);
  const columns = rest.length
    ? rest.flat()
    : Object.keys(multi ? first[0] : first);
  return valuesBuilder(
    multi ? first : [first],
    parameters,
    types,
    columns,
    options,
  );
}

function select(first, rest, parameters, types, options) {
  typeof first === "string" && (first = [first].concat(rest));
  if (Array.isArray(first)) return escapeIdentifiers(first, options);

  let value;
  const columns = rest.length ? rest.flat() : Object.keys(first);
  return columns
    .map((x) => {
      value = first[x];
      return (
        (value instanceof Query
          ? fragment(value, parameters, types, options)
          : value instanceof Identifier
            ? value.value
            : handleValue(value, parameters, types, options)) +
        " as " +
        escapeIdentifier(
          options.transform.column.to ? options.transform.column.to(x) : x,
        )
      );
    })
    .join(",");
}

const builders = Object.entries({
  values,
  in: (...xs: any[]) => {
    const x = (values as any)(...xs);
    return x === "()" ? "(null)" : x;
  },
  select,
  as: select,
  returning: select,
  "\\(": select,

  update(first, rest, parameters, types, options) {
    return (rest.length ? rest.flat() : Object.keys(first)).map(
      (x) =>
        escapeIdentifier(
          options.transform.column.to ? options.transform.column.to(x) : x,
        ) +
        "=" +
        stringifyValue("values", first[x], parameters, types, options),
    );
  },

  insert(first, rest, parameters, types, options) {
    const columns = rest.length
      ? rest.flat()
      : Object.keys(Array.isArray(first) ? first[0] : first);
    return (
      "(" +
      escapeIdentifiers(columns, options) +
      ")values" +
      valuesBuilder(
        Array.isArray(first) ? first : [first],
        parameters,
        types,
        columns,
        options,
      )
    );
  },
}).map(([x, fn]) => [
  new RegExp("((?:^|[\\s(])" + x + "(?:$|[\\s(]))(?![\\s\\S]*\\1)", "i"),
  fn,
]);

function valuesBuilder(
  first: any,
  parameters: any[],
  types: any[],
  columns: any[],
  options: any = {},
) {
  return first
    .map(
      (row) =>
        "(" +
        columns
          .map((column) =>
            stringifyValue("values", row[column], parameters, types, options),
          )
          .join(",") +
        ")",
    )
    .join(",");
}

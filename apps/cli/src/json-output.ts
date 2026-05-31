export type JsonOutput =
  | boolean
  | number
  | string
  | null
  | JsonOutput[]
  | { [key: string]: JsonOutput };

export function formatIsoTimestamp(timestamp: null | number) {
  return timestamp === null ? null : new Date(timestamp).toISOString();
}

export function printJson(value: JsonOutput) {
  console.log(JSON.stringify(value, null, 2));
}

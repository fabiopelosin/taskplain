import { buildDescribePayload } from "../domain/canonical";

export type DescribeFormat = "json";

export function renderDescribe(format: DescribeFormat = "json"): string {
  if (format !== "json") {
    throw new Error(`Unsupported describe format '${format}'. Expected 'json'.`);
  }
  const payload = buildDescribePayload();
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export type DescribeWriteResult = {
  path: string;
  changed: boolean;
};

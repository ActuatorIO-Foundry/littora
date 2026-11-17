import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv, { ErrorObject, ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

// This boundary owns HTTP schemas. Domain services do not import it.
type Schema = Record<string, any>;
type Parameter = { name: string; in: 'query' | 'path'; required?: boolean; schema: Schema };
export type Operation = {
  operationId: string; parameters?: Parameter[]; requestBody?: Schema;
  responses: Record<string, Schema>;
};
export const contract = parse(readFileSync(resolve(__dirname, '../../../../contracts/openapi.yaml'), 'utf8'));
const ref = (schema: Schema): Schema => schema.$ref
  ? schema.$ref.slice(2).split('/').reduce((node: Schema, key: string) => node[key], contract) : schema;
const validator = (coerceTypes: boolean) => {
  const ajv = new Ajv({ allErrors: true, coerceTypes, strict: true, strictRequired: false });
  addFormats(ajv);
  ajv.addKeyword('example');
  ajv.addKeyword({ keyword: 'components', schemaType: 'object' });
  return ajv;
};
const input = validator(true), output = validator(false);
const compiled = new Map<string, ValidateFunction>();
export const operations = new Map<string, Operation>();
for (const [path, methods] of Object.entries(contract.paths) as [string, Record<string, Operation>][]) {
  for (const [method, operation] of Object.entries(methods)) operations.set(`${method.toUpperCase()} ${path}`, operation);
}

function compile(key: string, schema: Schema, request = false): ValidateFunction {
  let validate = compiled.get(key);
  if (!validate) {
    validate = (request ? input : output).compile({ ...schema, components: contract.components });
    compiled.set(key, validate);
  }
  return validate;
}
export function schemaValidator(name: string): ValidateFunction {
  return compile(`schema:${name}`, { $ref: `#/components/schemas/${name}` });
}
export function inputValidator(operation: Operation, location: 'query' | 'path' | 'body'): ValidateFunction {
  if (location === 'body') {
    const body = operation.requestBody && ref(operation.requestBody);
    return compile(`${operation.operationId}:body`, body?.content['application/json'].schema ?? { type: 'object', maxProperties: 0 });
  }
  const parameters = (operation.parameters ?? []).map(ref).filter(p => p.in === location);
  return compile(`${operation.operationId}:${location}`, {
    type: 'object', additionalProperties: false,
    properties: Object.fromEntries(parameters.map(p => [p.name, p.schema])),
    required: parameters.filter(p => p.required).map(p => p.name),
  }, true);
}
export function responseValidator(operation: Operation, status: number): ValidateFunction {
  const response = ref(operation.responses[String(status)] ?? operation.responses.default);
  return compile(`${operation.operationId}:${status}`, response.content['application/json'].schema);
}
export const validationDetails = (errors: ErrorObject[] | null | undefined) =>
  (errors ?? []).map(error => ({ path: error.instancePath || '/', message: error.message ?? 'Invalid value' }));

// Fail at startup if a schema is invalid, rather than on the first public request.
for (const name of Object.keys(contract.components.schemas)) schemaValidator(name);
for (const operation of operations.values()) {
  for (const location of ['query', 'path', 'body'] as const) inputValidator(operation, location);
  for (const status of Object.keys(operation.responses)) responseValidator(operation, status === 'default' ? 400 : Number(status));
}

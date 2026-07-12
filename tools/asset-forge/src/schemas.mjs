import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { PATHS } from './config.mjs';

const ajv = new Ajv({ allErrors: true, strict: true, validateSchema: true });
addFormats(ajv);
const schemaFiles = fs.readdirSync(PATHS.schemas).filter((name) => name.endsWith('.schema.json')).sort();
const schemas = new Map();
for (const name of schemaFiles) {
  const schema = JSON.parse(fs.readFileSync(path.join(PATHS.schemas, name), 'utf8'));
  ajv.addSchema(schema);
  schemas.set(name, schema);
}

export function validatorFor(name) {
  const schema = schemas.get(name);
  if (!schema) throw new Error(`Unknown schema: ${name}`);
  const validator = ajv.getSchema(schema.$id);
  if (!validator) throw new Error(`Schema did not compile: ${name}`);
  return validator;
}

export function validateWith(name, value) {
  const validator = validatorFor(name);
  const ok = validator(value);
  return { ok: Boolean(ok), errors: ok ? [] : structuredClone(validator.errors ?? []) };
}

export const compiledSchemaNames = Object.freeze([...schemas.keys()]);

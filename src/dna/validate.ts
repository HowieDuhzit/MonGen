import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import schema from "../../schemas/creature-dna.schema.json";
import type { CreatureDNA, Quaternion } from "./types";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile<CreatureDNA>(schema);

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

function isUnitQuaternion(q: Quaternion): boolean {
  const squaredLength = q.reduce((sum, component) => sum + component * component, 0);
  return Math.abs(squaredLength - 1) <= 1e-6;
}

function formatAjvError(error: ErrorObject): string {
  return `${error.instancePath || "/"} ${error.message ?? "is invalid"}`;
}

/**
 * Validates both JSON structure and semantic constraints JSON Schema cannot
 * express cleanly (unique attachment IDs and normalized rotations).
 */
export function validateCreatureDNA(input: unknown): ValidationResult {
  if (!validateSchema(input)) {
    return {
      valid: false,
      errors: (validateSchema.errors ?? []).map(formatAjvError),
    };
  }

  const errors: string[] = [];
  const ids = new Set<string>();

  input.attachments.forEach((attachment, index) => {
    if (ids.has(attachment.id)) {
      errors.push(`/attachments/${index}/id must be unique`);
    }
    ids.add(attachment.id);

    if (!isUnitQuaternion(attachment.transform.rotation)) {
      errors.push(`/attachments/${index}/transform/rotation must be a normalized quaternion`);
    }
  });

  return { valid: errors.length === 0, errors };
}

export function assertCreatureDNA(input: unknown): asserts input is CreatureDNA {
  const result = validateCreatureDNA(input);
  if (!result.valid) {
    throw new TypeError(`Invalid CreatureDNA:\n${result.errors.join("\n")}`);
  }
}

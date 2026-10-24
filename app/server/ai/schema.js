// The same real JSON Schema is sent to the model and enforced again locally.
const text = (maxLength) => ({ type: 'string', maxLength });
const array = (items, maxItems) => ({ type: 'array', items, maxItems });
const object = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
export function suggestionSchema(taxonomy) {
  const ids = (kind) =>
    array(
      {
        type: 'string',
        enum: taxonomy[kind].length ? taxonomy[kind].map((t) => t.id) : ['NO_EXISTING_ID'],
      },
      10,
    );
  return object({
    status: { type: 'string', enum: ['ready', 'insufficient'] },
    title: text(200),
    summary: text(1000),
    reason: text(600),
    domains: ids('domains'),
    tags: ids('tags'),
    collections: ids('collections'),
    newTags: array(text(50), 5),
    points: array(text(500), 10),
    sections: array(
      object({ heading: text(100), paragraphs: array(text(1500), 8), points: array(text(500), 8) }),
      8,
    ),
  });
}
export function validateSchema(value, schema) {
  const invalid = () => {
    throw new Error('invalid_output');
  };
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    if (
      Object.keys(value).some((k) => !Object.hasOwn(schema.properties, k)) ||
      schema.required.some((k) => !Object.hasOwn(value, k))
    )
      invalid();
    for (const [k, s] of Object.entries(schema.properties)) validateSchema(value[k], s);
  } else if (schema.type === 'array') {
    if (
      !Array.isArray(value) ||
      value.length > schema.maxItems ||
      value.length < (schema.minItems || 0)
    )
      invalid();
    for (const v of value) validateSchema(v, schema.items);
  } else if (
    typeof value !== 'string' ||
    value.length > (schema.maxLength ?? Infinity) ||
    (schema.enum && !schema.enum.includes(value))
  )
    invalid();
  return value;
}

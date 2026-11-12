const { mkdirSync, writeFileSync } = require("node:fs");
const { flowDocumentJsonSchema } = require("../dist");
mkdirSync("schemas", { recursive: true });
writeFileSync(
  "schemas/workflow-v2.schema.json",
  JSON.stringify(
    {
      $id: "https://rpa.local/schemas/workflow-v2.schema.json",
      ...flowDocumentJsonSchema,
    },
    null,
    2,
  ) + "\n",
);

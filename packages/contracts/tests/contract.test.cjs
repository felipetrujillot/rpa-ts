const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const c = require("../dist");
test("agent and server share strict protocol v2 envelopes", () => {
  const command = {
    protocolVersion: 2,
    command_id: randomUUID(),
    uuid_agente: "agent",
    uuid_flow_run: "run",
    lease_token: randomUUID(),
    lease_expires_at: new Date(Date.now() + 60000).toISOString(),
    may_have_started: false,
    kind: "run_flow",
    document: c.createWorkflow(),
  };
  const { kind, ...data } = command;
  assert.equal(
    c.serverMessageSchema.safeParse({
      protocolVersion: 2,
      type: "command",
      command: kind,
      data,
    }).success,
    true,
  );
  assert.equal(
    c.agentMessageSchema.safeParse({
      protocolVersion: 2,
      type: "command_ack",
      command_id: command.command_id,
      lease_token: command.lease_token,
    }).success,
    true,
  );
  assert.equal(
    c.agentMessageSchema.safeParse({ type: "heartbeat" }).success,
    false,
  );
  assert.equal(
    c.durableCommandSchema.safeParse({ ...command, protocolVersion: 1 })
      .success,
    false,
  );
  assert.equal(
    c.durableCommandSchema.safeParse({ ...command, document: undefined })
      .success,
    false,
  );
});
test("n8n interchange preserves every RPA field and rejects unimplemented native nodes", () => {
  const document = c.createWorkflow();
  document.workflow.variables = { count: 2 };
  document.workflow.settings.maxNodeExecutions = 50;
  const exported = c.exportN8nWorkflow(document);
  assert.equal(exported.nodes[0].type, "n8n-nodes-base.manualTrigger");
  assert.deepEqual(c.importN8nWorkflow(exported).normalized, document);
  exported.nodes[0].type = "n8n-nodes-base.httpRequest";
  assert.equal(c.importN8nWorkflow(exported).ok, false);
});
test("standalone JSON Schema describes only the current document version", () => {
  const schema = require("../schemas/workflow-v2.schema.json");
  assert.equal(schema.properties.schemaVersion.const, "2.0.0");
  assert.equal(schema.additionalProperties, false);
});

import { describe, expect, it } from "vitest";
import { validateFlowDocument } from "@rpa/contracts";
import { createWorkflowAgentsGuide } from "../layers/admin/app/utils/workflow-agents";
import { defaultActionIds } from "../layers/admin/app/utils/workflow-editor";

function jsonBlocks(guide: string): unknown[] {
  return [...guide.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) =>
    JSON.parse(match[1]!),
  );
}

describe("workflow agent guide", () => {
  it("includes CUA destinations and field descriptions for generated workflows", () => {
    const catalog = jsonBlocks(
      createWorkflowAgentsGuide(["cua.cursor.move"]),
    ).find(Array.isArray);
    expect(catalog).toEqual([
      expect.objectContaining({
        actionId: "cua.cursor.move",
        description: expect.stringContaining("puntero real"),
        suggestedInput: expect.objectContaining({
          scope: "window",
          pid: 0,
          windowId: 0,
        }),
        inputFields: expect.arrayContaining([
          expect.objectContaining({ key: "scope", type: "select" }),
        ]),
      }),
    ]);
  });
  it("includes a complete example that passes the shared graph and action validator", () => {
    const blocks = jsonBlocks(createWorkflowAgentsGuide(defaultActionIds));
    const documents = blocks.filter(
      (block) =>
        block !== null &&
        typeof block === "object" &&
        "kind" in block &&
        block.kind === "rpa.workflow",
    );
    expect(documents).toHaveLength(1);
    expect(
      validateFlowDocument(documents[0], {
        knownActionIds: new Set(defaultActionIds),
      }),
    ).toMatchObject({ ok: true, errors: [] });
  });

  it("reflects configured actions without retaining the default catalog", () => {
    const guide = createWorkflowAgentsGuide([
      "playwright.page.type",
      "custom.action",
      "playwright.page.type",
    ]);
    const catalog = jsonBlocks(guide).find(Array.isArray);
    expect(catalog).toEqual([
      {
        actionId: "playwright.page.type",
        suggestedInput: { selector: "", text: "", clearFirst: true },
      },
      { actionId: "custom.action", suggestedInput: {} },
    ]);
    expect(guide).not.toContain("{{ACTION_CATALOG}}");
    expect(
      jsonBlocks(createWorkflowAgentsGuide([])).find(Array.isArray),
    ).toEqual([]);
  });
});

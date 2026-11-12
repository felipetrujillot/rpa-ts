import type { RunStatus, RobotRunStatus } from "@rpa/contracts";
export type { RunStatus, RobotRunStatus } from "@rpa/contracts";
export const isTerminal = (status: RunStatus) =>
  ["success", "failed", "cancelled"].includes(status);
// A terminal robot report means the local worker is quiescent, including a completion
// racing a cancellation. Never resurrect terminal runs or accept a late "running".
export const resolveRunTransition = (
  current: RunStatus,
  reported: RobotRunStatus,
): RunStatus | null => {
  if (isTerminal(current)) return null;
  if (current === "cancelling")
    return reported === "running" ? null : "cancelled";
  if (reported === "cancelled") return null;
  if (current === "queued") return reported === "running" ? "running" : null;
  return reported;
};

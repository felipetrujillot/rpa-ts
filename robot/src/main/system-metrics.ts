import { statfs } from "node:fs/promises";
import { cpus, freemem, totalmem } from "node:os";
import type { AgentSystemMetrics } from "@rpa/contracts";

type CpuCounters = { total: number; idle: number };

let previousCpuCounters: CpuCounters | null = null;

const readCpuCounters = (): CpuCounters | null => {
  const processors = cpus();
  if (processors.length === 0) return null;

  return processors.reduce(
    (total, processor) => {
      const times = processor.times;
      return {
        total:
          total.total +
          times.user +
          times.nice +
          times.sys +
          times.idle +
          times.irq,
        idle: total.idle + times.idle,
      };
    },
    { total: 0, idle: 0 },
  );
};

const systemVolumePath = () => {
  if (process.platform !== "win32") return "/";
  const drive = (process.env.SystemDrive || "C:").replace(/[\\/]+$/, "");
  return `${drive}\\`;
};

const readStorageMetrics = async () => {
  try {
    const filesystem = await statfs(systemVolumePath());
    const blockSize = filesystem.bsize;
    const totalBytes = Math.max(0, filesystem.blocks * blockSize);
    const availableBytes = Math.max(0, filesystem.bavail * blockSize);
    const usedBytes = Math.max(0, totalBytes - availableBytes);

    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
      return {
        storage_used_bytes: null,
        storage_available_bytes: null,
        storage_total_bytes: null,
      };
    }

    return {
      storage_used_bytes: Math.round(usedBytes),
      storage_available_bytes: Math.round(availableBytes),
      storage_total_bytes: Math.round(totalBytes),
    };
  } catch {
    // Keep CPU and memory metrics available when the system volume is not readable.
    return {
      storage_used_bytes: null,
      storage_available_bytes: null,
      storage_total_bytes: null,
    };
  }
};

export const collectSystemMetrics = async (): Promise<AgentSystemMetrics> => {
  const currentCpuCounters = readCpuCounters();
  let cpuUsagePercent: number | null = null;

  if (currentCpuCounters && previousCpuCounters) {
    const totalDelta = currentCpuCounters.total - previousCpuCounters.total;
    const idleDelta = currentCpuCounters.idle - previousCpuCounters.idle;
    if (totalDelta > 0 && idleDelta >= 0) {
      cpuUsagePercent = Math.round(
        Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)) * 10,
      ) / 10;
    }
  }
  previousCpuCounters = currentCpuCounters;

  const memoryTotalBytes = totalmem();
  const memoryUsedBytes = Math.max(0, memoryTotalBytes - freemem());
  const storage = await readStorageMetrics();

  return {
    sampled_at: new Date().toISOString(),
    cpu_usage_percent: cpuUsagePercent,
    memory_used_bytes: memoryUsedBytes,
    memory_total_bytes: memoryTotalBytes,
    ...storage,
  };
};

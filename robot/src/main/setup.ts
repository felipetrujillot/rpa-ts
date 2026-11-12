import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  RobotSetupRequirement,
  RobotSetupStatus,
} from "@rpa/contracts";
import { CuaDriver, cuaBinary } from "../automation/drivers/cua-driver";

type CliResult = {
  code: number | null;
  output: string;
  stderr: string;
  error?: string;
};

type DoctorResult = { ok?: boolean; build?: { version?: string } };

const runCuaCli = (args: string[], timeoutMs = 20_000): Promise<CliResult> =>
  new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cuaBinary(), args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, CUA_TELEMETRY_ENABLED: "false" },
      });
    } catch (error) {
      resolve({ code: null, output: "", stderr: "", error: String(error) });
      return;
    }

    let output = "";
    let stderr = "";
    let settled = false;
    const finish = (result: CliResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: null, output, stderr, error: "La comprobación agotó el tiempo." });
    }, timeoutMs);
    timer.unref();
    child.stdout?.on("data", (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-12_000);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4_000);
    });
    child.on("error", (error) =>
      finish({ code: null, output, stderr, error: error.message }),
    );
    child.on("close", (code) => finish({ code, output, stderr }));
  });

const permissionState = (output: string, label: string) => {
  const line = output
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .find((candidate) => candidate.trim().toLowerCase().startsWith(`${label.toLowerCase()}:`));
  if (!line) return null;
  return /\bgranted\b|✅/i.test(line) && !/\bnot granted\b/i.test(line);
};

const requirement = (
  id: RobotSetupRequirement["id"],
  label: string,
  ready: boolean,
  detail: string,
): RobotSetupRequirement => ({ id, label, ready, detail });

export async function inspectRobotSetup(): Promise<RobotSetupStatus> {
  const doctor = await runCuaCli(["doctor", "--json"]);
  let doctorData: DoctorResult | null = null;
  try {
    doctorData = JSON.parse(doctor.output) as DoctorResult | null;
  } catch {
    // Missing driver and CLI failures are reported in the checklist below.
  }
  const driverVersion = doctorData?.build?.version ?? null;
  const driverAvailable = driverVersion !== null;
  const driverReady = doctor.code === 0 && doctorData?.ok === true;
  const details: string[] = [];
  if (driverReady) {
    details.push(`CUA Driver ${driverVersion ?? "instalado"} está disponible.`);
  } else if (driverAvailable) {
    details.push(
      `CUA Driver ${driverVersion} está instalado, pero el diagnóstico detectó que requiere atención.`,
    );
  } else {
    details.push(
      doctor.error ||
        doctor.stderr.trim() ||
        (doctor.output.trim()
          ? "El diagnóstico de CUA Driver indica que necesita atención."
          : "No se encontró CUA Driver o no pudo iniciarse."),
    );
  }

  let permissionsOutput = "";
  if (driverAvailable) {
    const permissionCheck = await runCuaCli(["permissions", "status"]);
    permissionsOutput = `${permissionCheck.output}\n${permissionCheck.stderr}`;
  }

  let accessibilityProbe = false;
  let screenProbe = false;
  let accessibilityError = "";
  let screenError = "";
  if (driverAvailable) {
    const cua = new CuaDriver(`rpa-onboarding-${randomUUID()}`);
    try {
      await cua.call("get_accessibility_tree");
      accessibilityProbe = true;
    } catch (error) {
      accessibilityError = error instanceof Error ? error.message : String(error);
    }
    try {
      await cua.call("get_desktop_state", { max_image_dimension: 1400 });
      screenProbe = true;
    } catch (error) {
      screenError = error instanceof Error ? error.message : String(error);
    } finally {
      await cua.shutdown();
    }
  }

  const reportedAccessibility = permissionState(permissionsOutput, "Accessibility");
  const reportedScreenRecording = permissionState(permissionsOutput, "Screen Recording");
  const onMac = process.platform === "darwin";
  const screenPermissionLabel = onMac
    ? "Grabación de pantalla"
    : "Captura del escritorio";
  const accessibilityReady = driverAvailable && accessibilityProbe &&
    (!onMac || reportedAccessibility !== false);
  const screenRecordingReady = driverAvailable && screenProbe &&
    (!onMac || reportedScreenRecording !== false);

  const requirements = [
    requirement(
      "cua-driver",
      "CUA Driver",
      driverReady,
      driverReady
        ? details[0]
        : `${details[0]} Instálalo para habilitar el control del escritorio.`,
    ),
    requirement(
      "accessibility",
      "Accesibilidad",
      accessibilityReady,
      accessibilityReady
        ? "CUA puede leer los controles de las ventanas."
        : !driverAvailable
          ? "Instala CUA Driver para comprobar este permiso."
          : accessibilityError || "Autoriza Accesibilidad para CUA Driver en el sistema.",
    ),
    requirement(
      "screen-recording",
      screenPermissionLabel,
      screenRecordingReady,
      screenRecordingReady
        ? "CUA puede capturar el escritorio."
        : !driverAvailable
          ? "Instala CUA Driver para comprobar este permiso."
          : screenError || (onMac
            ? "Autoriza Grabación de pantalla para CUA Driver en el sistema."
            : "Comprueba que haya una sesión de escritorio visible y accesible para CUA."),
    ),
  ];

  return {
    ready: requirements.every((item) => item.ready),
    checkedAt: new Date().toISOString(),
    platform: process.platform,
    driverVersion,
    requirements,
  };
}

export async function requestCuaPermissions(): Promise<{ output: string }> {
  const result = await runCuaCli(["permissions", "grant"], 90_000);
  return {
    output: result.error || `${result.output}\n${result.stderr}`.trim() ||
      (result.code === 0
        ? "Solicitud finalizada. Revisa los permisos en Ajustes del Sistema y vuelve a comprobar."
        : `La solicitud terminó con código ${result.code ?? "desconocido"}.`),
  };
}

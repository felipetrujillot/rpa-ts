import type { AutomationInput } from "./types";

export const readStringField = (
  input: AutomationInput | undefined,
  field: string,
  defaultValue = "",
): string => {
  const value = input?.[field];

  if (typeof value === "string") {
    return value;
  }

  if (value == null) {
    return defaultValue;
  }

  return String(value);
};

export const readRequiredStringField = (
  input: AutomationInput | undefined,
  field: string,
): string | null => {
  const value = readStringField(input, field, "").trim();

  if (!value) {
    return null;
  }

  return value;
};

export const readNumberField = (
  input: AutomationInput | undefined,
  field: string,
  defaultValue: number,
): number => {
  const value = input?.[field];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return defaultValue;
};

export const readBooleanField = (
  input: AutomationInput | undefined,
  field: string,
  defaultValue: boolean,
): boolean => {
  const value = input?.[field];

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  return defaultValue;
};

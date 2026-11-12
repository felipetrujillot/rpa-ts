export type AutomationPrimitive = string | number | boolean | null;
export type AutomationValue =
  AutomationPrimitive | AutomationValue[] | { [key: string]: AutomationValue };

export type AutomationInput = Record<string, AutomationValue | undefined>;

export type InputFieldType = "text" | "number" | "boolean" | "select" | "image";

export type ActionInputFieldOption = {
  label: string;
  value: string;
};

export type ActionInputField = {
  key: string;
  label: string;
  type: InputFieldType;
  required?: boolean;
  description?: string;
  defaultValue?: AutomationPrimitive;
  options?: ActionInputFieldOption[];
};

export type ActionAvailability = {
  available: boolean;
  unavailableReason?: string;
};

export type ActionDescriptor = {
  id: string;
  appId: string;
  name: string;
  description: string;
  tags?: string[];
  inputFields?: ActionInputField[];
  available: boolean;
  unavailableReason?: string;
};

export type ActionRunResult<Output = unknown> = {
  ok: boolean;
  message: string;
  output?: Output;
  errorCode?: string;
};

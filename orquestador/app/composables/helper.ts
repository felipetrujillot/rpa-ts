import { v4 as uuid } from "uuid";

/**
 *
 * @param numero
 */
export const clpFormat = (numero: number) => {
  // Configuración para formato de moneda chilena
  const formatoPesosChilenos = new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0, // Puedes ajustar esto según tus necesidades
  });
  // Formatear el número a pesos chilenos
  return formatoPesosChilenos.format(numero);
};
/**
 * deja float con 2 decimales
 * @param
 * @return
 */

export const floatTwoDecimals = (inputText: string) => {
  const match = inputText.match(/^(0?[1-9]\d*|0)(\.\d{0,2})?/);
  if (match) {
    return match[0];
  }
  return "";
};

/**
 *
 * @param timeStampRecibido
 * @returns
 */
export const formatearTimeStamp = (timeStampRecibido: string) => {
  //Formateamos Fecha
  const fecha = timeStampRecibido.substring(0, 10);
  const diaFecha = fecha.substring(8, 10);
  const mesFecha = fecha.substring(5, 7);
  const anioFecha = fecha.substring(0, 4);
  //Formateamos Hora

  return {
    nuevaFecha: diaFecha + "-" + mesFecha + "-" + anioFecha,
    nuevaHora: timeStampRecibido.substring(11, 16),
  };
};

/**
 *
 * @param day
 * @param month
 * @param year
 * @returns
 */
export const setDefaultDate = (day: number, month: number, year: number) => {
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  return date;
};

export const getStringDate = () => {
  const date = new Date();

  const formattedDate = date.toLocaleString("es-CL", {
    timeZone: "America/Santiago",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const [day, month, year] = formattedDate.split("-");

  return [day, month, year];
};
/**
 *
 * @returns
 */
export const getCurrentDate = () => {
  const date = new Date();

  const formattedDate = date.toLocaleString("es-CL", {
    timeZone: "America/Santiago",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const [day, month, year] = formattedDate.split("-");

  const newDat = new Date(
    parseInt(year!),
    parseInt(month!) - 1,
    parseInt(day!),
    0,
    0,
    0,
    0,
  );

  return newDat;
};

export const formatearDate = (date: Date) => {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0"); // Months are zero-based
  const year = date.getUTCFullYear();

  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");

  return {
    nuevaFecha: `${day}-${month}-${year}`,
    nuevaHora: `${hours}:${minutes}`,
  };
};

/**
 * Simplifica el uso de modales para llamar de un lugar centralizado
 * @param status
 * @param msg
 */
export const toast = async (
  status: "success" | "ok" | "warning" | "wrn" | "error" | "err",
  msg: string,
) => {
  const { toast } = await import("vue-sonner");

  return toast(msg);
  if (status === "err" || status === "error") {
    return toast({
      description: msg,
      variant: "error",
    });
  }

  if (status === "warning" || status === "wrn") {
    return toast({
      description: msg,
      variant: "warning",
    });
  }

  return toast({
    description: msg,
  });
};

export const generateRandom13Digits = () => {
  // Generate a random decimal between 0 (inclusive) and 1 (exclusive)
  const randomDecimal = Math.random();

  // Convert the decimal to a 13-digit integer
  const random13Digits = Math.floor(randomDecimal * 1000000000000);

  return random13Digits;
};

/**
 *
 * @returns
 */
export const generateRandom5Digits = () => {
  // Generate a random decimal between 0 (inclusive) and 1 (exclusive)
  const randomDecimal = Math.random();

  // Convert the decimal to a 13-digit integer
  const random13Digits = Math.floor(randomDecimal * 10000);

  return random13Digits;
};

export const generateRandomHex = () => {
  const randomColor = Math.floor(Math.random() * 16777215).toString(16);

  // Ensure the color has six digits (add leading zeros if needed)
  return "#" + "0".repeat(6 - randomColor.length) + randomColor;
};

/**
 * regex que valida si el input es email
 * @param email
 * @return boolean
 */
export const isEmail = (email: string) => {
  const emailRegex = /^[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,4}$/;

  if (!emailRegex.test(email)) {
    return false;
  } else {
    return true;
  }
};

/**
 *
 * @param inputValue
 * @returns
 */
export const stringFormat = (inputValue: string) => {
  if (inputValue.length > 0) return inputValue;
  return "-";
};

export const isAuthenticated = async () => {
  const { $trpc } = useNuxtApp();
  const token = useCookie("token");
  const nombre = useCookie("nombre");

  if (!token.value || !nombre.value) {
    return false;
  }

  try {
    const res = await $trpc.auth.validaToken.query({ token: token.value! });

    if ("uuid_empresa" in res && "uuid_usuario" in res) {
      return res;
    }
    return false;
  } catch (error) {
    token.value = null;
    nombre.value = null;
    return false;
  }
  return false;
};
/**
 *
 * @param inputString
 * @returns
 */
export const extractNumbersAndConvertToInt = (inputString: string) => {
  // Use a regular expression to remove non-digit characters
  const digitsOnly = inputString.replace(/\D/g, "");

  // Convert the resulting string of digits to an integer
  const result = parseInt(digitsOnly);

  return result;
};

/**
 *
 * @returns
 */
export const logoutToIndex = () => {
  const token = useCookie("token");
  const name = useCookie("name");
  const role_name = useCookie("role_name");

  token.value = null;
  name.value = null;
  role_name.value = null;

  return window.location.replace("/");
};

/**
 *
 * @param title
 */
export const documentTitle = (title: string) => {
  const projectName = "RPA";

  useHead({
    title: `${title} - ${projectName}`,
    meta: [{ name: "description", content: projectName }],
  });
};
export const uploadPublicFileGcp = async (file: File) => {
  const formData = new FormData();
  formData.append("document", file, file.name);

  const url = `/api/upload`;

  /**
   */

  const res = await $fetch(url, {
    method: "POST",
    body: formData,
  });

  return res;
};

/**
 * Sube archivo
 * Retorna url de gcp
 * PÚBLICO
 * @param file
 * @returns
 */
export const uploadFileGcp = async (file: File) => {
  const formData = new FormData();
  formData.append("document", file, file.name);

  const url = `/api/upload-private`;

  /**
   */

  const res = await $fetch(url, {
    method: "POST",
    body: formData,
  });

  return res;
};

/**
 *
 * @param fileName
 * @returns
 */
export const extractFileInfo = (fileName: string) => {
  // Get the format (extension)
  const format = fileName.split(".").pop();

  // Get the name without the format
  const name = fileName.substring(0, fileName.lastIndexOf("."));

  return { name, format: format! };
};

export const newUuid = () => {
  const newId = uuid();

  return newId;
};

/**
 *
 * @param seconds
 */
export const timeSleep = async (seconds: number) => {
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
};

/**
 * Genera un ID corto con un prefijo específico
 * Ejemplo: generateShortId("USR") podría generar "USR-5G7H2K"
 *
 * @param prefix
 * @returns
 */
export function generateShortId(prefix: string = "ID"): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";

  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return `${prefix}-${result}`;
}

export const reemplazarVariablesEnPlantilla = (
  plantilla: string,
  variables: Record<string, string>,
): string => {
  let resultado = plantilla;
  for (const [clave, valor] of Object.entries(variables)) {
    const regex = new RegExp(`\\$${clave}\\$`, "g");
    resultado = resultado.replace(regex, valor);
  }
  return resultado;
};

export const scrollToTop = () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
};

export const newTab = (url: string) => {
  window.open(url, "_blank");
};

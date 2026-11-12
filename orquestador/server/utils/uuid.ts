import { v4 as uuid } from "uuid";

export const newUuid = () => {
  const newId = uuid();

  return newId;
};

export { generatePairingCode as generarCodigoVinculacion } from "../auth/pairing";

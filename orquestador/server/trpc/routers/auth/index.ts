import { router } from "../../trpc";
import loginApi from "./loginApi";
import validaToken from "./validaToken";
import validaRootToken from "./validaRootToken";

/**
 * Router para autenticación y autorización, incluyendo login y validación de tokens.
 * Este router maneja las operaciones relacionadas con la autenticación de usuarios y la validación de tokens de acceso.
 * - `loginApi`: Procedimiento para iniciar sesión y obtener un token de acceso.
 * - `validaToken`: Procedimiento protegido para validar un token de acceso y obtener la información del usuario asociado.
 * - `validaRootToken`: Procedimiento protegido para validar un token de acceso con privilegios de root y obtener la información del usuario asociado.
 */
export const authTrpc = router({
  loginApi: loginApi,

  validaToken: validaToken,

  validaRootToken: validaRootToken,
});

import { router } from "../../trpc";
import getEmpresas from "./getEmpresas";
import addEmpresa from "./addEmpresa";
import getEmpresaById from "./getEmpresaById";
import updateEmpresa from "./updateEmpresa";
import deleteEmpresa from "./deleteEmpresa";
import addUsuarioEmpresa from "./addUsuarioEmpresa";
import updateUsuarioEmpresa from "./updateUsuarioEmpresa";
import deleteUsuarioEmpresa from "./deleteUsuarioEmpresa";
import suplantarUsuario from "./suplantarUsuario";

/**
 * Root router for the application
 */
export const rootTrpc = router({
  //
  getEmpresas,
  //
  addEmpresa,
  //
  getEmpresaById,
  //
  updateEmpresa,
  //
  deleteEmpresa,
  //
  addUsuarioEmpresa,
  //
  updateUsuarioEmpresa,
  //
  deleteUsuarioEmpresa,
  //
  suplantarUsuario,
});

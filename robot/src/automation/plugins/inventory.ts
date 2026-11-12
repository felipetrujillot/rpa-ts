import { inspectExcelAvailability } from "./excel/native-adapter";
import { inspectWordAvailability } from "./word/native-adapter";
export const inspectBuiltinPlugins = () => Promise.all([inspectExcelAvailability(), inspectWordAvailability()]);

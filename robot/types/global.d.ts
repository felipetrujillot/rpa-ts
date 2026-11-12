import type { RobotApi } from "../src/ipc";
export {};
declare global {
  interface Window {
    robot: RobotApi;
  }
}

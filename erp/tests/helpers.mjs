import vm from "node:vm";
import { serverSource, fakeSource } from "../dev/sources.mjs";

const SERVER = serverSource();
const FAKE = fakeSource();

/** Levanta el servidor del ERP sobre el simulador de Apps Script, ya instalado con `admin` como administrador. */
export function createServer({ admin = "admin@gsprime.cl", state } = {}) {
  const ctx = vm.createContext({});
  vm.runInContext(FAKE, ctx, { filename: "gas-fake.js" });
  const fake = vm.runInContext("createGasFake", ctx)({ user: admin, state });
  Object.assign(ctx, fake.globals);
  vm.runInContext(SERVER, ctx, { filename: "server.js" });
  vm.runInContext("instalar()", ctx);

  const server = {
    ctx,
    fake,
    as(email) { fake.setUser(email); return server; },
    /** Llama a la API como lo haría google.script.run (el resultado pasa por JSON). */
    call(action, payload) {
      return JSON.parse(JSON.stringify(vm.runInContext("api", ctx)(action, payload)));
    },
    /** Igual que call, pero falla si la respuesta no es ok. */
    ok(action, payload) {
      const res = server.call(action, payload);
      if (!res.ok) throw new Error(`${action} falló: ${res.error}`);
      return res;
    },
    run(code) { return vm.runInContext(code, ctx); },
    sheet(name) { return fake.state.sheets.find(s => s.name === name).values; },
  };
  return server;
}

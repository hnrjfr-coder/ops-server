import test from "node:test";
import assert from "node:assert/strict";
import { resolveEmployeeRegistrationAssignment, resolveRegistrationSupervisor } from "./auth.service.js";

test("registration resolves the selected funder to its sole active supervisor", () => {
  assert.equal(resolveRegistrationSupervisor([{ id: "supervisor-1" }]), "supervisor-1");
});

test("registration rejects a funder without an active supervisor", () => {
  assert.throws(
    () => resolveRegistrationSupervisor([]),
    { statusCode: 400, message: "The selected funder has no active supervisor and cannot be selected." },
  );
});

test("registration rejects a funder with multiple active supervisors", () => {
  assert.throws(
    () => resolveRegistrationSupervisor([{ id: "supervisor-1" }, { id: "supervisor-2" }]),
    { statusCode: 400, message: "The selected funder has multiple active supervisors. Contact an administrator to resolve the assignment." },
  );
});

test("manual-routing funder registration leaves supervisor assignment open", () => {
  assert.deepEqual(resolveEmployeeRegistrationAssignment({
    id: "funder-manual",
    manualSupervisorRouting: true,
  }, []), {
    managerId: null,
    funderId: "funder-manual",
    supervisor: null,
  });
});

test("standard funder registration assigns its sole active supervisor", () => {
  assert.deepEqual(resolveEmployeeRegistrationAssignment({
    id: "funder-standard",
    manualSupervisorRouting: false,
  }, [{ id: "supervisor-1" }]), {
    managerId: "supervisor-1",
    funderId: null,
    supervisor: "supervisor-1",
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { findUserByAuthIdentity } from "../lib/auth-profile.js";
import { resolveRegistrationSupervisor } from "./auth.service.js";

test("auth profile lookup falls back to the normalized email when the auth ID is mismatched", async () => {
  const profile = { id: "legacy-profile-id", email: "employee@example.com" };
  const lookups = [];
  const userRepository = {
    async findUnique({ where }) {
      lookups.push(where);
      return where.id ? null : profile;
    },
  };

  const result = await findUserByAuthIdentity({
    id: "supabase-auth-id",
    email: " Employee@Example.com ",
  }, userRepository);

  assert.equal(result, profile);
  assert.deepEqual(lookups, [
    { id: "supabase-auth-id" },
    { email: "employee@example.com" },
  ]);
});

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

test("employee registration must resolve to the funder's single active supervisor", () => {
  assert.equal(resolveRegistrationSupervisor([{ id: "supervisor-1" }]), "supervisor-1");
});

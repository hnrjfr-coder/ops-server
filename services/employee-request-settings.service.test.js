import assert from "node:assert/strict";
import test from "node:test";
import {
  FUNDING_REQUESTS_CLOSED_MESSAGE,
  getEmployeeRequestSettings,
  updateEmployeeRequestSettings,
} from "./employee-request-settings.service.js";

test("employee requests default to enabled until an administrator changes the setting", async () => {
  const database = {
    employeeRequestSetting: {
      async findUnique() {
        return null;
      },
    },
  };

  assert.deepEqual(await getEmployeeRequestSettings(database), {
    enabled: true,
    message: FUNDING_REQUESTS_CLOSED_MESSAGE,
  });
});

test("employee request settings can be read as disabled", async () => {
  const database = {
    employeeRequestSetting: {
      async findUnique() {
        return { enabled: false };
      },
    },
  };

  assert.deepEqual(await getEmployeeRequestSettings(database), {
    enabled: false,
    message: FUNDING_REQUESTS_CLOSED_MESSAGE,
  });
});

test("an administrator can open or close employee requests", async () => {
  const stored = { enabled: true };
  const database = {
    employeeRequestSetting: {
      async upsert({ update, create }) {
        stored.enabled = update.enabled ?? create.enabled;
        return { enabled: stored.enabled };
      },
    },
  };

  assert.equal((await updateEmployeeRequestSettings(false, database)).enabled, false);
  assert.equal((await updateEmployeeRequestSettings(true, database)).enabled, true);
});

test("employee request setting updates require a boolean", async () => {
  await assert.rejects(updateEmployeeRequestSettings("false", {}), {
    statusCode: 400,
    message: "enabled must be a boolean.",
  });
});

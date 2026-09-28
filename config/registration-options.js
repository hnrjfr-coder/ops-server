export const supervisors = [
  { value: "supervisor-1", label: "Supervisor One" },
  { value: "supervisor-2", label: "Supervisor Two" },
];

export const accountTypes = [
  { value: "EMPLOYEE", label: "Employee" },
  { value: "SUPERVISOR", label: "Supervisor" },
  { value: "ADMIN", label: "Admin" },
  { value: "INVESTOR", label: "Investor" },
];

export const isValidRegistrationOption = (options, value) => options.some((option) => option.value === value);

export const accountTypes = [
  { value: "EMPLOYEE", label: "Employee" },
  { value: "SUPERVISOR", label: "Supervisor" },
  { value: "ADMIN", label: "Admin" },
];

export const isValidRegistrationOption = (options, value) => options.some((option) => option.value === value);

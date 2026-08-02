const ADMIN_AUTH_STORAGE_KEY = "pts.admin.authenticated";

const configuredUsername = import.meta.env.VITE_ADMIN_USERNAME as string | undefined;
const configuredPassword = import.meta.env.VITE_ADMIN_PASSWORD as string | undefined;

export function isAdminAuthenticated(): boolean {
  return window.sessionStorage.getItem(ADMIN_AUTH_STORAGE_KEY) === "true";
}

export function loginAdmin(username: string, password: string): boolean {
  const isValid =
    Boolean(configuredUsername && configuredPassword) &&
    username === configuredUsername &&
    password === configuredPassword;

  if (isValid) {
    window.sessionStorage.setItem(ADMIN_AUTH_STORAGE_KEY, "true");
  }

  return isValid;
}

export function logoutAdmin(): void {
  window.sessionStorage.removeItem(ADMIN_AUTH_STORAGE_KEY);
}

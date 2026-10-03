export const writeCookie = (name: string, value: string) => {
  // biome-ignore lint/suspicious/noDocumentCookie: tests seed the cookie that useCookie reads at setup
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/`;
};

export const clearCookie = (name: string) => {
  // biome-ignore lint/suspicious/noDocumentCookie: tests seed the cookie that useCookie reads at setup
  document.cookie = `${name}=; max-age=0; path=/`;
};

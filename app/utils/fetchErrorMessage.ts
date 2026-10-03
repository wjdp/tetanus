interface FetchFailure {
  statusMessage?: string;
  data?: { message?: string; statusMessage?: string };
}

export function fetchErrorMessage(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { data, statusMessage } = error as FetchFailure;
  return data?.message ?? data?.statusMessage ?? statusMessage;
}

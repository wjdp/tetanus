interface FetchFailure {
  statusMessage?: string;
  data?: {
    message?: string;
    statusMessage?: string;
    data?: { name?: string; message?: string };
  };
}

function validationMessages(json: string): string | undefined {
  try {
    const issues: { message?: string }[] = JSON.parse(json);
    const messages = issues.map((issue) => issue.message).filter(Boolean);
    return messages.length ? messages.join("; ") : undefined;
  } catch {
    return undefined;
  }
}

export function fetchErrorMessage(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { data, statusMessage } = error as FetchFailure;
  if (data?.data?.name === "ZodError" && data.data.message) {
    const messages = validationMessages(data.data.message);
    if (messages) return messages;
  }
  return data?.message ?? data?.statusMessage ?? statusMessage;
}

export function isNetworkFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { response?: unknown }).response === undefined
  );
}

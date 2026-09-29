export function useCopyToClipboard() {
  const toast = useToast();

  return async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.add({ title: `${label} copied`, color: "success" });
    } catch {
      toast.add({
        title: `Could not copy the ${label.toLowerCase()}`,
        color: "error",
      });
    }
  };
}

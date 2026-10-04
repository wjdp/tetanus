import type { DiskPatch } from "#shared/schemas/disks";
import type { DiskDetail } from "./types";

export function useDiskFieldSave(
  diskId: MaybeRefOrGetter<number>,
  onUpdated: (disk: DiskDetail) => void,
) {
  const toast = useToast();
  const saving = reactive<Record<string, boolean>>({});
  const errors = reactive<Record<string, string | null>>({});

  const save = async (field: string, body: DiskPatch) => {
    saving[field] = true;
    errors[field] = null;
    try {
      onUpdated(
        await $fetch<DiskDetail>(`/api/disks/${toValue(diskId)}`, {
          method: "PATCH",
          body,
        }),
      );
    } catch (error) {
      errors[field] = fetchErrorMessage(error) ?? "Could not save";
      if (isNetworkFailure(error))
        toast.add({ title: "Could not reach the server", color: "error" });
    } finally {
      saving[field] = false;
    }
  };

  return { saving, errors, save };
}

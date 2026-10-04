import type { DiskPatch } from "#shared/schemas/disks";
import type { DiskDetail } from "./types";

export function useDiskFieldSave(
  diskId: MaybeRefOrGetter<number>,
  onUpdated: (disk: DiskDetail) => void,
) {
  const toast = useToast();
  const saving = reactive<Record<string, boolean>>({});
  const errors = reactive<Record<string, string | null>>({});

  const saveWith = async (
    field: string,
    request: () => Promise<DiskDetail>,
  ) => {
    saving[field] = true;
    errors[field] = null;
    try {
      onUpdated(await request());
    } catch (error) {
      errors[field] = fetchErrorMessage(error) ?? "Could not save";
      if (isNetworkFailure(error))
        toast.add({ title: "Could not reach the server", color: "error" });
    } finally {
      saving[field] = false;
    }
  };

  const save = (field: string, body: DiskPatch) =>
    saveWith(field, () =>
      $fetch<DiskDetail>(`/api/disks/${toValue(diskId)}`, {
        method: "PATCH",
        body,
      }),
    );

  return { saving, errors, save, saveWith };
}

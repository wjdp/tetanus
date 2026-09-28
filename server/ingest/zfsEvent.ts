// Shared event shape produced by both zpool-events (`zpool events -vH`) and zed-event
// (a single ZED zedlet POST). `eid` is normally present but OpenZFS 2.2 sometimes omits
// it on a paired resource event (e.g. resource.fs.zfs.removed alongside a statechange),
// so it is nullable here even though zed-event, which requires ZEVENT_EID, always sets it.
export interface ZfsEvent {
  eid: number | null;
  class: string;
  at: string;
  /** Original `Mon DD YYYY HH:MM:SS.nnnnnnnnn <class>` header line; zed-event has none. */
  header?: string;
  poolGuid: string | null;
  vdevGuid: string | null;
  pool: string | null;
  fields: Record<string, string | string[]>;
}

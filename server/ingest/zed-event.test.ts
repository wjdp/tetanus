import { describe, expect, it } from "vitest";
import { ParseError } from "./parseError";
import { parse } from "./zed-event";

// Modelled on the Q2 failure's resource.fs.zfs.statechange event, in the env-var form
// ZED's zedlets receive (see host/zed/all-tetanus.sh): one ZEVENT_* KEY=value per line,
// raw values, no quoting.
const STATECHANGE_BODY = [
  "ZEVENT_EID=515256",
  "ZEVENT_CLASS=resource.fs.zfs.statechange",
  "ZEVENT_SUBCLASS=statechange",
  "ZEVENT_POOL=tank",
  "ZEVENT_POOL_GUID=4620633283195517976",
  "ZEVENT_VDEV_GUID=9871058231490468853",
  "ZEVENT_VDEV_PATH=/dev/disk/by-vdev/Q2-part1",
  "ZEVENT_VDEV_STATE_STR=REMOVED",
  "ZEVENT_TIME_SECS=1747775470",
  "ZEVENT_TIME_NSECS=221924052",
  "ZEVENT_TIME_STRING=Tue May 20 23:11:10 2025",
].join("\n");

describe("zed-event parser", () => {
  it("maps ZEVENT_* env lines to the shared ZfsEvent shape", () => {
    const { data, summary } = parse(STATECHANGE_BODY, {});
    expect(data.event).toEqual({
      eid: 515256,
      class: "resource.fs.zfs.statechange",
      at: new Date(
        1747775470 * 1000 + Math.round(221924052 / 1e6),
      ).toISOString(),
      poolGuid: "4620633283195517976",
      vdevGuid: "9871058231490468853",
      pool: "tank",
      fields: {
        subclass: "statechange",
        vdev_path: "/dev/disk/by-vdev/Q2-part1",
        vdev_state_str: "REMOVED",
      },
    });
    expect(summary).toEqual({
      eid: 515256,
      class: "resource.fs.zfs.statechange",
    });
  });

  it("prefers TIME_SECS/TIME_NSECS over TIME_STRING when both are present", () => {
    const { data } = parse(STATECHANGE_BODY, {});
    expect(data.event.at).not.toBe(
      new Date("Tue May 20 23:11:10 2025").toISOString(),
    );
  });

  it("falls back to ZEVENT_TIME_STRING when there are no _SECS/_NSECS fields", () => {
    const body = [
      "ZEVENT_EID=1",
      "ZEVENT_CLASS=sysevent.fs.zfs.config_sync",
      "ZEVENT_TIME_STRING=Tue May 20 23:11:10 2025",
    ].join("\n");
    const { data } = parse(body, {});
    expect(data.event.at).toBe(
      new Date("Tue May 20 23:11:10 2025").toISOString(),
    );
  });

  it("accepts a 0x-prefixed guid as well as ZED's usual decimal form", () => {
    const body = [
      "ZEVENT_EID=1",
      "ZEVENT_CLASS=sysevent.fs.zfs.config_sync",
      "ZEVENT_TIME_SECS=1747775470",
      "ZEVENT_POOL_GUID=0x4020465f3c37b218",
    ].join("\n");
    const { data } = parse(body, {});
    expect(data.event.poolGuid).toBe(BigInt("0x4020465f3c37b218").toString());
  });

  it("ignores non-ZEVENT_ lines", () => {
    const body = [
      "SHELL=/bin/bash",
      "ZEVENT_EID=1",
      "ZEVENT_CLASS=sysevent.fs.zfs.config_sync",
      "ZEVENT_TIME_SECS=1747775470",
    ].join("\n");
    const { data } = parse(body, {});
    expect(Object.keys(data.event.fields)).toEqual([]);
  });

  it("throws ParseError for an empty body", () => {
    expect(() => parse("", {})).toThrow(ParseError);
  });

  it("throws ParseError when ZEVENT_EID is missing", () => {
    const body =
      "ZEVENT_CLASS=sysevent.fs.zfs.config_sync\nZEVENT_TIME_SECS=1\n";
    expect(() => parse(body, {})).toThrow(ParseError);
  });

  it("throws ParseError when ZEVENT_CLASS is missing", () => {
    const body = "ZEVENT_EID=1\nZEVENT_TIME_SECS=1\n";
    expect(() => parse(body, {})).toThrow(ParseError);
  });

  it("throws ParseError when there is no usable time", () => {
    const body = "ZEVENT_EID=1\nZEVENT_CLASS=sysevent.fs.zfs.config_sync\n";
    expect(() => parse(body, {})).toThrow(ParseError);
  });
});

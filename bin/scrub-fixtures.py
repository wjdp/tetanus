#!/usr/bin/env python3
"""Scrub disk identifiers from a raw fixture capture.

Usage: scrub-fixtures.py <raw-dir> <out-dir>

Replaces disk serials, WWNs / NAA / EUI ids and pool / vdev GUIDs with deterministic
fakes of the same length and character class, consistently across every file, so udev
data, by-id names, vdev_id.conf, zpool output and smartctl JSON still agree. WWNs (disk,
SAS expander and SAS port addresses) keep their NAA nibble and OUI (vendor) and fake the
vendor-specific id; EUI-64s keep their OUI. A serial that is really a WWN (SAS-attached disks
report one as ID_SERIAL_SHORT) is faked as a WWN so every spelling agrees.

Hostnames other than the public capture host are faked as whole tokens. Dataset names keep
their pool and fake every child component, wherever a pool-rooted path appears (dataset,
snapshot, property source, mountpoint, /dev/zvol). A dataset component equal to a hostname
shares the hostname's fake. Snapshot suffixes from sanoid / syncoid templates are kept (the
syncoid host is faked as a hostname); any other suffix is faked like a dataset component.
Labels of ZFS pools that are not imported (udev zfs_member ID_FS_LABEL) are faked as names.
Partition, partition table and non-ZFS filesystem UUIDs, LVM ids and ZFS partition labels
are faked in the same shape.

Fakes derive from sha256(salt + original); salt comes from TETANUS_SCRUB_SALT. The
original -> fake table goes to stderr only. The run fails if any original survives.
"""

import hashlib
import json
import os
import re
import shutil
import string
import sys
import tempfile
from pathlib import Path

DEFAULT_SALT = "diskbot-fixture-scrub-v1"  # historical; changing it changes every committed fake
SNAPSHOT_LIMIT = 200
UINT64_MAX = 2**64 - 1
MIN_SAFE_SERIAL_LENGTH = 4

HEX16 = re.compile(r"[0-9a-fA-F]{16}")
BARE_WWN = re.compile(r"3?(5[0-9a-f]{15})")
WWN_TOKEN_PREFIXES = ("exp0x", "0x", "3", "")
PREFIXED_WWN = re.compile(
    r"(?:wwn-0x|naa\.|scsi-3|sas-exp0x|sas-0x)(5[0-9a-fA-F]{15})(?![0-9A-Za-z])"
)
PREFIXED_EUI = re.compile(r"eui\.([0-9a-fA-F]{32}|[0-9a-fA-F]{16})(?![0-9A-Za-z])")
EVENT_GUID = re.compile(r"^\s*\w*guid = 0x([0-9a-fA-F]+)\s*$", re.MULTILINE)
UDEV_PROPERTY = re.compile(r"^E:([A-Z_]+)=(.*)$", re.MULTILINE)
UDEV_SERIAL_KEYS = ("ID_SERIAL_SHORT", "ID_SCSI_SERIAL", "SCSI_IDENT_SERIAL")
UDEV_WWN_KEYS = (
    "ID_WWN",
    "ID_WWN_WITH_EXTENSION",
    "SCSI_IDENT_LUN_NAA_REG",
    "SCSI_IDENT_PORT_NAA_REG",
)
SMARTCTL_EUI_STRING_KEYS = ("eui64", "nguid")
EUI64_EXT_ID_BITS = 40
ALNUM_RUN = re.compile(r"[0-9A-Za-z]+")
BY_ID_TOKEN = re.compile(
    r"(?<![0-9A-Za-z_.:+-])(ata-|scsi-[01S]ATA_|scsi-SSATA_|nvme-)([0-9A-Za-z_.:+-]+)"
)
NVME_NON_SERIAL_BODY = re.compile(r"(?:eui|nvme|uuid)\.")
PARTITION_SUFFIX = re.compile(r"-part\d+$")
NAMESPACE_ID = re.compile(r"\d{1,3}")
WD_PREFIX = "WD-"

PUBLIC_CAPTURE_HOSTNAME = "mars"
SNAPSHOT_COUNT_FILE = "zfs-snapshots.count"
SYNCOID_SNAPSHOT_HOST = re.compile(r"@syncoid_([0-9A-Za-z-]+)_\d{4}-\d\d-\d\d")
HISTORY_HOST = re.compile(r"\[(?:user \d+ \([^)]*\) )?on ([0-9A-Za-z.-]+)(?::\w+)?\]")
EVENT_HOSTNAME = re.compile(r'^\s*history_hostname = "([^"]*)"', re.MULTILINE)
LXD_INSTANCE_PARENTS = ("containers", "virtual-machines")
DATASET_COMPONENT = r"[0-9A-Za-z_](?:[0-9A-Za-z_.:-]*[0-9A-Za-z_])?"
DATASET_SEPARATORS = "-_.:"
TEMPLATE_SNAPSHOT_SUFFIX = re.compile(
    r"autosnap_\d{4}-\d\d-\d\d_\d\d:\d\d:\d\d_(?:frequently|hourly|daily|weekly|monthly|yearly)"
    r"|syncoid_[0-9A-Za-z-]+_\d{4}-\d\d-\d\d:\d\d:\d\d:\d\d-GMT-?\d\d:\d\d"
)
NAME_TOKEN_BEFORE = r"(?<![0-9A-Za-z_.:-])"
NAME_TOKEN_AFTER = r"(?![0-9A-Za-z_])"
LONG_HEX_COMPONENT = re.compile(r"[0-9a-f]{16,}")
NOT_MOUNTED = ("legacy", "none", "-")

HEX_UUID_SHAPES = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{4}-[0-9a-f]{4}|[0-9a-f]{32}|[0-9a-f]{16}"
)
CANONICAL_UUID_KEPT_NIBBLES = (14, 19)
LVM_ID = re.compile(r"[0-9A-Za-z]{32}")
LVM_DASHED_ID = re.compile(r"[0-9A-Za-z]{6}(?:-[0-9A-Za-z]{4}){5}-[0-9A-Za-z]{6}")
LVM_DASH_GROUPS = (6, 4, 4, 4, 4, 4, 6)
DM_UUID_LVM = re.compile(r"dm-uuid-LVM-([0-9A-Za-z]{32})([0-9A-Za-z]{32})")
LVM_PV_LINK = re.compile(rf"lvm-pv-uuid-({LVM_DASHED_ID.pattern})")
ZFS_PARTITION_LABEL = re.compile(r"(?<![0-9A-Za-z])zfs-([0-9a-f]{16})(?![0-9A-Za-z])")
UDEV_SYMLINK = re.compile(r"^S:(.*)$", re.MULTILINE)
UDEV_PARTITION_UUID_KEYS = ("ID_PART_ENTRY_UUID", "ID_PART_TABLE_UUID")
UDEV_FS_UUID_KEYS = ("ID_FS_UUID", "ID_FS_UUID_ENC", "ID_FS_UUID_SUB", "ID_FS_UUID_SUB_ENC")
LSBLK_PARTITION_UUID_KEYS = ("partuuid", "ptuuid")
LSBLK_FS_UUID_KEYS = ("uuid",)
ZFS_MEMBER = "zfs_member"
UDEV_FS_LABEL_KEYS = ("ID_FS_LABEL", "ID_FS_LABEL_ENC")


class Identifiers:
    def __init__(self):
        self.serials = set()
        self.wwns = set()
        self.euis = set()
        self.guids = set()
        self.hostnames = set()
        self.pools = set()
        self.dataset_names = set()
        self.dataset_components = set()
        self.mount_roots = set()
        self.snapshot_suffixes = set()
        self.unimported_pools = set()
        self.uuids = set()
        self.lvm_ids = set()

    def add_hostname(self, value):
        if isinstance(value, str) and value.strip():
            hostname = value.strip().lower()
            if hostname != PUBLIC_CAPTURE_HOSTNAME:
                self.hostnames.add(hostname)

    def add_dataset(self, name):
        pool, *children = name.split("/")
        if pool not in self.pools or not children:
            return
        self.dataset_names.add(name)
        self.dataset_components.update(children)
        for parent, child in zip(children, children[1:]):
            if parent in LXD_INSTANCE_PARENTS:
                self.add_hostname(child)

    def add_snapshot_suffix(self, suffix):
        if not TEMPLATE_SNAPSHOT_SUFFIX.fullmatch(suffix):
            self.snapshot_suffixes.add(suffix)

    def add_zfs_member_label(self, label):
        if isinstance(label, str) and label and label not in self.pools:
            self.unimported_pools.add(label)

    def add_uuid(self, value):
        """Partition / filesystem identifiers; ZFS GUIDs (decimal) are handled as GUIDs."""
        if not isinstance(value, str) or not value.strip() or value.strip().isdigit():
            return
        value = value.strip()
        if LVM_DASHED_ID.fullmatch(value):
            self.lvm_ids.add(value.replace("-", ""))
        elif HEX_UUID_SHAPES.fullmatch(value.lower()):
            self.uuids.add(value.lower())
        elif LVM_ID.fullmatch(value):
            self.lvm_ids.add(value)
        else:
            self.uuids.add(value)

    def add_serial(self, value):
        if isinstance(value, str) and value.strip():
            self.serials.add(value.strip())

    def add_wwn_or_eui(self, value):
        if not isinstance(value, str):
            return
        value = value.strip().lower()
        if value.startswith("eui."):
            eui = PREFIXED_EUI.match(value)
            if eui:
                self.euis.add(eui.group(1))
            return
        value = value.removeprefix("0x").removeprefix("naa.")
        if value.startswith("5") and HEX16.match(value):
            self.wwns.add(value[:16])

    def add_eui_string(self, value):
        if not isinstance(value, str):
            return
        value = value.strip().lower().removeprefix("eui.").removeprefix("0x")
        if re.fullmatch(r"[0-9a-f]{32}|[0-9a-f]{16}", value):
            self.euis.add(value)

    def reclassify_hex_serials_as_wwns(self):
        """SAS-attached disks report the WWN as their udev serial; fake it as a WWN everywhere."""
        for serial in list(self.serials):
            lower = serial.lower()
            wwn = BARE_WWN.fullmatch(lower)
            if wwn:
                self.wwns.add(wwn.group(1))
            if wwn or lower in self.wwns or lower in self.euis:
                self.serials.discard(serial)

    def add_guid(self, value):
        if isinstance(value, bool):
            return
        if isinstance(value, str) and value.isdigit():
            value = int(value)
        if isinstance(value, int) and 0 < value <= UINT64_MAX:
            self.guids.add(value)


def read_text(path):
    return path.read_bytes().decode("utf-8", "surrogateescape")


def write_text(path, text):
    path.write_bytes(text.encode("utf-8", "surrogateescape"))


def load_json(text):
    try:
        return json.loads(text)
    except ValueError:
        return None


def walk_json(node):
    if isinstance(node, dict):
        for key, value in node.items():
            yield key, value
            yield from walk_json(value)
    elif isinstance(node, list):
        for item in node:
            yield from walk_json(item)


def serial_from_model_serial(model_serial):
    """'<model>_<serial>[_<nvme namespace id>][-partN]' -> serial; the model may contain '_'."""
    segments = PARTITION_SUFFIX.sub("", model_serial).split("_")
    if len(segments) > 2 and NAMESPACE_ID.fullmatch(segments[-1]):
        segments.pop()
    if len(segments) < 2 or not segments[-1]:
        return None
    return segments[-1]


def by_id_serials(text):
    for match in BY_ID_TOKEN.finditer(text):
        prefix, body = match.groups()
        if prefix == "nvme-" and NVME_NON_SERIAL_BODY.match(body):
            continue
        serial = serial_from_model_serial(body.rstrip(".:+-"))
        if serial:
            yield serial


def serial_with_wd_variants(serial):
    """WD's SCSI serial is 'WD-' + the ATA serial; yield both so either spelling is faked."""
    yield serial
    if serial.startswith(WD_PREFIX) and len(serial) > len(WD_PREFIX):
        yield serial.removeprefix(WD_PREFIX)


def wwn_hex_from_smartctl(wwn):
    return f"{(wwn['naa'] << 60) | (wwn['oui'] << 36) | wwn['id']:016x}"


def is_structured_eui64(value):
    return isinstance(value, dict) and {"oui", "ext_id"} <= value.keys()


def eui_hex_from_smartctl(eui64):
    return f"{(eui64['oui'] << EUI64_EXT_ID_BITS) | eui64['ext_id']:016x}"


def smartctl_euis(data):
    for key, value in walk_json(data):
        if key == "eui64" and is_structured_eui64(value):
            yield value


def dataset_path_pattern(pools):
    """A pool-rooted path with at least one child, as a whole token or under a mount root."""
    alternatives = "|".join(map(re.escape, sorted(pools, key=len, reverse=True)))
    return re.compile(
        rf"(?<![0-9A-Za-z_.:-])(?:{alternatives})(?:/{DATASET_COMPONENT})+(?![0-9A-Za-z_])"
    )


def snapshot_pattern(pools):
    """<pool>[/<child>...]@<suffix>; group 1 is the suffix."""
    alternatives = "|".join(map(re.escape, sorted(pools, key=len, reverse=True)))
    return re.compile(
        rf"{NAME_TOKEN_BEFORE}(?:{alternatives})(?:/{DATASET_COMPONENT})*@({DATASET_COMPONENT}){NAME_TOKEN_AFTER}"
    )


def name_token_alternation(names):
    if not names:
        return None
    alternatives = "|".join(map(re.escape, sorted(names, key=len, reverse=True)))
    return re.compile(rf"{NAME_TOKEN_BEFORE}(?:{alternatives}){NAME_TOKEN_AFTER}")


def zfs_list_entries(data):
    datasets = data.get("datasets") if isinstance(data, dict) else None
    return datasets.values() if isinstance(datasets, dict) else ()


def mountpoint_of(entry):
    return entry.get("properties", {}).get("mountpoint", {}).get("value")


def discover_pools(files):
    pools = set()
    for name in ("zpool-list.json", "zpool-status.json"):
        data = load_json(files.get(Path(name), ""))
        if isinstance(data, dict) and isinstance(data.get("pools"), dict):
            pools.update(data["pools"])
    for name in ("zfs-list.json", "zfs-snapshots.json"):
        for entry in zfs_list_entries(load_json(files.get(Path(name), ""))):
            if isinstance(entry.get("pool"), str):
                pools.add(entry["pool"])
    return pools


def discover_mount_roots(data):
    """Mount root R such that mountpoint == R + dataset name, e.g. '/vol/'."""
    roots = set()
    for entry in zfs_list_entries(data):
        name, mountpoint = entry.get("name"), mountpoint_of(entry)
        if isinstance(mountpoint, str) and mountpoint.endswith("/" + name):
            roots.add(mountpoint[: -len(name)])
    return roots


def discover_hostnames(found, name, text):
    for pattern in (SYNCOID_SNAPSHOT_HOST, HISTORY_HOST, EVENT_HOSTNAME):
        for match in pattern.finditer(text):
            found.add_hostname(match.group(1))
    if name == "uname.txt":
        fields = text.split()
        if len(fields) > 1:
            found.add_hostname(fields[1])


def lsblk_devices(nodes):
    for node in nodes if isinstance(nodes, list) else ():
        if isinstance(node, dict):
            yield node
            yield from lsblk_devices(node.get("children"))


def discover_uuids(found, name, text, data):
    if name == "lsblk.json" and isinstance(data, dict):
        for device in lsblk_devices(data.get("blockdevices")):
            for key in LSBLK_PARTITION_UUID_KEYS:
                found.add_uuid(device.get(key))
            if device.get("fstype") != ZFS_MEMBER:
                for key in LSBLK_FS_UUID_KEYS:
                    found.add_uuid(device.get(key))
            label = ZFS_PARTITION_LABEL.fullmatch(device.get("partlabel") or "")
            if label:
                found.add_uuid(label.group(1))

    if name.startswith("udev/"):
        properties = dict(UDEV_PROPERTY.findall(text))
        is_zfs_member = properties.get("ID_FS_TYPE") == ZFS_MEMBER
        for key in UDEV_PARTITION_UUID_KEYS:
            found.add_uuid(properties.get(key))
        if not is_zfs_member:
            for key in UDEV_FS_UUID_KEYS:
                found.add_uuid(properties.get(key))
        for link in UDEV_SYMLINK.findall(text):
            kind, _, value = link.rpartition("/")
            if kind.endswith("by-partuuid") or (kind.endswith("by-uuid") and not is_zfs_member):
                found.add_uuid(value)

    for match in ZFS_PARTITION_LABEL.finditer(text):
        found.add_uuid(match.group(1))
    for match in DM_UUID_LVM.finditer(text):
        found.lvm_ids.update(match.groups())
    for match in LVM_PV_LINK.finditer(text):
        found.add_uuid(match.group(1))


def discover(files):
    found = Identifiers()
    found.pools = discover_pools(files)
    found.mount_roots = discover_mount_roots(load_json(files.get(Path("zfs-list.json"), "")))
    dataset_path = dataset_path_pattern(found.pools) if found.pools else None
    snapshot = snapshot_pattern(found.pools) if found.pools else None
    for relative, text in files.items():
        name = relative.as_posix()
        data = load_json(text) if name.endswith(".json") else None

        if name == "lsblk.json" and data:
            for key, value in walk_json(data):
                if key == "serial":
                    found.add_serial(value)
                elif key == "wwn":
                    found.add_wwn_or_eui(value)

        if name.startswith("smartctl/") and data:
            found.add_serial(data.get("serial_number"))
            found.add_wwn_or_eui(data.get("logical_unit_id"))
            wwn = data.get("wwn")
            if isinstance(wwn, dict) and {"naa", "oui", "id"} <= wwn.keys():
                found.add_wwn_or_eui(wwn_hex_from_smartctl(wwn))
            for eui64 in smartctl_euis(data):
                found.euis.add(eui_hex_from_smartctl(eui64))
            for key, value in walk_json(data):
                if key in SMARTCTL_EUI_STRING_KEYS:
                    found.add_eui_string(value)

        if name.startswith("zpool-") and data:
            for key, value in walk_json(data):
                if key == "guid" or key.endswith("_guid"):
                    found.add_guid(value)

        if name == "zpool-events.txt":
            for match in EVENT_GUID.finditer(text):
                found.add_guid(int(match.group(1), 16))

        if name.startswith("udev/"):
            properties = dict(UDEV_PROPERTY.findall(text))
            for key in UDEV_SERIAL_KEYS:
                found.add_serial(properties.get(key))
            udev_serial = serial_from_model_serial(properties.get("ID_SERIAL", ""))
            if udev_serial:
                for variant in serial_with_wd_variants(udev_serial):
                    found.add_serial(variant)
            for key in UDEV_WWN_KEYS:
                found.add_wwn_or_eui(properties.get(key))
            if properties.get("ID_FS_TYPE") == ZFS_MEMBER:
                found.add_guid(properties.get("ID_FS_UUID"))
                found.add_guid(properties.get("ID_FS_UUID_SUB"))
                for key in UDEV_FS_LABEL_KEYS:
                    found.add_zfs_member_label(properties.get(key))

        for serial in by_id_serials(text):
            for variant in serial_with_wd_variants(serial):
                found.add_serial(variant)
        for match in PREFIXED_WWN.finditer(text):
            found.add_wwn_or_eui(match.group(1))
        for match in PREFIXED_EUI.finditer(text):
            found.euis.add(match.group(1).lower())

        discover_hostnames(found, name, text)
        discover_uuids(found, name, text, data)
        if dataset_path:
            for match in dataset_path.finditer(text):
                found.add_dataset(match.group(0).lstrip("/"))
            for match in snapshot.finditer(text):
                found.add_snapshot_suffix(match.group(1))

    found.reclassify_hex_serials_as_wwns()
    found.serials = drop_serials_covered_by_shorter(found.serials)
    return found


def contains_with_boundaries(haystack, needle):
    pattern = rf"(?<![0-9A-Za-z]){re.escape(needle)}(?![0-9A-Za-z])"
    return re.search(pattern, haystack) is not None


def drop_serials_covered_by_shorter(serials):
    """WD's SCSI serial is 'WD-' + the ATA serial; faking the ATA serial covers both."""
    return {
        serial
        for serial in serials
        if not any(
            other != serial and contains_with_boundaries(serial, other) for other in serials
        )
    }


def hash_stream(salt, kind, original, attempt):
    seed = f"{salt}\0{kind}\0{attempt}\0{original}".encode()
    block = 0
    while True:
        yield from hashlib.sha256(seed + block.to_bytes(4, "big")).digest()
        block += 1


def fake_serial(original, salt, attempt):
    stream = hash_stream(salt, "serial", original, attempt)
    characters = []
    for character in original:
        if character in string.digits:
            characters.append(string.digits[next(stream) % 10])
        elif character in string.ascii_uppercase:
            characters.append(string.ascii_uppercase[next(stream) % 26])
        elif character in string.ascii_lowercase:
            characters.append(string.ascii_lowercase[next(stream) % 26])
        else:
            characters.append(character)
    return "".join(characters)


def fake_hex(original, kept_prefix_length, salt, kind, attempt):
    stream = hash_stream(salt, kind, original, attempt)
    faked_length = len(original) - kept_prefix_length
    tail = "".join("0123456789abcdef"[next(stream) % 16] for _ in range(faked_length))
    return original[:kept_prefix_length] + tail


def fake_guid(original, salt, attempt):
    digits = len(str(original))
    low = 10 ** (digits - 1)
    high = min(10**digits - 1, UINT64_MAX)
    stream = hash_stream(salt, "guid", original, attempt)
    number = int.from_bytes(bytes(next(stream) for _ in range(16)), "big")
    return low + number % (high - low + 1)


def fake_name(original, salt, kind, attempt):
    """Same length, lowercase letters/digits starting with a letter, separators kept."""
    stream = hash_stream(salt, kind, original, attempt)
    alphabet = string.ascii_lowercase + string.digits
    characters = []
    for character in original:
        if character in DATASET_SEPARATORS:
            characters.append(character)
        elif any(c.isalnum() for c in characters):
            characters.append(alphabet[next(stream) % len(alphabet)])
        else:
            characters.append(string.ascii_lowercase[next(stream) % 26])
    return "".join(characters)


def fake_hostname(original, salt, attempt):
    return fake_name(original, salt, "hostname", attempt)


def fake_dataset_component(original, salt, attempt):
    if LONG_HEX_COMPONENT.fullmatch(original):
        return fake_hex(original, 0, salt, "dataset", attempt)
    return fake_name(original, salt, "dataset", attempt)


def fake_uuid(original, salt, attempt):
    """Hex digits faked in place (canonical UUID keeps version and variant); other shapes by class."""
    if not HEX_UUID_SHAPES.fullmatch(original):
        return fake_serial(original, salt, attempt)
    stream = hash_stream(salt, "uuid", original, attempt)
    kept = CANONICAL_UUID_KEPT_NIBBLES if len(original) == 36 else ()
    return "".join(
        character
        if character not in string.hexdigits or index in kept
        else "0123456789abcdef"[next(stream) % 16]
        for index, character in enumerate(original)
    )


def dash_lvm_id(lvm_id):
    groups, start = [], 0
    for length in LVM_DASH_GROUPS:
        groups.append(lvm_id[start : start + length])
        start += length
    return "-".join(groups)


def build_mapping(originals, make_fake, salt, reserved=(), shared=None):
    """An original also present in `shared` reuses that fake, so the link between them survives."""
    reused = {o: f for o, f in (shared or {}).items() if o in originals}
    taken = set(originals) | set(reserved) | set(reused.values())
    mapping = {}
    for original in sorted(originals, key=str):
        if original in reused:
            mapping[original] = reused[original]
            continue
        attempt = 0
        while (fake := make_fake(original, salt, attempt)) in taken:
            attempt += 1
        taken.add(fake)
        mapping[original] = fake
    return mapping


def bounded_alternation(strings, flags=0):
    if not strings:
        return None
    alternatives = "|".join(map(re.escape, sorted(strings, key=len, reverse=True)))
    return re.compile(rf"(?<![0-9A-Za-z])(?:{alternatives})(?![0-9A-Za-z])", flags)


def uuid_spellings(uuids, lvm_ids):
    spellings = {}
    for original, fake in uuids.items():
        spellings[original] = fake
        spellings[original.upper()] = fake.upper()
    for original, fake in lvm_ids.items():
        spellings[original] = fake
        spellings[dash_lvm_id(original)] = dash_lvm_id(fake)
    return spellings


class Scrubber:
    def __init__(self, identifiers, salt):
        short = sorted(s for s in identifiers.serials if len(s) < MIN_SAFE_SERIAL_LENGTH)
        if short:
            print(f"scrub: warning, short serials faked anyway: {short}", file=sys.stderr)
        self.serials = build_mapping(identifiers.serials, fake_serial, salt)
        self.wwns = build_mapping(
            identifiers.wwns, lambda o, s, a: fake_hex(o, 7, s, "wwn", a), salt
        )
        self.euis = build_mapping(
            identifiers.euis,
            lambda o, s, a: fake_hex(o, 6 if len(o) == 16 else 0, s, "eui", a),
            salt,
        )
        self.guids = build_mapping(identifiers.guids, fake_guid, salt)
        reserved_names = (
            identifiers.pools
            | identifiers.hostnames
            | identifiers.dataset_components
            | identifiers.snapshot_suffixes
            | identifiers.unimported_pools
            | {PUBLIC_CAPTURE_HOSTNAME}
        )
        self.hostnames = build_mapping(identifiers.hostnames, fake_hostname, salt, reserved_names)
        self.dataset_components = build_mapping(
            identifiers.dataset_components,
            fake_dataset_component,
            salt,
            reserved_names | set(self.hostnames.values()),
            shared=self.hostnames,
        )
        self.snapshot_suffixes = build_mapping(
            identifiers.snapshot_suffixes,
            fake_dataset_component,
            salt,
            reserved_names | set(self.hostnames.values()),
            shared={**self.hostnames, **self.dataset_components},
        )
        self.unimported_pools = build_mapping(
            identifiers.unimported_pools,
            lambda o, s, a: fake_name(o, s, "pool", a),
            salt,
            reserved_names
            | set(self.hostnames.values())
            | set(self.dataset_components.values())
            | set(self.snapshot_suffixes.values()),
        )
        self.uuids = build_mapping(identifiers.uuids, fake_uuid, salt)
        self.lvm_ids = build_mapping(identifiers.lvm_ids, fake_serial, salt)
        self.dataset_path = (
            dataset_path_pattern(identifiers.pools) if identifiers.pools else None
        )
        self.hostname_token = bounded_alternation(self.hostnames, re.IGNORECASE)
        self.snapshot_suffix_token = name_token_alternation(self.snapshot_suffixes)
        self.unimported_pool_token = name_token_alternation(self.unimported_pools)
        self.uuid_spellings = uuid_spellings(self.uuids, self.lvm_ids)
        self.uuid_token = bounded_alternation(self.uuid_spellings)
        self.hex_tokens = {**self.wwns, **self.euis}
        self.hex_guids = {f"{o:x}": f"{f:x}" for o, f in self.guids.items()}
        self.decimal_guids = {str(o): str(f) for o, f in self.guids.items()}
        self.alnum_serials = {s: f for s, f in self.serials.items() if s.isalnum()}
        punctuated = sorted((s for s in self.serials if not s.isalnum()), key=len, reverse=True)
        self.punctuated_serials = (
            re.compile(
                r"(?<![0-9A-Za-z])(?:"
                + "|".join(map(re.escape, punctuated))
                + r")(?![0-9A-Za-z])"
            )
            if punctuated
            else None
        )

    def print_mapping(self):
        rows = [
            ("serial", self.serials),
            ("wwn", self.wwns),
            ("eui", self.euis),
            ("guid", self.guids),
            ("host", self.hostnames),
            ("dsname", self.dataset_components),
            ("snap", self.snapshot_suffixes),
            ("pool", self.unimported_pools),
            ("uuid", self.uuids),
            ("lvm-id", self.lvm_ids),
        ]
        for kind, mapping in rows:
            for original, fake in mapping.items():
                print(f"scrub: {kind:6} {original} -> {fake}", file=sys.stderr)
        for original, fake in self.hex_guids.items():
            print(f"scrub: {'guid':6} 0x{original} -> 0x{fake}", file=sys.stderr)

    def replace_token(self, match):
        token = match.group(0)
        if token in self.alnum_serials:
            return self.alnum_serials[token]
        if token in self.decimal_guids:
            return self.decimal_guids[token]
        lower = token.lower()
        for prefix in WWN_TOKEN_PREFIXES:
            if not lower.startswith(prefix):
                continue
            body = lower[len(prefix) :]
            fake = self.hex_tokens.get(body)
            if fake is None and prefix == "0x":
                fake = self.hex_guids.get(body)
            if fake is not None:
                original_body = token[len(prefix) :]
                if any(c in "ABCDEF" for c in original_body):
                    fake = fake.upper()
                return token[: len(prefix)] + fake
        return token

    def fake_dataset_path(self, match):
        pool, *children = match.group(0).split("/")
        return "/".join([pool, *(self.dataset_components.get(c, c) for c in children)])

    def fake_dm_uuid(self, match):
        volume_group, logical_volume = match.groups()
        return (
            "dm-uuid-LVM-"
            + self.lvm_ids.get(volume_group, volume_group)
            + self.lvm_ids.get(logical_volume, logical_volume)
        )

    def scrub_text(self, text):
        text = DM_UUID_LVM.sub(self.fake_dm_uuid, text)
        if self.uuid_token:
            text = self.uuid_token.sub(lambda m: self.uuid_spellings.get(m.group(0), m.group(0)), text)
        if self.dataset_path:
            text = self.dataset_path.sub(self.fake_dataset_path, text)
        if self.snapshot_suffix_token:
            text = self.snapshot_suffix_token.sub(lambda m: self.snapshot_suffixes[m.group(0)], text)
        if self.unimported_pool_token:
            text = self.unimported_pool_token.sub(lambda m: self.unimported_pools[m.group(0)], text)
        if self.hostname_token:
            text = self.hostname_token.sub(lambda m: self.hostnames[m.group(0).lower()], text)
        if self.punctuated_serials:
            text = self.punctuated_serials.sub(lambda m: self.serials[m.group(0)], text)
        return ALNUM_RUN.sub(self.replace_token, text)

    def scrub_smartctl_wwn(self, data):
        wwn = data.get("wwn")
        if not (isinstance(wwn, dict) and {"naa", "oui", "id"} <= wwn.keys()):
            return False
        fake = self.wwns.get(wwn_hex_from_smartctl(wwn))
        if fake is None:
            return False
        wwn["id"] = int(fake, 16) & (2**36 - 1)
        return True

    def scrub_smartctl_euis(self, data):
        changed = False
        for eui64 in smartctl_euis(data):
            fake = self.euis.get(eui_hex_from_smartctl(eui64))
            if fake is not None:
                eui64["ext_id"] = int(fake, 16) & (2**EUI64_EXT_ID_BITS - 1)
                changed = True
        return changed


def truncate_snapshots(data):
    datasets = data.get("datasets")
    if not isinstance(datasets, dict):
        return None
    data["datasets"] = dict(list(datasets.items())[:SNAPSHOT_LIMIT])
    return len(datasets)


def restructure(relative, text, scrubber, out_root, snapshot_count_recorded):
    name = relative.as_posix()
    if not name.endswith(".json"):
        return text
    data = load_json(text)
    if data is None:
        return text
    changed = False
    if name.startswith("smartctl/"):
        changed = scrubber.scrub_smartctl_wwn(data)
        changed = scrubber.scrub_smartctl_euis(data) or changed
    if name == "zfs-snapshots.json":
        count = truncate_snapshots(data)
        if count is not None:
            if not snapshot_count_recorded:
                write_text(out_root / SNAPSHOT_COUNT_FILE, f"{count}\n")
            changed = True
    if not changed:
        return text
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def leak_needles(identifiers):
    needles = []
    for serial in identifiers.serials:
        needles.append((f"serial {serial}", serial, len(serial) < MIN_SAFE_SERIAL_LENGTH, False))
    for wwn in identifiers.wwns:
        needles.append((f"wwn {wwn}", wwn, False, True))
        needles.append((f"wwn-id {wwn}", str(int(wwn[7:], 16)), True, False))
    for eui in identifiers.euis:
        needles.append((f"eui {eui}", eui, False, True))
        if len(eui) == 16:
            needles.append((f"eui-ext-id {eui}", str(int(eui[6:], 16)), True, False))
    for guid in identifiers.guids:
        needles.append((f"guid {guid}", str(guid), False, False))
        needles.append((f"guid 0x{guid:x}", f"0x{guid:x}", True, True))
    for hostname in identifiers.hostnames:
        needles.append((f"hostname {hostname}", hostname, True, True))
    for dataset in identifiers.dataset_names:
        needles.append((f"dataset {dataset}", dataset, True, False))
    for suffix in identifiers.snapshot_suffixes:
        needles.append((f"snapshot suffix {suffix}", suffix, True, True))
    for pool in identifiers.unimported_pools:
        needles.append((f"unimported pool {pool}", pool, True, True))
    for uuid in identifiers.uuids:
        needles.append((f"uuid {uuid}", uuid, True, True))
    for lvm_id in identifiers.lvm_ids:
        needles.append((f"lvm-id {lvm_id}", lvm_id, False, False))
        needles.append((f"lvm-id {dash_lvm_id(lvm_id)}", dash_lvm_id(lvm_id), True, False))
    return needles


def find_leaks(root, identifiers):
    patterns = []
    for label, needle, bounded, ignore_case in leak_needles(identifiers):
        pattern = re.escape(needle)
        if bounded:
            pattern = rf"(?<![0-9A-Za-z]){pattern}(?![0-9A-Za-z])"
        patterns.append((label, re.compile(pattern, re.IGNORECASE if ignore_case else 0)))
    leaks = []
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        text = read_text(path)
        for label, pattern in patterns:
            if pattern.search(text):
                leaks.append(f"{path.relative_to(root)}: {label}")
    return leaks


def unfaked_by_id_serials(root, fake_serials):
    """Structural check: every by-id style serial in the output must be a fake, discovered or not."""
    problems = []
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        for serial in sorted(set(by_id_serials(read_text(path)))):
            if not any(variant in fake_serials for variant in serial_with_wd_variants(serial)):
                problems.append(f"{path.relative_to(root)}: unfaked by-id serial {serial}")
    return problems


def unfaked_prefixed_wwns(root, fake_wwns):
    """Structural check: every prefixed WWN (by-id, by-path, expander) in the output must be a fake."""
    problems = []
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        for match in sorted(set(PREFIXED_WWN.findall(read_text(path)))):
            if match.lower() not in fake_wwns:
                problems.append(f"{path.relative_to(root)}: unfaked prefixed WWN {match}")
    return problems


def unfaked_dataset_components(root, pools, fake_components):
    """Structural check: every child component of every pool-rooted path in the output is a fake."""
    if not pools:
        return []
    dataset_path = dataset_path_pattern(pools)
    problems = []
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        components = {
            component
            for match in dataset_path.finditer(read_text(path))
            for component in match.group(0).split("/")[1:]
        }
        for component in sorted(components - fake_components):
            problems.append(f"{path.relative_to(root)}: unfaked dataset component {component}")
    return problems


def unfaked_snapshot_suffixes(root, pools, fake_suffixes):
    """Structural check: every snapshot suffix in the output is a sanoid / syncoid template or a fake."""
    if not pools:
        return []
    snapshot = snapshot_pattern(pools)
    problems = []
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        suffixes = {match.group(1) for match in snapshot.finditer(read_text(path))}
        for suffix in sorted(suffixes - fake_suffixes):
            if not TEMPLATE_SNAPSHOT_SUFFIX.fullmatch(suffix):
                problems.append(f"{path.relative_to(root)}: unfaked snapshot suffix {suffix}")
    return problems


def unfaked_zfs_member_labels(root, pools, fake_pools):
    """Structural check: every udev zfs_member label in the output is an imported pool or a fake."""
    problems = []
    for path in sorted(root.glob("udev/**/*")):
        if not path.is_file():
            continue
        properties = dict(UDEV_PROPERTY.findall(read_text(path)))
        if properties.get("ID_FS_TYPE") != ZFS_MEMBER:
            continue
        for key in UDEV_FS_LABEL_KEYS:
            label = properties.get(key)
            if label and label not in pools and label not in fake_pools:
                problems.append(f"{path.relative_to(root)}: unfaked {key} {label}")
    return problems


def unmirrored_mountpoints(root, mount_roots):
    """Every mounted dataset must sit at <mount root><name>; anything else would leak a path."""
    path = root / "zfs-list.json"
    data = load_json(read_text(path)) if path.is_file() else None
    problems = []
    for entry in zfs_list_entries(data):
        name, mountpoint = entry.get("name"), mountpoint_of(entry)
        if not isinstance(mountpoint, str) or mountpoint in NOT_MOUNTED:
            continue
        if not any(mountpoint == mount_root + name for mount_root in mount_roots):
            problems.append(f"zfs-list.json: mountpoint {mountpoint} does not mirror {name}")
    return problems


def invalid_json_files(raw_files, root):
    return [
        relative.as_posix()
        for relative, text in raw_files.items()
        if relative.suffix == ".json"
        and load_json(text) is not None
        and load_json(read_text(root / relative)) is None
    ]


def prepare_out_dir(out_dir):
    if out_dir.exists() and any(out_dir.iterdir()):
        sys.exit(f"scrub: {out_dir} is not empty; remove it first")
    out_dir.parent.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix=f"{out_dir.name}.partial.", dir=out_dir.parent))


def publish(partial, out_dir):
    for path in partial.rglob("*"):
        path.chmod(0o755 if path.is_dir() else 0o644)
    partial.chmod(0o755)
    if out_dir.exists():
        out_dir.rmdir()
    partial.rename(out_dir)


def main(argv):
    if len(argv) != 3:
        sys.exit("usage: scrub-fixtures.py <raw-dir> <out-dir>")
    raw_dir, out_dir = Path(argv[1]), Path(argv[2])
    if not raw_dir.is_dir():
        sys.exit(f"scrub: {raw_dir} is not a directory")

    raw_files = {
        path.relative_to(raw_dir): read_text(path)
        for path in sorted(raw_dir.rglob("*"))
        if path.is_file()
    }
    identifiers = discover(raw_files)
    scrubber = Scrubber(identifiers, os.environ.get("TETANUS_SCRUB_SALT", DEFAULT_SALT))
    scrubber.print_mapping()

    snapshot_count_recorded = Path(SNAPSHOT_COUNT_FILE) in raw_files
    partial = prepare_out_dir(out_dir)
    try:
        for relative, text in raw_files.items():
            target = partial / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            restructured = restructure(
                relative, text, scrubber, partial, snapshot_count_recorded
            )
            write_text(target, scrubber.scrub_text(restructured))

        problems = find_leaks(partial, identifiers)
        problems += unfaked_by_id_serials(partial, set(scrubber.serials.values()))
        problems += unfaked_prefixed_wwns(partial, set(scrubber.wwns.values()))
        problems += unfaked_dataset_components(
            partial, identifiers.pools, set(scrubber.dataset_components.values())
        )
        problems += unfaked_snapshot_suffixes(
            partial, identifiers.pools, set(scrubber.snapshot_suffixes.values())
        )
        problems += unfaked_zfs_member_labels(
            partial, identifiers.pools, set(scrubber.unimported_pools.values())
        )
        problems += unmirrored_mountpoints(partial, identifiers.mount_roots)
        problems += [f"{name}: invalid JSON after scrub" for name in invalid_json_files(raw_files, partial)]
        if problems:
            print("scrub: FAILED, originals or broken JSON remain:", file=sys.stderr)
            for problem in problems:
                print(f"scrub:   {problem}", file=sys.stderr)
            shutil.rmtree(partial)
            return 1
        publish(partial, out_dir)
    except BaseException:
        shutil.rmtree(partial, ignore_errors=True)
        raise

    counts = (
        f"{len(identifiers.serials)} serials, {len(identifiers.wwns)} WWNs, "
        f"{len(identifiers.euis)} EUIs, {len(identifiers.guids)} GUIDs, "
        f"{len(identifiers.hostnames)} hostnames, "
        f"{len(identifiers.dataset_components)} dataset components, "
        f"{len(identifiers.snapshot_suffixes)} snapshot suffixes, "
        f"{len(identifiers.unimported_pools)} unimported pools, "
        f"{len(identifiers.uuids) + len(identifiers.lvm_ids)} UUIDs"
    )
    print(f"scrub: ok, {counts}, {len(raw_files)} files -> {out_dir}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

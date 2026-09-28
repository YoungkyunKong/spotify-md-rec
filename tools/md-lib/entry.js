// Browser entry for the MiniDisc transfer feature. Only the read/download APIs are exported.
export { openNewDevice, openPairedDevice, listContent, getTracks, upload, DevicesIds, DiscFormat, Encoding } from "netmd-js";
export { HiMD, FSAHiMDFilesystem, getAllTracks, dumpTrack } from "himd-js";

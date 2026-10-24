import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createInflateRaw } from "node:zlib";
import type { Readable } from "node:stream";

export interface ZipEntryInfo {
    name: string;
    compressionMethod: number;
    compressedSize: number;
    uncompressedSize: number;
    localHeaderOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CD_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export async function readZipDirectory(
    zipPath: string
): Promise<Map<string, ZipEntryInfo>> {
    const fh = await open(zipPath, "r");
    try {
        const stat = await fh.stat();
        const fileSize = stat.size;
        const tailLen = Math.min(fileSize, 65557);
        const tailBuf = Buffer.allocUnsafe(tailLen);
        await fh.read(tailBuf, 0, tailLen, fileSize - tailLen);

        let eocdOffset = -1;
        for (let i = tailLen - 22; i >= 0; i--) {
            if (tailBuf.readUInt32LE(i) === EOCD_SIGNATURE) {
                eocdOffset = i;
                break;
            }
        }
        if (eocdOffset === -1) {
            throw new Error("Invalid ZIP archive: EOCD not found");
        }

        const totalEntries = tailBuf.readUInt16LE(eocdOffset + 10);
        const cdSize = tailBuf.readUInt32LE(eocdOffset + 12);
        const cdOffset = tailBuf.readUInt32LE(eocdOffset + 16);

        const cdBuf = Buffer.allocUnsafe(cdSize);
        await fh.read(cdBuf, 0, cdSize, cdOffset);

        const entries = new Map<string, ZipEntryInfo>();
        let pos = 0;
        for (let idx = 0; idx < totalEntries && pos + 46 <= cdSize; idx++) {
            if (cdBuf.readUInt32LE(pos) !== CD_SIGNATURE) {
                throw new Error("Invalid ZIP Central Directory signature");
            }
            const compressionMethod = cdBuf.readUInt16LE(pos + 10);
            const compressedSize = cdBuf.readUInt32LE(pos + 20);
            const uncompressedSize = cdBuf.readUInt32LE(pos + 24);
            const nameLen = cdBuf.readUInt16LE(pos + 28);
            const extraLen = cdBuf.readUInt16LE(pos + 30);
            const commentLen = cdBuf.readUInt16LE(pos + 32);
            const localHeaderOffset = cdBuf.readUInt32LE(pos + 42);
            const name = cdBuf
                .subarray(pos + 46, pos + 46 + nameLen)
                .toString("utf8");

            entries.set(name, {
                name,
                compressionMethod,
                compressedSize,
                uncompressedSize,
                localHeaderOffset,
            });
            pos += 46 + nameLen + extraLen + commentLen;
        }

        return entries;
    } finally {
        await fh.close();
    }
}

export async function openZipEntryStream(
    zipPath: string,
    entry: ZipEntryInfo
): Promise<Readable> {
    const fh = await open(zipPath, "r");
    let dataOffset = 0;
    try {
        const localHeader = Buffer.allocUnsafe(30);
        await fh.read(localHeader, 0, 30, entry.localHeaderOffset);
        if (localHeader.readUInt32LE(0) !== LOCAL_SIGNATURE) {
            throw new Error(`Invalid local header for ${entry.name}`);
        }
        const nameLen = localHeader.readUInt16LE(26);
        const extraLen = localHeader.readUInt16LE(28);
        dataOffset = entry.localHeaderOffset + 30 + nameLen + extraLen;
    } finally {
        await fh.close();
    }

    if (entry.compressedSize === 0) {
        const { Readable: NodeReadable } = await import("node:stream");
        return NodeReadable.from([]);
    }

    const rawStream = createReadStream(zipPath, {
        start: dataOffset,
        end: dataOffset + entry.compressedSize - 1,
        highWaterMark: 256 * 1024,
    });

    if (entry.compressionMethod === 0) {
        return rawStream;
    }
    if (entry.compressionMethod === 8) {
        const inflate = createInflateRaw({ chunkSize: 256 * 1024 });
        rawStream.on("error", (err) => inflate.destroy(err));
        return rawStream.pipe(inflate);
    }
    rawStream.destroy();
    throw new Error(
        `Unsupported ZIP compression method ${entry.compressionMethod} for ${entry.name}`
    );
}

export function parseCsvLine(line: string): string[] {
    if (!line.includes('"')) {
        return line.split(",");
    }
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    const len = line.length;
    for (let i = 0; i < len; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (i + 1 < len && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                current += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ",") {
            result.push(current);
            current = "";
        } else {
            current += ch;
        }
    }
    result.push(current);
    return result;
}

export async function streamZipCsv(
    zipPath: string,
    entries: Map<string, ZipEntryInfo>,
    entryName: string,
    onRow: (cols: string[], headerMap: Map<string, number>) => void
): Promise<void> {
    const entry = entries.get(entryName);
    if (!entry) return;

    const stream = await openZipEntryStream(zipPath, entry);
    const rl = createInterface({
        input: stream,
        crlfDelay: Infinity,
    });

    let headerMap: Map<string, number> | null = null;
    for await (const rawLine of rl) {
        if (!rawLine) continue;
        if (!headerMap) {
            const clean =
                rawLine.charCodeAt(0) === 0xfeff ? rawLine.slice(1) : rawLine;
            const cols = parseCsvLine(clean);
            headerMap = new Map<string, number>();
            for (let i = 0; i < cols.length; i++) {
                headerMap.set(cols[i].trim(), i);
            }
            continue;
        }
        onRow(parseCsvLine(rawLine), headerMap);
    }
}

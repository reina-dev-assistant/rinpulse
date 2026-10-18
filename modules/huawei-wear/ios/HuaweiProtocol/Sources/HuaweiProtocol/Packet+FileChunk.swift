// Port of HuaweiPacket.serializeFileChunk (GB): the framing of a file chunk the phone sends, as 0x28/0x06 for the file upload.
import Foundation

extension HuaweiPacket {
    /// Cuts `chunk` into packets of `unitSize` data bytes. Each packet carries `fileId, index, position (u32 BE), data`, optionally
    /// wrapped as an encrypted TLV, and is framed like a TLV body (sliced when it does not fit one frame). `uploadPosition` is the
    /// file offset of the chunk's first byte; `index` counts from 0 inside the chunk.
    public func serializeFileChunk(
        _ chunk: Bytes, uploadPosition: Int, unitSize: Int, fileId: UInt8, useEncryption: Bool, params: ParamsProvider
    ) throws -> [Bytes] {
        // GB divides by the unit size as a double and loops for ever on 0; the uploader refuses such a size before it gets here.
        guard unitSize > 0 else { throw PacketError.serialize("file chunk unit size \(unitSize) is not positive") }
        let packetCount = (chunk.count + unitSize - 1) / unitSize
        var out = [Bytes]()
        var offset = 0
        var sliceStart = Int32(truncatingIfNeeded: uploadPosition)
        for i in 0..<packetCount {
            let contentSize = min(unitSize, chunk.count - offset)
            var payload = Bytes()
            payload.reserveCapacity(contentSize + 6)
            payload.append(fileId)
            payload.append(UInt8(truncatingIfNeeded: i))
            payload.appendBE(UInt32(bitPattern: sliceStart))
            payload += chunk[offset..<offset + contentSize]
            offset += contentSize
            let body = useEncryption ? try HuaweiTLV.encryptRaw(params: params, data: payload).serialize() : payload
            out += serializeSliced(body, sliceSize: params.sliceSize)
            sliceStart &+= Int32(truncatingIfNeeded: contentSize)
        }
        return out
    }
}

extension HuaweiPacket {
    /// Port of `HuaweiPacket.serializeFileChunk1c` (GB `FileNextChunkSend`, service 0x1C command 0x05): `packetCount` packets of
    /// `index byte + up to transferSize bytes`, each encrypted as the TLV wrapper `{124, 125, 126}` when `useEncryption` is set (the link says
    /// transactions are crypted) and framed like a TLV body (sliced when it does not fit one frame). Unlike `serializeFileChunk` there is no
    /// file id and no position: the watch asks for byte ranges (1C/04) and counts the frames of one answer by their index.
    public func serializeFileChunk1c(
        _ chunk: Bytes, transferSize: Int, packetCount: Int, useEncryption: Bool, params: ParamsProvider
    ) throws -> [Bytes] {
        guard transferSize > 0 else { throw PacketError.serialize("file chunk transfer size \(transferSize) is not positive") }
        var out = [Bytes]()
        var offset = 0
        for i in 0..<max(packetCount, 0) {
            let contentSize = max(0, min(transferSize, chunk.count - offset))
            var payload = Bytes()
            payload.reserveCapacity(contentSize + 1)
            payload.append(UInt8(truncatingIfNeeded: i))
            payload += chunk[offset..<offset + contentSize]
            offset += contentSize
            let body = useEncryption ? try HuaweiTLV.encryptRaw(params: params, data: payload).serialize() : payload
            out += serializeSliced(body, sliceSize: params.sliceSize)
        }
        return out
    }
}

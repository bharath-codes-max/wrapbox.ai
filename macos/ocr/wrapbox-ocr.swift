// wrapbox-ocr — on-device OCR helper for wrapboxd (Tier 1 "device_helper").
//
// WHY A SEPARATE BINARY. Apple Vision only exists as a native framework, and the
// daemon must never load a large native dependency into the process that parses
// untrusted bytes on the hot path. So OCR runs here, in a short-lived child that
// the runtime time-boxes and kills. The helper reads exactly one file, prints one
// JSON object per page on stdout, and exits; it never opens the network, never
// writes anywhere, and never prints anything but the transcription (values stay
// inside the extractor → detector boundary in the runtime).
//
// Contract (runtime/src/extract/ocr.ts depends on this exactly):
//   wrapbox-ocr <path>             OCR an image (PNG/JPEG/TIFF/HEIC…) or a PDF
//   wrapbox-ocr --selftest         render a known string, OCR it, exit 0 iff it
//                                  round-trips (proves Vision works on this device)
//   wrapbox-ocr --render-test <p>  write the selftest bitmap to <p> as PNG (test fixture)
//   stdout: {"page":1,"text":"…","confidence":0.93}\n per page
//   exit:   0 ok · 2 unreadable / corrupt input · 3 unsupported format · 64 usage
//
// PDF pages are rasterised with CoreGraphics at 150 dpi (enough for 10-pt body
// text, small enough that a 50-page scan stays bounded); at most MAX_PAGES pages
// are processed and the JSON says nothing about the rest — the runtime marks
// the unit truncated when the page count hits the cap.

import Foundation
import CoreGraphics
import CoreText
import ImageIO
import Vision
import UniformTypeIdentifiers

let MAX_PAGES = 50
let PDF_DPI: CGFloat = 150
let SELFTEST_TEXT = "WRAPBOX OCR SELFTEST 12345"

struct PageResult: Encodable {
    let page: Int
    let text: String
    let confidence: Double
}

enum HelperError: Error {
    case unreadable(String)
    case unsupported(String)
}

// MARK: - OCR

/// Run Vision text recognition over one CGImage. Observations are emitted in
/// Vision's reading order, one line per observation; confidence is the mean of
/// the top candidates (0 when nothing was recognised).
func recognise(_ image: CGImage) throws -> (text: String, confidence: Double) {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([request])
    let observations = request.results ?? []
    var lines: [String] = []
    var total: Double = 0
    var n = 0
    for obs in observations {
        guard let cand = obs.topCandidates(1).first else { continue }
        lines.append(cand.string)
        total += Double(cand.confidence)
        n += 1
    }
    return (lines.joined(separator: "\n"), n == 0 ? 0 : total / Double(n))
}

// MARK: - Input loading

func sniffIsPDF(_ data: Data) -> Bool {
    // "%PDF" may be preceded by up to 1 KiB of junk per the PDF spec; a plain
    // prefix check covers every real scanner output and keeps this cheap.
    guard data.count >= 4 else { return false }
    return data.prefix(4) == Data("%PDF".utf8)
}

func loadImage(_ data: Data) throws -> CGImage {
    guard let src = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetType(src) != nil else {
        throw HelperError.unsupported("not a PDF and not an image format ImageIO recognises")
    }
    guard CGImageSourceGetCount(src) > 0,
          let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
        throw HelperError.unreadable("image container recognised but no decodable frame")
    }
    return img
}

/// Rasterise one PDF page onto a white RGB bitmap at PDF_DPI.
func renderPDFPage(_ page: CGPDFPage) throws -> CGImage {
    let box = page.getBoxRect(.mediaBox)
    let scale = PDF_DPI / 72
    let w = max(1, Int((box.width * scale).rounded(.up)))
    let h = max(1, Int((box.height * scale).rounded(.up)))
    // Bound the raster: a 200-inch page at 150 dpi is 30k px a side; refuse
    // anything over 25 Mpx rather than allocate hundreds of MB.
    guard w * h <= 25_000_000 else { throw HelperError.unreadable("page raster exceeds 25 Mpx") }
    let cs = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                              bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
        throw HelperError.unreadable("could not allocate page bitmap")
    }
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.interpolationQuality = .high
    ctx.concatenate(page.getDrawingTransform(.mediaBox, rect: CGRect(x: 0, y: 0, width: w, height: h), rotate: 0, preserveAspectRatio: true))
    ctx.drawPDFPage(page)
    guard let img = ctx.makeImage() else { throw HelperError.unreadable("could not snapshot page bitmap") }
    return img
}

func ocrFile(_ path: String) throws -> [PageResult] {
    let url = URL(fileURLWithPath: path)
    guard let data = try? Data(contentsOf: url), !data.isEmpty else {
        throw HelperError.unreadable("cannot read input file")
    }
    if sniffIsPDF(data) {
        guard let provider = CGDataProvider(data: data as CFData), let doc = CGPDFDocument(provider) else {
            throw HelperError.unreadable("PDF header present but document does not parse")
        }
        if doc.isEncrypted && !doc.isUnlocked {
            // Encrypted PDFs fail closed as unreadable; the runtime maps exit 2
            // to PARSER_FAILURE. (Tier 0 sniffing already reports ENCRYPTED for
            // the common case before the helper is ever spawned.)
            throw HelperError.unreadable("PDF is encrypted")
        }
        let count = min(doc.numberOfPages, MAX_PAGES)
        var out: [PageResult] = []
        for i in 1...max(1, count) {
            guard let page = doc.page(at: i) else { throw HelperError.unreadable("page \(i) missing") }
            let img = try renderPDFPage(page)
            let r = try recognise(img)
            out.append(PageResult(page: i, text: r.text, confidence: r.confidence))
        }
        return out
    }
    let img = try loadImage(data)
    let r = try recognise(img)
    return [PageResult(page: 1, text: r.text, confidence: r.confidence)]
}

// MARK: - Self-test fixture

/// Draw SELFTEST_TEXT in a large system font on a white bitmap. Used both by
/// --selftest (in-memory round trip) and --render-test (PNG fixture on disk).
func renderSelftestBitmap() throws -> CGImage {
    let w = 1400, h = 220
    let cs = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                              bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
        throw HelperError.unreadable("could not allocate selftest bitmap")
    }
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    let font = CTFontCreateWithName("Helvetica-Bold" as CFString, 72, nil)
    // Foundation-only build (no AppKit): use the CoreText attribute keys directly.
    let attrs: [NSAttributedString.Key: Any] = [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(red: 0, green: 0, blue: 0, alpha: 1),
    ]
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: SELFTEST_TEXT, attributes: attrs))
    ctx.textPosition = CGPoint(x: 60, y: 80)
    CTLineDraw(line, ctx)
    guard let img = ctx.makeImage() else { throw HelperError.unreadable("could not snapshot selftest bitmap") }
    return img
}

func normalise(_ s: String) -> String {
    s.uppercased().split(whereSeparator: { $0.isWhitespace || $0.isNewline }).joined(separator: " ")
}

func selftest() -> Int32 {
    do {
        let img = try renderSelftestBitmap()
        let r = try recognise(img)
        let ok = normalise(r.text).contains(normalise(SELFTEST_TEXT))
        FileHandle.standardError.write(Data("selftest: recognised=\"\(r.text)\" confidence=\(r.confidence) ok=\(ok)\n".utf8))
        return ok ? 0 : 1
    } catch {
        FileHandle.standardError.write(Data("selftest: \(error)\n".utf8))
        return 1
    }
}

func renderTest(_ path: String) -> Int32 {
    do {
        let img = try renderSelftestBitmap()
        let url = URL(fileURLWithPath: path) as CFURL
        guard let dest = CGImageDestinationCreateWithURL(url, UTType.png.identifier as CFString, 1, nil) else {
            throw HelperError.unreadable("cannot create PNG at \(path)")
        }
        CGImageDestinationAddImage(dest, img, nil)
        guard CGImageDestinationFinalize(dest) else { throw HelperError.unreadable("PNG write failed") }
        return 0
    } catch {
        FileHandle.standardError.write(Data("render-test: \(error)\n".utf8))
        return 2
    }
}

// MARK: - main

func emit(_ pages: [PageResult]) throws {
    let enc = JSONEncoder()
    enc.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    let out = FileHandle.standardOutput
    for p in pages {
        var line = try enc.encode(p)
        line.append(0x0A)
        out.write(line)
    }
}

let args = CommandLine.arguments.dropFirst()
switch args.first {
case "--selftest":
    exit(selftest())
case "--render-test":
    guard args.count == 2 else { FileHandle.standardError.write(Data("usage: wrapbox-ocr --render-test <png-path>\n".utf8)); exit(64) }
    exit(renderTest(args[args.startIndex + 1]))
case .some(let path) where args.count == 1 && !path.hasPrefix("--"):
    do {
        try emit(try ocrFile(path))
        exit(0)
    } catch HelperError.unreadable(let why) {
        FileHandle.standardError.write(Data("unreadable: \(why)\n".utf8)); exit(2)
    } catch HelperError.unsupported(let why) {
        FileHandle.standardError.write(Data("unsupported: \(why)\n".utf8)); exit(3)
    } catch {
        // Vision or ImageIO threw something we did not classify: treat as a
        // parser failure, never as "nothing found".
        FileHandle.standardError.write(Data("error: \(error)\n".utf8)); exit(2)
    }
default:
    FileHandle.standardError.write(Data("usage: wrapbox-ocr <image-or-pdf> | --selftest | --render-test <png-path>\n".utf8))
    exit(64)
}

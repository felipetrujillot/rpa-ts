import { spawn } from 'node:child_process';
export type OcrLine = { text: string; confidence: number; x: number; y: number; width: number; height: number };
// Apple Vision runs locally. No model service, clipboard or CUA perception extension is required.
const source = String.raw`
import Foundation
import Vision
import ImageIO
let data = FileHandle.standardInput.readDataToEndOfFile()
guard let imageSource = CGImageSourceCreateWithData(data as CFData, nil), let image = CGImageSourceCreateImageAtIndex(imageSource, 0, nil) else { fatalError("Invalid image") }
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
try VNImageRequestHandler(cgImage: image).perform([request])
let rows = (request.results ?? []).compactMap { observation -> [String: Any]? in
  guard let candidate = observation.topCandidates(1).first else { return nil }
  let box = observation.boundingBox
  return ["text": candidate.string, "confidence": candidate.confidence, "x": box.origin.x, "y": box.origin.y, "width": box.width, "height": box.height]
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: rows))
`;
export const recognizeMacText = async (base64: string): Promise<OcrLine[]> => {
  if (process.platform !== 'darwin') throw new Error('La comprobación OCR local requiere macOS. Utiliza la comprobación de accesibilidad en esta plataforma.');
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/swift', ['-e', source], { stdio:['pipe','pipe','pipe'] });
    let stdout=''; let stderr=''; const timeout=setTimeout(()=>child.kill(),30000);
    child.stdout.on('data',(data:Buffer)=>{stdout+=data.toString();}); child.stderr.on('data',(data:Buffer)=>{stderr=(stderr+data.toString()).slice(-2000);});
    child.on('error',(error)=>{clearTimeout(timeout);reject(error);});
    child.on('close',(code)=>{clearTimeout(timeout);if(code!==0){reject(new Error(`OCR no disponible: ${stderr}`));return;}try{resolve(JSON.parse(stdout) as OcrLine[]);}catch(error){reject(error);}});
    child.stdin.on('error',()=>{});child.stdin.end(Buffer.from(base64,'base64'));
  });
};
